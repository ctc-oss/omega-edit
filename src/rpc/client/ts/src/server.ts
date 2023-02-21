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

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as child_process from 'child_process'
import { logger } from './client'

/**
 * Artifact class*
 */
class Artifact {
  // Name of the artifact
  name: string
  // Artifact archive
  archive: string
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
    this.archive = `${baseScriptName}-${version}.zip`
    this.scriptName =
      os.platform() === 'win32' ? `${baseScriptName}.bat` : baseScriptName

    // build the path to the script
    this.scriptDir = path.join(rootPath, `${baseScriptName}-${version}`, 'bin')
    this.scriptPath = path.join(this.scriptDir, this.scriptName)
  }
}

/**
 * Extract a zip file to a directory
 * @param zipFilePath path to the zip file
 * @param extractPath path to extract the zip file to
 */
function unzipFileSync(zipFilePath: string, extractPath: string) {
  logger.debug({
    fn: 'unzipFileSync',
    state: 'begin',
    src: zipFilePath,
    dst: extractPath,
  })
  // Ensure that the destination directory exists
  if (!fs.existsSync(extractPath)) {
    fs.mkdirSync(extractPath, { recursive: true })
  }
  // Extract the zip file to the destination directory
  const AdmZip = require('adm-zip')
  new AdmZip(zipFilePath).extractAllTo(extractPath, true)
  logger.debug({
    fn: 'unzipFileSync',
    state: 'end',
    src: zipFilePath,
    dst: extractPath,
  })
}

function addExecutableBitToFile(filePath: string): void {
  const stats = fs.statSync(filePath)
  if (stats.isFile()) {
    fs.chmodSync(filePath, stats.mode | 0o111)
    logger.debug({
      fn: 'addExecutableBitToFile',
      msg: `executable bit added to file '${filePath}'`,
    })
  }
}

function addExecutableBitToFiles(directoryPath: string): void {
  // Add the executable bit to each file in the directory
  logger.debug({
    fn: 'addExecutableBitToFiles',
    msg: `Adding executable bit to files in directory '${directoryPath}'`,
  })
  fs.readdirSync(directoryPath).map((file: string) => {
    addExecutableBitToFile(path.join(directoryPath, file))
  })
}

export async function prepareServer(
  server: string,
  rootPath: string,
  version: string,
  packagePath: string
): Promise<Artifact> {
  // Create omega-edit server artifact
  const artifact = new Artifact(server, version, rootPath)
  logger.debug({
    fn: 'prepareServer',
    artifact: {
      name: artifact.name,
      archive: artifact.archive,
      scriptName: artifact.scriptName,
      scriptPath: artifact.scriptPath,
      scriptDir: artifact.scriptDir,
    },
  })
  logger.debug(`creating root path '${artifact.rootPath}' if it does not exist`)
  if (!fs.existsSync(artifact.rootPath)) {
    fs.mkdirSync(artifact.rootPath, { recursive: true })
  }

  logger.debug(`checking to see if '${artifact.scriptDir}' exists`)
  if (!fs.existsSync(artifact.scriptDir)) {
    /*
     * The conditional of filePath is to ensure this will work locally for testing
     * but will also work inside other projects that use the omega-edit node package.
     */
    const filePath = fs.existsSync(path.join(__dirname, artifact.archive))
      ? path.join(__dirname, artifact.archive)
      : path.join(packagePath, artifact.archive)

    if (!fs.existsSync(filePath)) {
      return new Promise((_, reject) => {
        reject(`Error server artifact not found at ${filePath}`)
      })
    }

    logger.debug(
      `unzipping server artifact ${artifact.archive} to ${artifact.rootPath}`
    )
    // Unzip server archive file
    unzipFileSync(artifact.archive, artifact.rootPath)
    logger.debug(
      `unzipping server artifact ${artifact.archive} to ${artifact.rootPath} DONE!`
    )

    // Add the executable bit to the files in the bin directory
    addExecutableBitToFiles(artifact.scriptDir)
  }

  return artifact
}

export async function startServer(
  rootPath: string,
  version: string,
  packagePath: string,
  port: number = 9000,
  host: string = '127.0.0.1'
): Promise<number | undefined> {
  // Set up the server
  logger.debug({
    fn: 'startServer',
    version: version,
    rootPath: rootPath,
    pkgPath: packagePath,
    port: port,
  })
  const artifact = await prepareServer(
    'omega-edit-grpc-server',
    rootPath,
    version,
    packagePath
  )

  // Start the server
  logger.debug(
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
  logger.debug(
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
      logger.debug({
        fn: 'startServer',
        host: host,
        port: port,
        pid: server.pid,
      })
      resolve(server.pid)
    } else {
      logger.error({
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

export function stopServer(pid: number | undefined): boolean {
  if (pid) {
    logger.debug({ fn: 'stopServer', pid: pid })
    return process.kill(pid, 'SIGTERM')
  }

  logger.error({
    fn: 'stopServer',
    err: { msg: 'Error stopping server, no PID' },
  })
  return false
}
