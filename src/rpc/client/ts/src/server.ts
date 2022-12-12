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

// const xdgAppPaths = XDGAppPaths({ name: 'omega_edit' })
const wait_port = require('wait-port')

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

export async function startServer(
  rootPath: string,
  omegaEditVersion: string
): Promise<number | undefined> {
  const artifact = new Artifact(
    'omega-edit-scala-server',
    omegaEditVersion,
    'omega-edit-grpc-server'
  )

  // let rootPath = xdgAppPaths.data()

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
      : path.join(process.cwd(), 'node_modules/omega-edit', artifact.archive)

    if (!fs.existsSync(filePath)) {
      return new Promise((_, reject) => {
        reject('Error omega-edit artifact not found')
      })
    }

    // Unzip file and remove zip
    await unzipFile(filePath, rootPath)
  }

  const scriptPath = `${rootPath}/omega-edit-scala-server-${omegaEditVersion}`

  if (!os.platform().toLowerCase().startsWith('win')) {
    child_process.execSync(
      `chmod +x ${scriptPath.replace(
        ' ',
        '\\ '
      )}/bin/${artifact.scriptName.replace('./', '')}`
    )
  }

  let server = child_process.spawn(artifact.scriptName, [], {
    cwd: `${scriptPath}/bin`,
    detached: true,
  })

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
