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
import { IHeartbeatReceiver } from './registry'

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
 * Stop the server
 * @param pid pid of the server process
 * @returns true if the server was stopped, false otherwise
 */
export async function stopProcessUsingPID(
  pid: number,
  signal: string = 'SIGTERM'
): Promise<boolean> {
  const logMetadata = {
    fn: 'stopProcessUsingPID',
    pid,
    signal,
  }
  const log = getLogger()
  log.debug(logMetadata)
  try {
    process.kill(pid, signal)
    // yield for a moment to allow the server to process the shutdown
    const delayMs = Math.ceil(KILL_YIELD_MS / 10)
    for (let i = 0; i < 10; ++i) {
      await delay(delayMs)
      if (!pidIsRunning(pid)) {
        break
      }
    }
    if (pidIsRunning(pid)) {
      log.error({
        ...logMetadata,
        stopped: false,
        msg: 'process failed to stop',
      })
      return false
    }
    log.debug({ ...logMetadata, stopped: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
      log.debug({
        ...logMetadata,
        stopped: true,
        msg: 'process already stopped',
      })
    } else {
      log.error({
        ...logMetadata,
        stopped: false,
        err: { msg: String(err) },
      })
      return false
    }
  }
  return true
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
    const pid = await portToPid(port)
    return pid ? stopProcessUsingPID(pid as number, signal) : true
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.startsWith('Could not find a process that uses port')) {
        log.debug({
          ...logMetadata,
          stopped: true,
          msg: err.message,
        })
        // if the port is not in use, return true
        return true
      }
      log.debug({
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
  }
  return false
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
    return false
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

export async function getServerHeartbeatFor(
  receiver: IHeartbeatReceiver,
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
        .setHeartbeatInterval(heartbeatInterval),
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
        // HeartbeatRegistry.update(receiver, {timestampMs: startTime, nextTimestampMs: startTime + heartbeatInterval})

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