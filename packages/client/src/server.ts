/*
 * Copyright (c) 2021 Concurrent Technologies Corporation.
 *
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { getLogger } from './logger'
import { getClient } from './client'
import * as fs from 'fs'
import * as path from 'path'
import { portToPid } from 'pid-port'
import { createServer, Server } from 'net'
import { runServer } from '@omega-edit/server'
import { Empty } from 'google-protobuf/google/protobuf/empty_pb'
import {
  HeartbeatRequest,
  HeartbeatResponse,
  ServerControlKind,
  ServerControlRequest,
  ServerControlResponse,
  ServerInfoResponse,
} from './omega_edit_pb'
import { execFile } from 'child_process'
import { promisify } from 'util'

// Convert execFile to a promise-based function
const execFilePromise = promisify(execFile)

const DEFAULT_PORT = 9000 // default port for the server
const DEFAULT_HOST = '127.0.0.1' // default host for the server
const KILL_YIELD_MS = 1000 // max time to yield after killing a service

/**
 * Wait for a given number of milliseconds
 * @param milliseconds delay in milliseconds
 * @returns a promise that resolves after the delay
 */
export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

/**
 * Find the first available port in a range, or null if no ports are available
 * @param startPort start of the port range
 * @param endPort end of the port range
 * @returns first available port in the range, or null if no ports are available
 */
export async function findFirstAvailablePort(
  startPort: number,
  endPort: number
): Promise<number | null> {
  const log = getLogger()
  return new Promise((resolve) => {
    let currentPort = startPort

    const tryNextPort = () => {
      if (currentPort > endPort) {
        resolve(null) // No ports available in the range
        return
      }

      const server = createServer()
      server.listen(currentPort, '0.0.0.0', () => {
        server.close((err) => {
          if (err) {
            log.error(`Error closing server on port ${currentPort}: ${err}`)
          }
          resolve(currentPort) // Found an available port
        })
      })

      server.on('error', (err) => {
        log.error(`Error when trying to listen on port ${currentPort}: ${err}`)
        ++currentPort
        tryNextPort() // Try the next port
      })
    }

    tryNextPort()
  })
}

/**
 * Wait for file to exist
 * @param filePath path to file to wait for
 * @param timeout timeout in milliseconds
 * @returns true if the file exists, otherwise an error
 */
async function waitForFileToExist(
  filePath: string,
  timeout: number = 1000
): Promise<boolean> {
  const log = getLogger()
  log.debug({
    fn: 'waitForFileToExist',
    file: filePath,
  })

  let watcher: fs.FSWatcher | null = null
  let timer: NodeJS.Timeout | null = null

  return new Promise(async (resolve, reject) => {
    const cleanup = () => {
      if (watcher) watcher.close()
      if (timer) clearTimeout(timer)
    }

    // Check if the file already exists
    try {
      await fs.promises.access(filePath, fs.constants.R_OK)
      log.debug({
        fn: 'waitForFileToExist',
        file: filePath,
        exists: true,
      })
      cleanup()
      return resolve(true)
    } catch (err) {
      // File doesn't exist, continue with setting up the watcher
    }

    watcher = fs.watch(path.dirname(filePath), (eventType, filename) => {
      if (eventType === 'rename' && filename === path.basename(filePath)) {
        log.debug({
          fn: 'waitForFileToExist',
          file: filePath,
          exists: true,
        })
        cleanup()
        resolve(true)
      }
    })

    watcher.on('error', (err) => {
      log.error({
        fn: 'waitForFileToExist',
        file: filePath,
        err: { msg: err.message },
      })
      cleanup()
      reject(err)
    })

    setTimeout(() => {
      const errMsg = `File does not exist after ${timeout} milliseconds`
      log.error({
        fn: 'waitForFileToExist',
        file: filePath,
        err: { msg: errMsg },
      })
      cleanup()
      reject(new Error(errMsg))
    }, timeout)
  })
}

/**
 * Check to see if a port is available on a host
 * @param port port to check
 * @param host host to check
 * @returns true if the port is available, false otherwise
 */
