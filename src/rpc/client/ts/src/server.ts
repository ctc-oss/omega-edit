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

  // Start the server
  getLogger().debug(
    `starting server ${artifact.scriptPath} on interface ${host}, port ${port}`
  )
  const server = child_process.spawn(
    artifact.scriptPath,
    [`--interface=${host}`, `--port=${port}`],
    {
      cwd: artifact.scriptDir,
      stdio: 'ignore',
      detached: true,
    }
  )

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
 * Stop the server
 * @param pid pid of the server process
 * @returns true if the server was stopped
 */
export function stopServer(pid: number | undefined): boolean {
  if (pid) {
    getLogger().debug({ fn: 'stopServer', pid: pid })
    try {
      const result = process.kill(pid, 'SIGTERM')
      getLogger().debug({ fn: 'stopServer', pid: pid, stopped: result })
      return result
    } catch (err) {
      // @ts-ignore
      if (err.code === 'ESRCH') {
        getLogger().debug({
          fn: 'stopServer',
          msg: 'Server already stopped',
          pid: pid,
        })
        return true
      }
      getLogger().error({
        fn: 'stopServer',
        err: { msg: 'Error stopping server', pid: pid, err: err },
      })
      return false
    }
  }

  getLogger().error({
    fn: 'stopServer',
    err: { msg: 'Error stopping server, no PID' },
  })
  return false
}
