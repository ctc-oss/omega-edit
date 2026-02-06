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

/**
 * @fileoverview
 * This file contains the main entry point for the Omega Edit gRPC server.
 * It is responsible for starting the gRPC server in a platform-agnostic way.
 * It can be imported as a module.
 */

import { ChildProcess, spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * Checks to see if either path to the server bin directory exists
 * @param baseDir the base path to the directory to check against
 * @returns
 *    - one of the checked paths if they exist
 *    OR
 *    - calls the getBinFolderPath going back a directory
 */
const checkForBinPath = (baseDir: string): string => {
  const serverbasePath = 'node_modules/@omega-edit/server'

  // These two are checked as when testing locally it will want to use out/bin
  const pathsToCheck: string[] = [
    path.join(baseDir, serverbasePath, 'bin'),
    path.join(baseDir, serverbasePath, 'out', 'bin'),
  ]

  for (const p of pathsToCheck) {
    if (fs.existsSync(p)) return path.resolve(p)
  }

  return getBinFolderPath(path.join(baseDir, '..'))
}

/**
 * Recursively finds the bin folder path
 * @param baseDir the base path to the directory to check against
 * @returns
 *    - path to bin directory
 *    OR
 *    - recursively calls itself till path is found
 */
const getBinFolderPath = (baseDir: string): string => {
  if (!baseDir.endsWith('node_modules')) {
    if (fs.readdirSync(baseDir).includes('node_modules')) {
      return checkForBinPath(baseDir)
    } else {
      return getBinFolderPath(path.join(baseDir, '..'))
    }
  } else {
    return checkForBinPath(baseDir.replace('node_modules', ''))
  }
}

/**
 * Execute the server
 * @param args arguments to pass to the server
 * @returns {Promise<ChildProcess>} server process
 */
async function executeServer(args: string[]): Promise<ChildProcess> {
  const serverScript = path.join(
    getBinFolderPath(path.resolve(__dirname)),
    os.platform() === 'win32' && !process.env.SHELL?.includes('bash')
      ? 'omega-edit-grpc-server.bat'
      : 'omega-edit-grpc-server'
  )

  fs.chmodSync(serverScript, '755')

  const serverProcess: ChildProcess = spawn(serverScript, args, {
    cwd: path.dirname(serverScript),
    detached: true,
    shell: os.platform().startsWith('win'), // use shell on Windows because it can't execute scripts directly
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true, // avoid showing a console window
  })

  serverProcess.on('error', (err: Error) => {
    // ignore the error if the process was cancelled
    if (!err.message.includes('Call cancelled')) throw err
  })

  return serverProcess
}

/**
 * Run the server
 * @param port port number
 * @param host hostname or IP address (default: 127.0.0.1)
 * @param pidfile resolved path to the PID file
 * @param logConf resolved path to a logback configuration file
 * @returns {Promise<ChildProcess>} server process
 */
export async function runServer(
  port: number,
  host: string = '127.0.0.1',
  pidfile?: string,
  logConf?: string
): Promise<ChildProcess> {
  // NOTE: Do not wrap args with double quotes, this causes issues when being
  // passed to the script

  const args: string[] = [`--interface=${host}`, `--port=${port}`]

  if (pidfile) {
    args.push(`--pidfile=${pidfile}`)
  }

  if (logConf && fs.existsSync(logConf)) {
    args.push(`-Dlogback.configurationFile=${logConf}`)
  }

  return await executeServer(args)
}

/**
 * Run the server with custom CLI args (e.g., UDS-only mode).
 * @param args arguments to pass to the server
 * @returns {Promise<ChildProcess>} server process
 */
export async function runServerWithArgs(args: string[]): Promise<ChildProcess> {
  return await executeServer(args)
}