function isPortAvailable(port: number, host: string): Promise<boolean> {
  const log = getLogger()
  log.debug({
    fn: 'isPortAvailable',
    host: host,
    port: port,
  })

  return new Promise((resolve) => {
    const server: Server = createServer()
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EADDRINUSE') {
        log.error({
          fn: 'isPortAvailable',
          host: host,
          port: port,
          avail: false,
          err: {
            msg: err.message,
            code: err.code,
          },
        })
      } else {
        log.debug({
          fn: 'isPortAvailable',
          host: host,
          port: port,
          avail: false,
        })
      }
      // Ensure server closes before resolving the promise
      server.close(() => resolve(false))
    })

    server.once('listening', () => {
      // Port is available
      log.debug({
        fn: 'isPortAvailable',
        host: host,
        port: port,
        avail: true,
      })
      // Ensure server closes before resolving the promise
      server.close(() => resolve(true))
    })
    // Start listening to determine if port is available
    server.listen(port, host)
  })
}

/**
 * Sends a specified signal to a given PID and optionally falls back to SIGKILL
 * if the process fails to stop within the retry limit.
 * @param pid process id
 * @param signal signal to send to the process (default: SIGTERM)
 * @param maxRetries maximum number of retries before falling back to SIGKILL (default: 10)
 * @param fallbackToKill whether to fallback to SIGKILL if the process fails to stop (default: true)
 * @returns true if the process was stopped, false otherwise
 */
export async function stopProcessUsingPID(
  pid: number,
  signal: string = 'SIGTERM',
  maxRetries: number = 10,
  fallbackToKill: boolean = true
): Promise<boolean> {
  const log = getLogger()
  const logMetadata = { fn: 'stopProcessUsingPID', pid, signal }
  const delayMs = Math.ceil(KILL_YIELD_MS / maxRetries)

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      process.kill(pid, signal)
      await delay(delayMs)
      if (!pidIsRunning(pid)) {
        log.debug({ ...logMetadata, stopped: true, attempt })
        return true
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
        log.debug({ ...logMetadata, stopped: true, msg: 'already stopped' })
        return true
      }
      log.error({ ...logMetadata, stopped: false, err: { msg: String(err) } })
      return false
    }
  }

  if (fallbackToKill) {
    try {
      process.kill(pid, 'SIGKILL')
      await delay(delayMs)
      const stopped = !pidIsRunning(pid)
      log.debug({ ...logMetadata, stopped, msg: 'fallback SIGKILL used' })
      return stopped
    } catch (err) {
      log.error({ ...logMetadata, stopped: false, err: { msg: String(err) } })
      return false
    }
  }

  log.error({ ...logMetadata, stopped: false, msg: 'failed to stop' })
  return false
}

/**
 * Get the process id using the port
 * @param port port to check
 * @returns process id or undefined if the port is not in use
 */
async function getPidByPort(port: number): Promise<number | undefined> {
  try {
    // Try to get the PID using `lsof`
    const { stdout } = await execFilePromise('lsof', [
      '-iTCP:' + port,
      '-sTCP:LISTEN',
      '-n',
      '-P',
    ])
    const lines = stdout.trim().split('\n')
    if (lines.length > 1) {
      const [_, pid] = lines[1].trim().split(/\s+/)
      return parseInt(pid, 10)
    }
    return undefined
  } catch (error) {
    // Fallback to `portToPid` if `lsof` fails
    try {
      return await portToPid(port)
    } catch (portToPidError) {
      return undefined
    }
  }
}

/**
 * Stop the service running on a port
 * @param port port
 * @param signal signal to send to the service (default: SIGTERM)
 * @returns true if the service was signaled or no service was listening to the given port, false otherwise
 */
