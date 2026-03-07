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
const buildDir = path.join(repoRoot, 'server', 'cpp', 'build')
const isWin = process.platform === 'win32'
const binaryName = isWin
  ? 'omega-edit-grpc-server.exe'
  : 'omega-edit-grpc-server'

function tryStat(filePath) {
  try {
    return fs.statSync(filePath)
  } catch {
    return null
  }
}

function latestMtimeUnder(targetPath) {
  const stat = tryStat(targetPath)
  if (!stat) return 0
  if (!stat.isDirectory()) return stat.mtimeMs

  let latest = stat.mtimeMs
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    const childPath = path.join(targetPath, entry.name)
    latest = Math.max(latest, latestMtimeUnder(childPath))
  }
  return latest
}

function getCandidateBinaryPaths() {
  return [
    path.join(buildDir, binaryName),
    path.join(buildDir, 'Debug', binaryName),
    path.join(buildDir, 'Release', binaryName),
  ]
}

function findBuiltBinary() {
  for (const candidate of getCandidateBinaryPaths()) {
    if (tryStat(candidate)) return candidate
  }
  return null
}

function runCmakeBuild() {
  const result = spawnSync(
    'cmake',
    ['--build', buildDir, '--target', 'omega-edit-grpc-server'],
    {
      cwd: repoRoot,
      stdio: 'inherit',
    }
  )

  if (result.error) {
    process.stderr.write(
      `@omega-edit/server: failed to run cmake build: ${String(result.error)}\n`
    )
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function main() {
  if (process.env.CPP_SERVER_BINARY || process.env.CPP_SERVER_BINARIES_DIR) {
    return
  }

  const inputPaths = [
    path.join(repoRoot, 'server', 'cpp', 'CMakeLists.txt'),
    path.join(repoRoot, 'server', 'cpp', 'cmake'),
    path.join(repoRoot, 'server', 'cpp', 'src'),
    path.join(repoRoot, 'proto', 'omega_edit.proto'),
  ]
  const latestInputMtime = inputPaths.reduce(
    (latest, inputPath) => Math.max(latest, latestMtimeUnder(inputPath)),
    0
  )

  const builtBinary = findBuiltBinary()
  const builtBinaryStat = builtBinary ? tryStat(builtBinary) : null
  const needsBuild =
    !builtBinaryStat || builtBinaryStat.mtimeMs < latestInputMtime

  if (!needsBuild) {
    return
  }

  if (!tryStat(path.join(buildDir, 'CMakeCache.txt'))) {
    process.stderr.write(
      '@omega-edit/server: native C++ server build directory is not configured. Configure server/cpp/build before packaging the server.\n'
    )
    process.exit(1)
  }

  process.stdout.write(
    '@omega-edit/server: rebuilding native C++ server before packaging\n'
  )
  runCmakeBuild()

  if (!findBuiltBinary()) {
    process.stderr.write(
      '@omega-edit/server: native C++ server build completed without producing an executable.\n'
    )
    process.exit(1)
  }
}

main()
