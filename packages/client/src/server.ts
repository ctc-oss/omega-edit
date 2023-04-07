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
import {
  HeartbeatRequest,
  HeartbeatResponse,
  ServerControlKind,
  ServerControlRequest,
  ServerControlResponse,
} from './omega_edit_pb'
import { runServer } from '@omega-edit/server'

/**
 * Start the server
 * @param port port to listen on (default 9000)
 * @param host interface to listen on (default 127.0.0.1)
 * @param pidfile optional resolved path to the pidfile
 * @param logConf optional resolved path to a logback configuration file (e.g., path.resolve('.', 'logconf.xml'))
 * @returns pid of the server process or undefined if the server failed to start
 */
export async function startServer(
  port: number = 9000,
  host: string = '127.0.0.1',
  pidfile?: string,
  logConf?: string
): Promise<number | undefined> {
  // Set up the server
  getLogger().debug({
    fn: 'startServer',
    host: host,
    port: port,
    pidfile: pidfile,
    logConf: logConf,
  })

  if (pidfile) {
    // check if the pidfile already exists
    if (fs.existsSync(pidfile)) {
      const pidFromFile = Number(fs.readFileSync(pidfile).toString())
      getLogger().warn({
        fn: 'startServer',
        err: {
          msg: 'pidfile already exists',
          pidfile: pidfile,
          pid: pidFromFile,
        },
      })
      // stop the old server
      if (!(await stopServerUsingPID(pidFromFile))) {
        getLogger().error({
          fn: 'startServer',
          err: {
            msg: 'server pidfile already exists and server shutdown failed',
            pidfile: pidfile,
            pid: pidFromFile,
          },
        })
        throw new Error(
          `server pidfile ${pidfile} already exists and server shutdown using PID ${pidFromFile} failed`
        )
      }
    }
  }

  if (logConf && !fs.existsSync(logConf)) {
    getLogger().warn({
      fn: 'startServer',
      err: {
        msg: 'logback configuration file does not exist',
        logConf: logConf,
      },
    })
    logConf = undefined
  }

  // Start the server
  const pid = (await runServer(port, host, pidfile, logConf)).pid

  // Wait for the server come online
  getLogger().debug(
    `waiting for server to come online on interface ${host}, port ${port}`
  )
  await require('wait-port')({
    host: host,
    port: port,
    output: 'silent',
  })

  if (pidfile) {
    const pidFromFile = Number(fs.readFileSync(pidfile).toString())
    if (pidFromFile !== pid) {
      getLogger().error({
        fn: 'startServer',
        err: {
          msg: 'Error pid from pidfile and pid from server script do not match',
          pid: pid,
          pidFromFile: pidFromFile,
          pidfile: pidfile,
        },
      })
      // Here we are in a state where the server is running but the pid is ambiguous.
      // This is a fatal error that should not happen.
      throw new Error(
        `Error pid from pidfile(${pidFromFile}) and pid(${pid}) from server script do not match`
      )
    }
  }

  // Return the server pid if it exists
  return new Promise((resolve, reject) => {
    if (pid !== undefined && pid) {
      getLogger().debug({
        fn: 'startServer',
        host: host,
        port: port,
        pid: pid,
      })
      // initialize the client
      getClient(port, host)
      resolve(pid)
    } else {
      getLogger().error({
        fn: 'startServer',
        err: {
          msg: 'Error getting server pid',
          host: host,
          port: port,
        },
      })
      reject('Error getting server pid')
    }
  })
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

/**
 * Stop the server
 * @param kind defines how the server should shutdown
 * @returns 0 if the server was stopped, non-zero otherwise
 */
function stopServer(kind: ServerControlKind): Promise<number> {
  getLogger().debug({
    fn: 'stopServer',
    kind: kind.toString(),
  })

  return new Promise<number>((resolve, reject) => {
    getClient().serverControl(
      new ServerControlRequest().setKind(kind),
      (err, resp: ServerControlResponse) => {
        if (err) {
          if (err.message.includes('Call cancelled')) {
            getLogger().debug({
              fn: 'stopServer',
              kind: kind.toString(),
              stopped: true,
              msg: err.message,
            })
            return resolve(0)
          } else if (
            err.message.includes('No connection established') ||
            err.message.includes('INTERNAL:')
          ) {
            getLogger().debug({
              fn: 'stopServer',
              kind: kind.toString(),
              stopped: false,
              msg: 'API failed to stop server',
            })

            /**
             * 0 indicates the API stopped the server,
             * 1 indicates the API failed to stop the server, caused by either:
             *  - No connection established to server
             *  - There was n issue trying to connect to the server
             */

            return resolve(1)
          }

          getLogger().error({
            fn: 'stopServer',
            err: {
              msg: err.message,
              details: err.details,
              code: err.code,
              stack: err.stack,
            },
          })

          return reject('stopServer error: ' + err.message)
        }

        if (resp.getResponseCode() !== 0) {
          getLogger().error({
            fn: 'stopServer',
            kind: kind.toString(),
            stopped: false,
            err: { msg: 'stopServer exit status: ' + resp.getResponseCode() },
          })

          return reject('stopServer error')
        }

        getLogger().debug({
          fn: 'stopServer',
          kind: kind.toString(),
          stopped: true,
        })

        return resolve(resp.getResponseCode())
      }
    )
  })
}

/**
 * Stop the server
 * @param pid pid of the server process
 * @returns true if the server was stopped, false otherwise
 */
export async function stopServerUsingPID(
  pid: number | undefined
): Promise<boolean> {
  if (pid) {
    getLogger().debug({ fn: 'stopServerUsingPID', pid: pid })

    try {
      const result = process.kill(pid, 'SIGTERM')
      getLogger().debug({ fn: 'stopServerUsingPID', pid: pid, stopped: result })
      return result
    } catch (err) {
      // @ts-ignore
      if (err.code === 'ESRCH') {
        getLogger().debug({
          fn: 'stopServerUsingPID',
          msg: 'Server already stopped',
          pid: pid,
        })

        // the server is already stopped
        return true
      }

      getLogger().error({
        fn: 'stopServerUsingPID',
        err: { msg: 'Error stopping server', pid: pid, err: err },
      })

      return false
    }
  }

  getLogger().error({
    fn: 'stopServerUsingPID',
    err: { msg: 'Error stopping server, no PID' },
  })

  return false
}

/**
 * Server heartbeat interface
 */
export interface IServerHeartbeat {
  latency: number // latency in ms
  serverHostname: string // hostname
  serverProcessId: number // process id
  serverVersion: string // server version
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
 * @returns a promise that resolves to the server heartbeat
 */
export function getServerHeartbeat(
  activeSessions: string[],
  heartbeatInterval: number = 1000
): Promise<IServerHeartbeat> {
  return new Promise<IServerHeartbeat>((resolve, reject) => {
    const startTime = Date.now()
    getClient().getHeartbeat(
      new HeartbeatRequest()
        .setHostname(require('os').hostname())
        .setProcessId(process.pid)
        .setHeartbeatInterval(heartbeatInterval)
        .setSessionIdsList(activeSessions),
      (err, heartbeatResponse: HeartbeatResponse) => {
        if (err) {
          getLogger().error({
            fn: 'getServerHeartbeat',
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
          getLogger().error({
            fn: 'getServerHeartbeat',
            err: { msg: 'undefined heartbeat' },
          })
          return reject('undefined heartbeat')
        }
        const latency = Date.now() - startTime
        return resolve({
          latency: latency,
          serverHostname: heartbeatResponse.getHostname(),
          serverProcessId: heartbeatResponse.getProcessId(),
          serverVersion: heartbeatResponse.getServerVersion(),
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