export async function stopServiceOnPort(
  port: number,
  signal: string = 'SIGTERM'
): Promise<boolean> {
  const log = getLogger()
  const logMetadata = {
    fn: 'stopServiceOnPort',
    port,
    signal,
  }
  log.debug(logMetadata)

  try {
    // Attempt to get the PID for the given port
    const pid = await getPidByPort(port)

    if (pid) {
      log.debug({ ...logMetadata, msg: `Found PID ${pid} for port ${port}` })

      // Attempt to stop the process using the PID
      const result = await stopProcessUsingPID(pid, signal)
      log.debug({
        ...logMetadata,
        msg: `stopProcessUsingPID result: ${result}`,
      })
      return result
    } else {
      log.debug({
        ...logMetadata,
        stopped: true,
        msg: 'No process found using the port',
      })
      return true // No process was using the port, so consider it as stopped
    }
  } catch (err) {
    // Handle case where `portToPid` cannot find a process for the port
    if (err instanceof Error) {
      if (err.message.startsWith('Could not find a process that uses port')) {
        log.debug({
          ...logMetadata,
          stopped: true,
          msg: err.message,
        })
        return true // No process using the port, so we consider it stopped
      }
      // Log other types of errors that occur
      log.error({
        ...logMetadata,
        stopped: false,
        err: {
          msg: err.message,
          stack: err.stack,
        },
      })
    } else {
      log.error({
        ...logMetadata,
        stopped: false,
        err: { msg: String(err) },
      })
    }
    return false // Return false for any errors that occur
  }
}

/**
 * Start the server
 * @param port port to listen on (default 9000)
 * @param host interface to listen on (default 127.0.0.1)
 * @param pidFile optional resolved path to the pidFile
 * @param logConf optional resolved path to a logback configuration file (e.g., path.resolve('.', 'logconf.xml'))
 * @returns pid of the server process or undefined if the server failed to start
 */
export async function startServer(
  port: number = DEFAULT_PORT,
  host: string = DEFAULT_HOST,
  pidFile?: string,
  logConf?: string
): Promise<number | undefined> {
  const logMetadata = {
    fn: 'startServer',
    host: host,
    port: port,
    pidFile: pidFile,
    logConf: logConf,
  }
  const log = getLogger()
  log.debug(logMetadata)

  async function handleExistingPidFile(pidFilePath: string): Promise<void> {
    if (fs.existsSync(pidFilePath)) {
      const pidFromFile = Number(fs.readFileSync(pidFilePath).toString())
      log.warn({
        ...logMetadata,
        err: {
          msg: 'pidFile already exists',
          pid: pidFromFile,
        },
      })

      if (!(await stopProcessUsingPID(pidFromFile))) {
        const errMsg = `server pidFile ${pidFilePath} already exists and server shutdown using PID ${pidFromFile} failed`
        log.error({
          ...logMetadata,
          err: {
            msg: errMsg,
            pid: pidFromFile,
          },
        })
        throw new Error(errMsg)
      }

      fs.unlinkSync(pidFilePath)
    }
  }

  async function checkLogConf(
    logConfPath?: string
  ): Promise<string | undefined> {
    if (logConfPath && !fs.existsSync(logConfPath)) {
      log.warn({
        ...logMetadata,
        err: {
          msg: 'logback configuration file does not exist',
          logConf: logConfPath,
        },
      })
      return undefined
    }
    return logConfPath
  }

  async function getServerPid(pidFilePath: string): Promise<number> {
    await waitForFileToExist(pidFilePath)
    return Number(fs.readFileSync(pidFilePath).toString())
  }

  if (pidFile) {
    await handleExistingPidFile(pidFile)
  }

  logConf = await checkLogConf(logConf)

  if (!(await isPortAvailable(port, host))) {
    if (!(await stopServiceOnPort(port))) {
      const errMsg = `port ${port} on host ${host} is not currently available`
      log.error({
        ...logMetadata,
        err: {
          msg: errMsg,
        },
      })
      throw new Error(errMsg)
    }
  }

  const { pid } = await runServer(port, host, pidFile, logConf)

  log.debug({
    ...logMetadata,
    state: 'waiting',
  })
  await require('wait-port')({
    host: host,
    port: port,
    output: 'silent',
  })
  log.debug({
    ...logMetadata,
    state: 'online',
  })

  if (pidFile) {
    const pidFromFile = await getServerPid(pidFile)

    if (pidFromFile !== pid && process.platform !== 'win32') {
      const errMsg = `Error pid from pidFile(${pidFromFile}) and pid(${pid}) from server script do not match`
      log.error({
        ...logMetadata,
        err: {
          msg: errMsg,
          pid: pid,
          pidFromFile: pidFromFile,
        },
      })
      throw new Error(errMsg)
    }
  }

  if (pid !== undefined && pid) {
    log.debug({
      ...logMetadata,
      pid: pid,
    })
    await getClient(port, host)
    return pid
  } else {
    const errMsg = 'Error getting server pid'
    log.error({
      ...logMetadata,
      err: {
        msg: errMsg,
      },
    })
    throw new Error(errMsg)
  }
}

