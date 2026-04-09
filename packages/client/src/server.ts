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
import { status as GrpcStatus } from '@grpc/grpc-js'
import * as fs from 'fs'
import * as path from 'path'
import { createServer, Server, createConnection } from 'net'
import * as omegaEditServerModule from '@omega-edit/server'
import type { HeartbeatOptions } from '@omega-edit/server'
import waitPort from 'wait-port'

// Re-export HeartbeatOptions so consumers can import it from @omega-edit/client
export type { HeartbeatOptions }
import {
  ServerControlKind,
  ServerControlStatus,
} from './protobuf_ts/generated/omega_edit/v1/omega_edit'
import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  requireOptionalSafeIntegerOutput,
  requireSafeIntegerOutput,
} from './safe_int'

// Convert execFile to a promise-based function
const execFilePromise = promisify(execFile)

const DEFAULT_PORT = 9000 // default port for the server
const DEFAULT_HOST = '127.0.0.1' // default host for the server
const KILL_YIELD_MS = 1000 // max time to yield after killing a service
const FILE_EXISTENCE_POLL_INTERVAL_MS = 100 // chosen as a low-overhead compromise across platforms
const omegaEditServer =
  'default' in omegaEditServerModule
    ? omegaEditServerModule.default
    : omegaEditServerModule
const typedOmegaEditServer =
  omegaEditServer as typeof import('@omega-edit/server')
