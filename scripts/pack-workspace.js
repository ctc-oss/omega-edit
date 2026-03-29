#!/usr/bin/env node
/*
 * Copyright (c) 2021 Concurrent Technologies Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
 * an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations under the License.
 */

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const packageRoot = process.cwd()
const packageJsonPath = path.join(packageRoot, 'package.json')
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))

const baseName = process.argv[2]
if (!baseName) {
  process.stderr.write(
    'Usage: node ../../scripts/pack-workspace.js <base-name>\n'
  )
  process.exit(1)
}

const version = String(packageJson.version || '').trim()
if (!version) {
  process.stderr.write(`No version found in ${packageJsonPath}\n`)
  process.exit(1)
}

const outputFile = `${baseName}-v${version}.tgz`
const npmExecPath = process.env.npm_execpath
const result = npmExecPath
  ? spawnSync(
      process.execPath,
      [npmExecPath, 'pack', '--filename', outputFile],
      {
        cwd: packageRoot,
        stdio: 'inherit',
      }
    )
  : spawnSync(
      process.platform === 'win32' ? 'yarn.cmd' : 'yarn',
      ['pack', '--filename', outputFile],
      {
        cwd: packageRoot,
        stdio: 'inherit',
      }
    )

if (result.error) {
  process.stderr.write(`Failed to run pack command: ${String(result.error)}\n`)
  process.exit(1)
}

process.exit(result.status ?? 0)