/**
 * Stops the server gracefully
 * @returns 0 if the server was stopped, non-zero otherwise
 */
export function stopServerGraceful(): Promise<number> {
  return new Promise<number>(async (resolve, _) => {
    return resolve(
      stopServer(ServerControlKind.SERVER_CONTROL_GRACEFUL_SHUTDOWN)
    )
  })
}

/**
 * Stops the server immediately
 * @returns 0 if the server was stopped, non-zero otherwise
 */
export function stopServerImmediate(): Promise<number> {
  return new Promise<number>(async (resolve, _) => {
    return resolve(
      stopServer(ServerControlKind.SERVER_CONTROL_IMMEDIATE_SHUTDOWN)
    )
  })
}

type ServerControlResponseCode = number

/**
 * Stop the server
 * @param kind defines how the server should shut down
 * @returns 0 if the server was stopped, non-zero otherwise
 */
async function stopServer(
  kind: ServerControlKind
): Promise<ServerControlResponseCode> {
  const logMetadata = {
    fn: 'stopServer',
    kind: kind.toString(),
  }
  const log = getLogger()
  log.debug(logMetadata)
  const client = await getClient()

  try {
    const resp: ServerControlResponse = await new Promise((resolve, reject) => {
      client.serverControl(
        new ServerControlRequest().setKind(kind),
        (err, response) => {
          if (err) {
            reject(err)
          } else {
            resolve(response)
          }
        }
      )
    })

    if (resp.getResponseCode() !== 0) {
      log.error({
        ...logMetadata,
        stopped: false,
        err: { msg: 'stopServer exit status: ' + resp.getResponseCode() },
      })
    } else {
      log.debug({
        ...logMetadata,
        stopped: true,
      })
    }
    return resp.getResponseCode()
  } catch (err: unknown) {
    if (err instanceof Error) {
      if ('code' in err) {
        // Checks if it is a ServiceError
        if (err.message.includes('Call cancelled')) {
          log.debug({
            ...logMetadata,
            stopped: true,
            msg: err.message,
          })
        } else if (
          err.message.includes('No connection established') ||
          err.message.includes('INTERNAL:')
        ) {
          log.debug({
            ...logMetadata,
            stopped: false,
            msg: 'API failed to stop server',
            err: {
              msg: err.message,
              code: err.code,
              stack: err.stack,
            },
          })
        } else {
          log.error({
            ...logMetadata,
            stopped: false,
            err: {
              msg: err.message,
              code: err.code,
              stack: err.stack,
            },
          })
        }
      } else {
        log.error({
          ...logMetadata,
          stopped: false,
          err: {
            msg: err.message,
            stack: err.stack,
          },
        })
      }
    } else {
      log.error({
        ...logMetadata,
        stopped: false,
        err: {
          msg: String(err),
        },
      })
    }
    return -1
  }
}

/**
 * Check if a process is running
 * @param pid process id
 * @returns true if the process is running, false otherwise
 */
export function pidIsRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ESRCH') {
      return false
    }
    throw e
  }
}