const { runServer, runServerWithArgs } = typedOmegaEditServer

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
  for (let currentPort = startPort; currentPort <= endPort; currentPort += 1) {
    try {
      if (await isPortAvailable(currentPort, '0.0.0.0')) {
        return currentPort
      }
      log.warn(`Port ${currentPort} is in use, trying next port`)
    } catch (err) {
      log.error(
        `Error checking port ${currentPort}: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
      throw err
    }
  }

  return null
}

/**
 * Wait for file to exist
 * @param filePath path to file to wait for
 * @param timeout timeout in milliseconds
 * @returns true if the file exists, otherwise an error
 */
export async function waitForFileToExist(
  filePath: string,
  timeout: number = 1000
): Promise<boolean> {
  const log = getLogger()
  log.debug({
    fn: 'waitForFileToExist',
    file: filePath,
  })

  let timer: NodeJS.Timeout | null = null

  return new Promise((resolve, reject) => {
    const start = Date.now()

    const check = async () => {
      try {
        await fs.promises.stat(filePath)
        log.debug({
          fn: 'waitForFileToExist',
          file: filePath,
          exists: true,
        })
        if (timer) clearTimeout(timer)
        return resolve(true)
      } catch {
        // keep waiting
      }

      if (Date.now() - start >= timeout) {
        const errMsg = `File does not exist after ${timeout} milliseconds`
        log.error({
          fn: 'waitForFileToExist',
          file: filePath,
          err: { msg: errMsg },
        })
        return reject(new Error(errMsg))
      }

      timer = setTimeout(check, FILE_EXISTENCE_POLL_INTERVAL_MS)
    }

    check()
  })
}

/**
 * Check to see if a port is available on a host
 * @param port port to check
 * @param host host to check
 * @returns true if the port is available, false otherwise
 */
export function isPortAvailable(port: number, host: string): Promise<boolean> {
  const log = getLogger()
  log.debug({
    fn: 'isPortAvailable',
    host: host,
    port: port,
  })

  return new Promise((resolve, reject) => {
    const server: Server = createServer()
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        log.debug({
          fn: 'isPortAvailable',
          host: host,
          port: port,
          avail: false,
        })
        return resolve(false)
      }

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
      return reject(err)
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
 * Checks if a Unix socket path has an active server bound to it
 * @param socketPath unix socket path to check
 * @returns true if the socket exists and has an active server, false otherwise
 */
function isSocketActive(socketPath: string): Promise<boolean> {
  const log = getLogger()
  log.debug({
    fn: 'isSocketActive',
    socketPath,
  })

  return new Promise((resolve) => {
    let resolved = false
    let client: import('net').Socket | undefined
    let timeout: NodeJS.Timeout | undefined

    const finish = (active: boolean, reason?: string) => {
      if (resolved) return
      resolved = true
      if (timeout) clearTimeout(timeout)
      client?.removeAllListeners()
      client?.destroy()

      if (reason) {
        log.debug({
          fn: 'isSocketActive',
          socketPath,
          active,
          reason,
        })
      } else {
        log.debug({
          fn: 'isSocketActive',
          socketPath,
          active,
        })
      }

      resolve(active)
    }

    // If socket doesn't exist, it's not active
    if (!fs.existsSync(socketPath)) {
      resolve(false)
      return
    }

    // Try to connect to the socket
    client = createConnection({ path: socketPath })

    // Set a timeout to avoid hanging indefinitely
    timeout = setTimeout(() => {
      finish(false, 'connection timeout')
    }, 5000) // 5 second timeout

    client.once('connect', () => {
      finish(true)
    })

    client.once('error', (err: NodeJS.ErrnoException) => {
      finish(false, err.code || 'connection error')
    })
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
  if (process.platform === 'win32') {
    return await getPidByPortWithNetstat(port)
  }

  try {
    const { stdout } = await execFilePromise('lsof', [
      '-t',
      `-iTCP:${port}`,
      '-sTCP:LISTEN',
      '-n',
      '-P',
    ])
    return parseFirstPid(stdout)
  } catch {
    if (process.platform === 'linux') {
      const pid = await getPidByPortWithSs(port)
      if (pid !== undefined) {
        return pid
      }

      return await getPidByPortWithNetstatLinux(port)
    }

    return undefined
  }
}

function parseFirstPid(stdout: string): number | undefined {
  const pid = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  if (!pid) {
    return undefined
  }

  const parsed = Number.parseInt(pid, 10)
  return Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed
}

function readPidFromFile(pidFilePath: string): number {
  const pid = parseFirstPid(fs.readFileSync(pidFilePath, 'utf8'))
  if (pid === undefined) {
    throw new Error(`Invalid PID in ${pidFilePath}`)
  }
  return pid
}

async function getPidByPortWithSs(port: number): Promise<number | undefined> {
  try {
    const { stdout } = await execFilePromise('ss', ['-ltnp'])
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.includes('LISTEN') || !line.includes(`:${port}`)) {
        continue
      }

      const match = line.match(/pid=(\d+)/)
      if (match) {
        return Number.parseInt(match[1], 10)
      }
    }
  } catch {
    // ignore and fall through to undefined
  }

  return undefined
}

async function getPidByPortWithNetstatLinux(
  port: number
): Promise<number | undefined> {
  try {
    const { stdout } = await execFilePromise('netstat', ['-ltnp'])
    for (const line of stdout.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 7) {
        continue
      }

      const localAddress = parts[3]
      const state = parts[5]
      const pidProgram = parts[6]
      if (
        localAddress.endsWith(`:${port}`) &&
        state.toUpperCase() === 'LISTEN'
      ) {
        const match = pidProgram.match(/^(\d+)\//)
        if (match) {
          return Number.parseInt(match[1], 10)
        }
      }
    }
  } catch {
    // ignore and fall through to undefined
  }

  return undefined
}

async function getPidByPortWithNetstat(
  port: number
): Promise<number | undefined> {
  try {
    const { stdout } = await execFilePromise('netstat', ['-ano', '-p', 'tcp'])
    for (const line of stdout.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 5) {
        continue
      }

      const [proto, localAddress, , state, pidText] = parts
      if (
        proto.toUpperCase() === 'TCP' &&
        localAddress.endsWith(`:${port}`) &&
        state.toUpperCase() === 'LISTENING'
      ) {
        const pid = Number.parseInt(pidText, 10)
        return Number.isNaN(pid) ? undefined : pid
      }
    }
  } catch {
    // ignore and fall through to undefined
  }

  return undefined
}

/**
 * Get the process id using a Unix socket path
 * @param socketPath Unix socket path to check
 * @returns process id or undefined if the socket is not bound to a process
 */
async function getPidBySocket(socketPath: string): Promise<number | undefined> {
  const log = getLogger()
  try {
    // Use lsof in PID-only mode to find processes associated with the socket
    // `-t` outputs only PIDs, one per line
    const { stdout } = await execFilePromise('lsof', ['-t', '--', socketPath])
    const pids = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => parseInt(line, 10))
      .filter((pid) => !Number.isNaN(pid))

    const uniquePids = Array.from(new Set(pids))

    if (uniquePids.length === 1) {
      return uniquePids[0]
    }

    if (uniquePids.length > 1) {
      const msg =
        'Multiple PIDs found for socket; refusing to choose arbitrarily'
      log.debug({
        fn: 'getPidBySocket',
        socketPath,
        msg,
        pids: uniquePids,
      })
      throw new Error(msg)
    }
    return undefined
  } catch (error) {
    log.error({
      fn: 'getPidBySocket',
      socketPath,
      err: {
        msg: error instanceof Error ? error.message : String(error),
      },
    })
    throw error
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
 * Stop the service bound to a Unix socket
 * @param socketPath Unix socket path
 * @param signal signal to send to the service (default: SIGTERM)
 * @returns true if the service was stopped or no service was bound to the socket, false otherwise
 */
async function stopServiceOnSocket(
  socketPath: string,
  signal: string = 'SIGTERM'
): Promise<boolean> {
  const log = getLogger()
  const logMetadata = {
    fn: 'stopServiceOnSocket',
    socketPath,
    signal,
  }
  log.debug(logMetadata)

  try {
    const pid = await getPidBySocket(socketPath)
    if (pid) {
      log.debug({
        ...logMetadata,
        pid,
        msg: 'Process found bound to socket',
      })
      // Attempt to stop the process using the PID
      const result = await stopProcessUsingPID(pid, signal)
      log.debug({
        ...logMetadata,
        msg: `stopProcessUsingPID result: ${result}`,
      })
      return result
    } else {
      log.warn({
        ...logMetadata,
        stopped: false,
        msg: 'Unable to determine PID for socket; refusing to treat as stopped',
      })
      return false
    }
  } catch (err) {
    if (err instanceof Error) {
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
 * @param heartbeat optional heartbeat / session-reaping options
 * @returns pid of the server process or undefined if the server failed to start
 */
export async function startServer(
  port: number = DEFAULT_PORT,
  host: string = DEFAULT_HOST,
  pidFile?: string,
  heartbeat?: HeartbeatOptions
): Promise<number | undefined> {
  const logMetadata = {
    fn: 'startServer',
    host: host,
    port: port,
    pidFile: pidFile,
  }
  const log = getLogger()
  log.debug(logMetadata)

  async function handleExistingPidFile(pidFilePath: string): Promise<void> {
    if (fs.existsSync(pidFilePath)) {
      const pidFromFile = readPidFromFile(pidFilePath)
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

  async function getServerPid(pidFilePath: string): Promise<number> {
    await waitForFileToExist(pidFilePath)
    return readPidFromFile(pidFilePath)
  }

  if (pidFile) {
    await handleExistingPidFile(pidFile)
  }

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

  const { pid } = await runServer(port, host, pidFile, heartbeat)

  log.debug({
    ...logMetadata,
    state: 'waiting',
  })
  await waitPort({
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
 * Start the server with a unix domain socket, optionally in UDS-only mode
 * @param socketPath unix socket path to bind
 * @param pidFile optional resolved path to the pidFile
 * @param udsOnly when true, starts the server in unix-socket-only mode (defaults to true)
 * @param port server port to bind when UDS-only mode is disabled
 * @param host server interface to bind when UDS-only mode is disabled
 * @param heartbeat optional heartbeat / session-reaping options
 * @returns pid of the server process or undefined if the server failed to start
 */
export async function startServerUnixSocket(
  socketPath: string,
  pidFile?: string,
  udsOnly: boolean = true,
  port: number = DEFAULT_PORT,
  host: string = DEFAULT_HOST,
  heartbeat?: HeartbeatOptions
): Promise<number | undefined> {
  const logMetadata = {
    fn: 'startServerUnixSocket',
    socketPath,
    host,
    port,
    pidFile,
  }
  const log = getLogger()
  log.debug(logMetadata)

  const socketDir = path.dirname(socketPath)
  if (socketDir && socketDir !== '.') {
    fs.mkdirSync(socketDir, { recursive: true })
  }

  // Check if socket exists and if it has an active server bound to it
  if (fs.existsSync(socketPath)) {
    const socketActive = await isSocketActive(socketPath)
    if (socketActive) {
      // Socket has an active server - attempt to stop it first
      log.warn({
        ...logMetadata,
        msg: 'Active server detected on socket path, attempting to stop it',
      })
      if (!(await stopServiceOnSocket(socketPath))) {
        const errMsg = `Unix socket ${socketPath} has an active server that could not be stopped. This may be due to insufficient permissions, a hung server process, or unavailable system utilities.`
        log.error({
          ...logMetadata,
          err: {
            msg: errMsg,
          },
        })
        throw new Error(errMsg)
      }
    }

    // Socket is stale or server was stopped - safe to remove
    try {
      fs.unlinkSync(socketPath)
      log.debug({
        ...logMetadata,
        msg: 'Removed stale unix socket',
      })
    } catch (err) {
      const unlinkErr = err as NodeJS.ErrnoException
      log.error({
        ...logMetadata,
        err: {
          msg: 'failed to remove existing unix socket',
          code: unlinkErr.code,
          errno: unlinkErr.errno,
          syscall: unlinkErr.syscall,
          path: unlinkErr.path,
        },
      })
      throw err
    }
  }

  async function handleExistingPidFile(pidFilePath: string): Promise<void> {
    if (fs.existsSync(pidFilePath)) {
      const pidFromFile = readPidFromFile(pidFilePath)
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

  async function getServerPid(pidFilePath: string): Promise<number> {
    await waitForFileToExist(pidFilePath)
    return readPidFromFile(pidFilePath)
  }

  if (pidFile) {
    await handleExistingPidFile(pidFile)
  }

  if (!udsOnly) {
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
  }

  const args: string[] = [`--unix-socket=${socketPath}`]

  if (udsOnly) {
    args.push('--unix-socket-only')
  } else {
    args.push(`--interface=${host}`, `--port=${port}`)
  }

  if (pidFile) {
    args.push(`--pidfile=${pidFile}`)
  }

  const { pid } = await runServerWithArgs(args, heartbeat)

  log.debug({
    ...logMetadata,
    state: 'waiting',
  })
  const socketWaitMs = Number(
    process.env.OMEGA_EDIT_SERVER_SOCKET_WAIT_MS || '20000'
  )
  await waitForFileToExist(socketPath, socketWaitMs)
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
    await getClient(port, host, { socketPath })
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
 * @returns structured shutdown status
 */
export function stopServerGraceful(): Promise<IServerControlResult> {
  return stopServer(ServerControlKind.GRACEFUL_SHUTDOWN)
}

/**
 * Stops the server immediately
 * @returns structured shutdown status
 */
export function stopServerImmediate(): Promise<IServerControlResult> {
  return stopServer(ServerControlKind.IMMEDIATE_SHUTDOWN)
}

export type ServerControlState = 'completed' | 'draining' | 'unknown'

export interface IServerControlResult {
  responseCode: number
  serverProcessId: number
  status: ServerControlState
}

type RawServerControlResponse =
  | { responseCode: number; pid?: number; status?: ServerControlStatus }
  | {
      getResponseCode(): number
      getPid?(): number
      getStatus?(): ServerControlStatus | undefined
    }

function getServerControlStatus(
  response: RawServerControlResponse,
  kind: ServerControlKind,
  responseCode: number
): ServerControlState {
  const rawStatus =
    'getStatus' in response && typeof response.getStatus === 'function'
      ? response.getStatus()
      : 'status' in response
        ? response.status
        : undefined

  switch (rawStatus) {
    case ServerControlStatus.COMPLETED:
      return 'completed'
    case ServerControlStatus.DRAINING:
      return 'draining'
    case ServerControlStatus.UNSPECIFIED:
      return 'unknown'
    default:
      if (rawStatus === undefined) {
        if (
          kind === ServerControlKind.GRACEFUL_SHUTDOWN &&
          responseCode === 1
        ) {
          return 'draining'
        }
        if (responseCode === 0) {
          return 'completed'
        }
      }
      return 'unknown'
  }
}

/**
 * Stop the server
 * @param kind defines how the server should shut down
 * @returns structured shutdown status
 */
async function stopServer(
  kind: ServerControlKind
): Promise<IServerControlResult> {
  const logMetadata = {
    fn: 'stopServer',
    kind: kind.toString(),
  }
  const log = getLogger()
  log.debug(logMetadata)
  const client = await getClient()

  try {
    const resp: RawServerControlResponse = await new Promise(
      (resolve, reject) => {
        client.serverControl({ kind }, (err, response) => {
          if (err) {
            reject(err)
          } else if (!response) {
            reject(new Error('undefined server control response'))
          } else {
            resolve(response)
          }
        })
      }
    )

    const responseCode =
      'getResponseCode' in resp ? resp.getResponseCode() : resp.responseCode
    const serverProcessId =
      'getPid' in resp && typeof resp.getPid === 'function'
        ? resp.getPid()
        : 'pid' in resp && typeof resp.pid === 'number'
          ? resp.pid
          : -1
    const status = getServerControlStatus(resp, kind, responseCode)

    if (responseCode !== 0 && status !== 'draining') {
      log.error({
        ...logMetadata,
        stopped: false,
        err: { msg: 'stopServer exit status: ' + responseCode },
      })
    } else {
      log.debug({
        ...logMetadata,
        stopped: status === 'completed',
        status,
      })
    }
    return {
      responseCode,
      serverProcessId,
      status,
    }
  } catch (err: unknown) {
    if (err instanceof Error) {
      if ('code' in err) {
        // Checks if it is a ServiceError
        if (err.code === GrpcStatus.CANCELLED) {
          log.debug({
            ...logMetadata,
            stopped: true,
            msg: err.message,
          })
        } else if (
          err.code === GrpcStatus.UNAVAILABLE ||
          err.code === GrpcStatus.INTERNAL
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
    return {
      responseCode: -1,
      serverProcessId: -1,
      status: 'unknown',
    }
  }
}

/**
 * Check if a process is running
 * @param pid process id
 * @returns true if the process is running, false otherwise
 */
export function pidIsRunning(pid: number): boolean {
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

/**
 * Server metadata returned by {@link getServerInfo}.
 */
export interface IServerInfo {
  /** Server hostname. */
  serverHostname: string
  /** Server OS process ID. */
  serverProcessId: number
  /** Ωedit server version string. */
  serverVersion: string
  /** Runtime family, for example `native`. */
  runtimeKind: string
  /** Runtime implementation name, for example `C++`. */
  runtimeName: string
  /** Host platform and architecture summary. */
  platform: string
  /** Number of logical CPU cores. */
  availableProcessors: number
  /** Compiler or toolchain used to build the server. */
  compiler: string
  /** Build configuration, e.g. "Release" or "Debug". */
  buildType: string
  /** C++ standard used, e.g. "C++17". */
  cppStandard: string
}

/**
 * Retrieve server metadata: version, hostname, process ID, and resource info.
 * @return server information object
 */
export async function getServerInfo(): Promise<IServerInfo> {
  const log = getLogger()
  const logMetadata = { fn: 'getServerInfo' }
  log.debug(logMetadata)
  const client = await getClient()
  return new Promise<IServerInfo>((resolve, reject) => {
    client.getServerInfo({}, (err, serverInfoResponse) => {
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
        return reject(new Error('getServerInfo error: ' + err.message))
      }
      if (!serverInfoResponse) {
        log.error({
          ...logMetadata,
          err: { msg: 'undefined server info' },
        })
        return reject(new Error('undefined server info'))
      }
      resolve({
        serverHostname: serverInfoResponse.hostname,
        serverProcessId: serverInfoResponse.processId,
        serverVersion: serverInfoResponse.serverVersion,
        runtimeKind: serverInfoResponse.runtimeKind,
        runtimeName: serverInfoResponse.runtimeName,
        platform: serverInfoResponse.platform,
        availableProcessors: serverInfoResponse.availableProcessors,
        compiler: serverInfoResponse.compiler,
        buildType: serverInfoResponse.buildType,
        cppStandard: serverInfoResponse.cppStandard,
      })
    })
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
  serverCpuLoadAverage?: number // load average when available
  serverResidentMemoryBytes?: number // resident memory in bytes
  serverVirtualMemoryBytes?: number // virtual memory in bytes
  serverPeakResidentMemoryBytes?: number // peak resident memory in bytes
}

/**
 * Get the server heartbeat
 * @param activeSessions list of active sessions
 * @throws when called with removed legacy positional arguments from the 1.x API
 * @returns a promise that resolves to the server heartbeat
 */
export async function getServerHeartbeat(
  activeSessions: string[],
  ...unexpectedArgs: unknown[]
): Promise<IServerHeartbeat> {
  if (unexpectedArgs.length > 0) {
    throw new Error(
      'getServerHeartbeat(sessionIds) is session-centric in 2.x; legacy hostname/process/interval positional arguments were removed'
    )
  }

  const log = getLogger()
  const client = await getClient()
  const startTime: number = Date.now()

  return new Promise<IServerHeartbeat>((resolve, reject) => {
    client.getHeartbeat(
      {
        sessionIds: activeSessions,
      },
      (err, heartbeatResponse) => {
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
          return reject(new Error('getServerHeartbeat error: ' + err.message))
        }

        if (!heartbeatResponse) {
          log.error({
            ...logMetadata,
            err: { msg: 'undefined heartbeat' },
          })
          return reject(new Error('undefined heartbeat'))
        }

        try {
          const latency: number = Date.now() - startTime
          resolve({
            latency: latency,
            sessionCount: heartbeatResponse.sessionCount,
            serverTimestamp: requireSafeIntegerOutput(
              'server heartbeat timestamp',
              heartbeatResponse.timestamp
            ),
            serverUptime: requireSafeIntegerOutput(
              'server heartbeat uptime',
              heartbeatResponse.uptime
            ),
            serverCpuCount: heartbeatResponse.cpuCount,
            serverCpuLoadAverage: heartbeatResponse.loadAverage,
            serverResidentMemoryBytes: requireOptionalSafeIntegerOutput(
              'server resident memory bytes',
              heartbeatResponse.residentMemoryBytes
            ),
            serverVirtualMemoryBytes: requireOptionalSafeIntegerOutput(
              'server virtual memory bytes',
              heartbeatResponse.virtualMemoryBytes
            ),
            serverPeakResidentMemoryBytes: requireOptionalSafeIntegerOutput(
              'server peak resident memory bytes',
              heartbeatResponse.peakResidentMemoryBytes
            ),
          })
        } catch (safeIntegerError) {
          reject(safeIntegerError)
        }
      }
    )
  })
}
