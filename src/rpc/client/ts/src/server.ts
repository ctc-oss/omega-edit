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

import * as path from 'path'
import * as os from 'os'
import * as child_process from 'child_process'
import { getLogger } from './logger'
import { getClient } from './client'
import { Empty } from 'google-protobuf/google/protobuf/empty_pb'
import * as fs from 'fs'
import {
  ServerControlKind,
  ServerControlRequest,
  ServerControlResponse,
  VersionResponse,
} from './omega_edit_pb'

/**
 * Artifact class
 */
class Artifact {
  // Name of the artifact
  name: string
  // Name of the script
  scriptName: string
  // Path to the script
  scriptPath: string
  // Path to the script directory
  scriptDir: string

  constructor(
    readonly baseScriptName: string,
    readonly version: string,
    readonly rootPath: string
  ) {
    this.name = baseScriptName
    this.scriptName =
      os.platform() === 'win32' ? `${baseScriptName}.bat` : baseScriptName

    // build the path to the script
    this.scriptDir = path.join(rootPath, `${baseScriptName}-${version}`, 'bin')
    this.scriptPath = path.join(this.scriptDir, this.scriptName)
  }
}

/**
 * Start the server
 * @param rootPath path to the root of the server package
 * @param version version of the server package
 * @param port port to listen on
 * @param host interface to listen on
 * @returns pid of the server process or undefined if the server failed to start
 */
export async function startServer(
  rootPath: string,
  version: string,
  port: number = 9000,
  host: string = '127.0.0.1'
): Promise<number | undefined> {
  // Set up the server
  getLogger().debug({
    fn: 'startServer',
    version: version,
    rootPath: rootPath,
    port: port,
  })
  const artifact = new Artifact('omega-edit-grpc-server', version, rootPath)

  let args = [`--interface=${host}`, `--port=${port}`]
  const logConf = path.resolve('.', 'logconf.xml')
  if (fs.existsSync(logConf)) {
    args.push(`-Dlogback.configurationFile=${logConf}`)
  }
  // Start the server
  getLogger().debug(
    `starting server ${artifact.scriptPath} with args ${args} in directory ${artifact.scriptDir}`
  )
  const server = child_process.spawn(artifact.scriptPath, args, {
    cwd: artifact.scriptDir,
    stdio: 'ignore',
    detached: true,
  })

  // Wait for the server come online
  getLogger().debug(
    `waiting for server to come online on interface ${host}, port ${port}`
  )
  await require('wait-port')({
    host: host,
    port: port,
    output: 'silent',
  })

  // Return the server pid if it exists
  return new Promise((resolve, reject) => {
    if (server.pid !== undefined && server.pid) {
      getLogger().debug({
        fn: 'startServer',
        host: host,
        port: port,
        pid: server.pid,
      })
      // initialize the client
      getClient(port, host)
      resolve(server.pid)
    } else {
      getLogger().error({
        fn: 'startServer',
        err: {
          msg: 'Error getting server pid',
          host: host,
          port: port,
          server: server,
        },
      })
      reject(`Error getting server pid: ${server}`)
    }
  })
}

/**
 * Stops the server gracefully
 * @returns true if the server was stopped
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
 * @returns true if the server was stopped
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
 * @returns true if the server was stopped
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
            return resolve(0)
          }

          if (
            err.message.includes('No connection established') ||
            err.message.includes('INTERNAL:')
          ) {
            getLogger().debug({
              fn: 'stopServer',
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

        if (resp.getResponseCode() != 0) {
          getLogger().error({
            fn: 'stopServer',
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
 * @returns true if the server was stopped
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
  resp: string // server response
}

/**
 * Get the server heartbeat
 * @returns a promise that resolves to the server heartbeat
 */
export function getServerHeartbeat(): Promise<IServerHeartbeat> {
  return new Promise<IServerHeartbeat>((resolve, reject) => {
    const startTime = Date.now()
    getClient().getVersion(new Empty(), (err, v: VersionResponse) => {
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

      if (!v) {
        getLogger().error({
          fn: 'getServerHeartbeat',
          err: { msg: 'undefined version' },
        })
        return reject('undefined version')
      }
      const latency = Date.now() - startTime
      return resolve({
        latency: latency,
        resp: `${v.getMajor()}.${v.getMinor()}.${v.getPatch()}`,
      })
    })
  })
}