export interface IServerInfo {
  serverHostname: string // hostname
  serverProcessId: number // process id
  serverVersion: string // server version
  jvmVersion: string // jvm version
  jvmVendor: string // jvm vendor
  jvmPath: string // jvm path
  availableProcessors: number // available processors
}

export async function getServerInfo(): Promise<IServerInfo> {
  const log = getLogger()
  const logMetadata = { fn: 'getServerInfo' }
  log.debug(logMetadata)
  const client = await getClient()
  return new Promise<IServerInfo>((resolve, reject) => {
    client.getServerInfo(
      new Empty(),
      (err, serverInfoResponse: ServerInfoResponse) => {
        if (err) {
          log.error({
            ...logMetadata,
            err: {
              msg: err.message,
              details: err.details,
              code: err.code,
              stack: err.stack,
            },
          })
          return reject('getServerInfo error: ' + err.message)
        }
        if (!serverInfoResponse) {
          log.error({
            ...logMetadata,
            err: { msg: 'undefined server info' },
          })
          return reject('undefined server info')
        }
        resolve({
          serverHostname: serverInfoResponse.getHostname(),
          serverProcessId: serverInfoResponse.getProcessId(),
          serverVersion: serverInfoResponse.getServerVersion(),
          jvmVersion: serverInfoResponse.getJvmVersion(),
          jvmVendor: serverInfoResponse.getJvmVendor(),
          jvmPath: serverInfoResponse.getJvmPath(),
          availableProcessors: serverInfoResponse.getAvailableProcessors(),
        })
      }
    )
  })
}

/**
 * Server heartbeat interface
 */
export interface IServerHeartbeat {
  latency: number // latency in ms
  sessionCount: number // session count
  serverTimestamp: number // timestamp in ms
  serverUptime: number // uptime in ms
  serverCpuCount: number // cpu count
  serverCpuLoadAverage: number // cpu load average
  serverMaxMemory: number // max memory in bytes
  serverCommittedMemory: number // committed memory in bytes
  serverUsedMemory: number // used memory in bytes
}

/**
 * Get the server heartbeat
 * @param activeSessions list of active sessions
 * @param heartbeatInterval heartbeat interval in ms
 * @returns a promise that resolves to the server heartbeat
 */
export async function getServerHeartbeat(
  activeSessions: string[],
  heartbeatInterval: number = 1000
): Promise<IServerHeartbeat> {
  const log = getLogger()
  const client = await getClient()
  const hostname = require('os').hostname()
  const startTime: number = Date.now()

  return new Promise<IServerHeartbeat>((resolve, reject) => {
    client.getHeartbeat(
      new HeartbeatRequest()
        .setHostname(hostname)
        .setProcessId(process.pid)
        .setHeartbeatInterval(heartbeatInterval)
        .setSessionIdsList(activeSessions),
      (err, heartbeatResponse: HeartbeatResponse) => {
        const logMetadata = { fn: 'getServerHeartbeat' }

        if (err) {
          log.error({
            ...logMetadata,
            err: {
              msg: err.message,
              details: err.details,
              code: err.code,
              stack: err.stack,
            },
          })
          return reject('getServerHeartbeat error: ' + err.message)
        }

        if (!heartbeatResponse) {
          log.error({
            ...logMetadata,
            err: { msg: 'undefined heartbeat' },
          })
          return reject('undefined heartbeat')
        }

        const latency: number = Date.now() - startTime
        resolve({
          latency: latency,
          sessionCount: heartbeatResponse.getSessionCount(),
          serverTimestamp: heartbeatResponse.getTimestamp(),
          serverUptime: heartbeatResponse.getUptime(),
          serverCpuCount: heartbeatResponse.getCpuCount(),
          serverCpuLoadAverage: heartbeatResponse.getCpuLoadAverage(),
          serverMaxMemory: heartbeatResponse.getMaxMemory(),
          serverCommittedMemory: heartbeatResponse.getCommittedMemory(),
          serverUsedMemory: heartbeatResponse.getUsedMemory(),
        })
      }
    )
  })
}
