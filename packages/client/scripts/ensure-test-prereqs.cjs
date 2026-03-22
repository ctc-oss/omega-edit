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

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const packageRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(packageRoot, '..', '..')
const distCjsIndex = path.join(packageRoot, 'dist', 'cjs', 'index.js')
const distEsmIndex = path.join(packageRoot, 'dist', 'esm', 'index.js')
const clientBuildInputs = [
  path.join(packageRoot, 'package.json'),
  path.join(packageRoot, 'tsconfig.cjs.json'),
  path.join(packageRoot, 'tsconfig.esm.json'),
  path.join(packageRoot, 'scripts', 'generate-protobuf.js'),
  path.join(packageRoot, 'scripts', 'generate-version.js'),
  path.join(packageRoot, 'src'),
  path.join(repoRoot, 'scripts', 'write-dist-package-jsons.js'),
]

function resolveYarnCommand() {
  if (process.platform !== 'win32') {
    return {
      command: 'yarn',
      args: [],
    }
  }

  const whereResult = spawnSync('where.exe', ['yarn.js'], {
    encoding: 'utf8',
    shell: false,
  })

  if (whereResult.error) {
    console.error(whereResult.error)
    process.exit(1)
  }

  if (whereResult.status !== 0) {
    console.error(whereResult.stderr || 'Unable to locate yarn.js')
    process.exit(whereResult.status ?? 1)
  }

  const yarnCliPath = whereResult.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0)

  if (!yarnCliPath) {
    console.error('Unable to locate yarn.js')
    process.exit(1)
  }

  return {
    command: process.execPath,
    args: [yarnCliPath],
  }
}

function run(command, args, cwd) {
  const resolvedCommand =
    command === 'yarn' ? resolveYarnCommand() : { command, args: [] }
  const result = spawnSync(
    resolvedCommand.command,
    [...resolvedCommand.args, ...args],
    {
      cwd,
      stdio: 'inherit',
      shell: false,
    }
  )

  if (result.error) {
    console.error(result.error)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function getEntryMtimeMs(entryPath) {
  if (!fs.existsSync(entryPath)) {
    return 0
  }

  const stat = fs.statSync(entryPath)
  if (!stat.isDirectory()) {
    return stat.mtimeMs
  }

  let latestMtimeMs = stat.mtimeMs
  for (const entry of fs.readdirSync(entryPath)) {
    latestMtimeMs = Math.max(
      latestMtimeMs,
      getEntryMtimeMs(path.join(entryPath, entry))
    )
  }

  return latestMtimeMs
}

function shouldBuildClientDist() {
  if (!fs.existsSync(distCjsIndex) || !fs.existsSync(distEsmIndex)) {
    return true
  }

  const latestInputMtimeMs = Math.max(
    ...clientBuildInputs.map((entryPath) => getEntryMtimeMs(entryPath))
  )
  const oldestOutputMtimeMs = Math.min(
    getEntryMtimeMs(distCjsIndex),
    getEntryMtimeMs(distEsmIndex)
  )

  return latestInputMtimeMs > oldestOutputMtimeMs
}

if (shouldBuildClientDist()) {
  run('yarn', ['build'], packageRoot)
}

run(process.execPath, ['scripts/ensure-server-prepackaged.js'], packageRoot)
