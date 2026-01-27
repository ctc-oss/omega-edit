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

const repoRoot = path.resolve(__dirname, '..', '..', '..')

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function tryStat(filePath) {
  try {
    return fs.statSync(filePath)
  } catch {
    return null
  }
}

function latestMtimeUnder(dirPath) {
  const stat = tryStat(dirPath)
  if (!stat) return 0
  if (!stat.isDirectory()) return stat.mtimeMs

  let latest = stat.mtimeMs
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const child = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      latest = Math.max(latest, latestMtimeUnder(child))
    } else if (entry.isFile()) {
      const s = tryStat(child)
      if (s) latest = Math.max(latest, s.mtimeMs)
    }
  }
  return latest
}

function loadJson(filePath) {
  try {
    return JSON.parse(readText(filePath))
  } catch {
    return null
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function main() {
  const versionFile = path.join(repoRoot, 'VERSION')
  const expectedVersion = readText(versionFile).trim()

  const serverOutDir = path.join(repoRoot, 'packages', 'server', 'out')
  const serverOutBin = path.join(serverOutDir, 'bin', 'omega-edit-grpc-server')
  const serverOutBat = path.join(
    serverOutDir,
    'bin',
    'omega-edit-grpc-server.bat'
  )
  const serverOutEntry = tryStat(serverOutBin) ? serverOutBin : serverOutBat

  const markerFile = path.join(serverOutDir, '.prepackage-stamp.json')
  const marker = loadJson(markerFile)

  const inputs = [
    versionFile,
    path.join(repoRoot, 'proto', 'omega_edit.proto'),
    path.join(repoRoot, 'server', 'scala', 'build.sbt'),
    path.join(repoRoot, 'server', 'scala', 'project'),
    path.join(repoRoot, 'server', 'scala', 'api', 'src', 'main'),
    path.join(repoRoot, 'server', 'scala', 'spi', 'src', 'main'),
    path.join(repoRoot, 'server', 'scala', 'native', 'src', 'main'),
    path.join(repoRoot, 'server', 'scala', 'serv', 'src', 'main'),
  ]

  const latestInputMtime = inputs.reduce(
    (acc, p) => Math.max(acc, latestMtimeUnder(p)),
    0
  )

  const outStat = serverOutEntry ? tryStat(serverOutEntry) : null
  const outMtime = outStat ? outStat.mtimeMs : 0

  const isUpToDate =
    marker &&
    marker.version === expectedVersion &&
    outMtime !== 0 &&
    outMtime >= latestInputMtime

  if (isUpToDate) {
    process.stdout.write(
      `@omega-edit/client: server prepackage up-to-date (v${expectedVersion})\n`
    )
    return
  }

  process.stdout.write(
    `@omega-edit/client: refreshing server prepackage (expected v${expectedVersion})\n`
  )

  const result = spawnSync(
    process.platform === 'win32' ? 'yarn.cmd' : 'yarn',
    ['workspace', '@omega-edit/server', 'prepackage'],
    { cwd: repoRoot, stdio: 'inherit' }
  )

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }

  const refreshedOutStat = serverOutEntry ? tryStat(serverOutEntry) : null
  ensureDir(serverOutDir)
  fs.writeFileSync(
    markerFile,
    JSON.stringify(
      {
        version: expectedVersion,
        latestInputMtime,
        refreshedAt: new Date().toISOString(),
        outMtime: refreshedOutStat ? refreshedOutStat.mtimeMs : null,
      },
      null,
      2
    ) + '\n'
  )
}

main()
