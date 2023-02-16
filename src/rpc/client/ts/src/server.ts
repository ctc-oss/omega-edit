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
import * as unzip from 'unzip-stream'
import * as os from 'os'
import * as child_process from 'child_process'

class Artifact {
  name: string
  archive: string
  scriptName: string

  constructor(
    readonly type: string,
    readonly version: string,
    readonly baseScriptName
  ) {
    this.name = `${type}-${this.version}`
    this.archive = `${this.name}.zip`
    this.scriptName =
      os.platform() === 'win32'
        ? `${baseScriptName}.bat`
        : `./${baseScriptName}`
  }
}


async function unzipFile(zipFilePath: string, extractPath: string) {
  return await new Promise((resolve, reject) => {
    let stream = fs
      .createReadStream(zipFilePath)
      .pipe(unzip.Extract({ path: `${extractPath}` }))
    stream.on('close', () => {
      try {
        resolve(zipFilePath)
      } catch (err) {
        reject(err)
      }
    })
  })
}

export async function setupServer(
  rootPath: string,
  omegaEditVersion: string,
  packagePath: string
): Promise<[string, string]> {
  const artifact = new Artifact(
    'omega-edit-grpc-server',
    omegaEditVersion,
    'omega-edit-grpc-server'
  )

  if (!fs.existsSync(rootPath)) {
    fs.mkdirSync(rootPath, { recursive: true })
  }

  if (!fs.existsSync(`${rootPath}/${artifact.name}`)) {
    /*
     * The conditional of filePath is to ensure this will work locally for testing
     * but will also work inside of other projects that use the omega-edit node
     * package.
     */
    const filePath = fs.existsSync(path.join(__dirname, artifact.archive))
      ? path.join(__dirname, artifact.archive)
      : path.join(packagePath, artifact.archive)

    if (!fs.existsSync(filePath)) {
      return new Promise((_, reject) => {
        reject(`Error omega-edit artifact not found at ${filePath}`)
      })
    }

    // Unzip file and remove zip
    await unzipFile(filePath, rootPath)
  }

  const scriptPath = `${rootPath}/omega-edit-grpc-server-${omegaEditVersion}`

  if (!os.platform().toLowerCase().startsWith('win')) {
    child_process.execSync(
      `chmod +x ${scriptPath.replace(
        ' ',
        '\\ '
      )}/bin/${artifact.scriptName.replace('./', '')}`
    )
  }

  return [artifact.scriptName, scriptPath]
}

export async function startServer(
  rootPath: string,
  omegaEditVersion: string,
  packagePath: string
): Promise<number | undefined> {
  const [scriptName, scriptPath] = await setupServer(
    rootPath,
    omegaEditVersion,
    packagePath
  )

  let server = child_process.spawn(scriptName, [], {
    cwd: `${scriptPath}/bin`,
    detached: true,
  })

  const wait_port = require('wait-port')
  await wait_port({ host: '127.0.0.1', port: 9000, output: 'silent' })

  return new Promise((resolve, reject) => {
    if (server !== null) {
      resolve(server.pid)
    } else {
      reject('Error getting server pid')
    }
  })
}

export async function stopServer(pid: number | undefined): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (pid) {
      if (os.platform() === 'win32') {
        child_process.execSync(`taskkill /F /T /PID ${pid}`)
        resolve(true)
      } else {
        child_process.execSync(`kill -9 ${pid} 2>&1 || echo 0`)
        resolve(true)
      }
    }

    reject('Error stopping omega-edit server, bad pid')
  })
}
