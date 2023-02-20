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

import { startServer, stopServer } from '../src/server'
import { ClientVersion } from '../src/version'
import * as fs from 'fs'

// prettier-ignore
// @ts-ignore
import { testPort } from "./specs/common"

const path = require('path')
const rootPath = path.resolve(__dirname, '..')

function getPidFile(port: number): string {
  return path.join(rootPath, `.test-server-${port}.pid`)
}

export async function mochaGlobalSetup(): Promise<number | undefined> {
  const pid = await startServer(rootPath, ClientVersion, rootPath, testPort)
  mochaGlobalTeardown()
  if (pid) {
    fs.writeFileSync(getPidFile(testPort), pid.toString(), 'utf8')
  }
  return pid
}

export function mochaGlobalTeardown(): boolean {
  const pidFile = getPidFile(testPort)
  if (fs.existsSync(pidFile)) {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').toString())
    fs.unlinkSync(pidFile)
    return stopServer(pid)
  }
  return false
}
