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

function getPackagedBinaryPath() {
  return path.join(repoRoot, 'packages', 'server', 'out', 'bin', binaryName)
}

function getWindowsVcVarsCandidates() {
  const candidates = []
  const env = process.env

  if (env.VSINSTALLDIR) {
    candidates.push(
      path.join(env.VSINSTALLDIR, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
    )
  }

  const installerVsWhere = path.join(
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe'
  )

  if (tryStat(installerVsWhere)) {
    const result = spawnSync(
      installerVsWhere,
      [
        '-latest',
        '-products',
        '*',
        '-requires',
        'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-property',
        'installationPath',
      ],
      {
        encoding: 'utf8',
      }
    )

    if (result.status === 0 && result.stdout) {
      const installPath = result.stdout.trim()
      if (installPath) {
        candidates.push(
          path.join(installPath, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
        )
      }
    }
  }

  for (const year of ['2022', '2019']) {
    for (const edition of [
      'Community',
      'Professional',
      'Enterprise',
      'BuildTools',
    ]) {
      candidates.push(
        path.join(
          'C:\\Program Files\\Microsoft Visual Studio',
          year,
          edition,
          'VC',
          'Auxiliary',
          'Build',
          'vcvars64.bat'
        )
      )
      candidates.push(
        path.join(
          'C:\\Program Files (x86)\\Microsoft Visual Studio',
          year,
          edition,
          'VC',
          'Auxiliary',
          'Build',
          'vcvars64.bat'
        )
      )
    }
  }

  return Array.from(new Set(candidates))
}

function findWindowsVcVars() {
  for (const candidate of getWindowsVcVarsCandidates()) {
    if (tryStat(candidate)) {
      return candidate
    }
  }
  return null
}

function runCmakeBuild() {
  if (isWin) {
    const vcvars64 = findWindowsVcVars()

    if (!vcvars64) {
      process.stderr.write(
        '@omega-edit/server: could not find vcvars64.bat; falling back to current environment.\n'
      )
    } else {
      const wrapperName = 'codex-vcvars-build.cmd'
      const wrapperPath = path.join(buildDir, wrapperName)
      fs.writeFileSync(
        wrapperPath,
        [
          '@echo off',
          'call "%~1" >nul',
          'if errorlevel 1 exit /b %errorlevel%',
          'cmake --build "%~2" --target omega-edit-grpc-server',
          'exit /b %errorlevel%',
          '',
        ].join('\r\n')
      )

      const result = spawnSync(
        'cmd.exe',
        ['/d', '/c', wrapperName, vcvars64, buildDir],
        {
          cwd: buildDir,
          stdio: 'inherit',
        }
      )

      if (result.error) {
        process.stderr.write(
          `@omega-edit/server: failed to run cmake build via vcvars64: ${String(
            result.error
          )}\n`
        )
        process.exit(1)
      }

      if (result.status !== 0) {
        process.exit(result.status ?? 1)
      }

      return
    }
  }

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

function parseJsonArray(text) {
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    if (!parsed) return []
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

function stopRunningPackagedBinaryIfNeeded() {
  if (!isWin) {
    return
  }

  const packagedBinary = getPackagedBinaryPath()
  const packagedStat = tryStat(packagedBinary)
  if (!packagedStat) {
    return
  }

  const packagedRealPath = fs.realpathSync.native(packagedBinary).toLowerCase()
  const psScript = [
    `Get-CimInstance Win32_Process -Filter "name = '${binaryName}'" |`,
    '  Select-Object ProcessId, ExecutablePath |',
    '  ConvertTo-Json -Compress',
  ].join(' ')
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', psScript],
    { encoding: 'utf8' }
  )

  if (result.error || result.status !== 0) {
    return
  }

  const processes = parseJsonArray(result.stdout)
  for (const proc of processes) {
    if (!proc || !proc.ExecutablePath || !proc.ProcessId) {
      continue
    }

    let processRealPath
    try {
      processRealPath = fs.realpathSync
        .native(proc.ExecutablePath)
        .toLowerCase()
    } catch {
      continue
    }

    if (processRealPath !== packagedRealPath) {
      continue
    }

    process.stdout.write(
      `@omega-edit/server: stopping stale packaged server process ${proc.ProcessId}\n`
    )
    const killResult = spawnSync(
      'taskkill.exe',
      ['/PID', String(proc.ProcessId), '/T', '/F'],
      { stdio: 'inherit' }
    )
    if (killResult.error) {
      process.stderr.write(
        `@omega-edit/server: failed to stop stale packaged server process ${proc.ProcessId}: ${String(
          killResult.error
        )}\n`
      )
      process.exit(1)
    }
    if (killResult.status !== 0) {
      process.exit(killResult.status ?? 1)
    }
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
    path.join(repoRoot, 'proto', 'omega_edit', 'v1', 'omega_edit.proto'),
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
    stopRunningPackagedBinaryIfNeeded()
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

  stopRunningPackagedBinaryIfNeeded()

  if (!findBuiltBinary()) {
    process.stderr.write(
      '@omega-edit/server: native C++ server build completed without producing an executable.\n'
    )
    process.exit(1)
  }
}

main()
