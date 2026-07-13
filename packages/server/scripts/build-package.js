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
const outputPath = path.join(packageRoot, 'out')
const isWin = process.platform === 'win32'
const serverBinaryName = isWin
  ? 'omega-edit-grpc-server.exe'
  : 'omega-edit-grpc-server'
const transformPluginHostBinaryName = isWin
  ? 'omega-transform-plugin-host.exe'
  : 'omega-transform-plugin-host'
const supportedTransformPluginPlatforms = [
  { id: 'linux-x64', extensions: ['.so'] },
  { id: 'linux-arm64', extensions: ['.so'] },
  { id: 'macos-x64', extensions: ['.dylib', '.so'] },
  { id: 'macos-arm64', extensions: ['.dylib', '.so'] },
  { id: 'windows-x64', extensions: ['.dll'] },
]

function normalizeWindowsPath(filePath) {
  if (process.platform !== 'win32') return filePath
  const msysPath = filePath.match(/^\/([a-zA-Z])\/(.*)$/)
  return msysPath
    ? `${msysPath[1]}:\\${msysPath[2].replace(/\//g, '\\')}`
    : filePath
}

function getTransformPluginPlatformId() {
  const arch = process.arch
  if (process.platform === 'linux' && (arch === 'x64' || arch === 'arm64')) {
    return `linux-${arch}`
  }
  if (process.platform === 'darwin' && (arch === 'x64' || arch === 'arm64')) {
    return `macos-${arch}`
  }
  if (process.platform === 'win32' && arch === 'x64') {
    return 'windows-x64'
  }
  return null
}

function getTransformPluginExtensions() {
  if (process.platform === 'win32') return ['.dll']
  if (process.platform === 'darwin') return ['.dylib', '.so']
  return ['.so']
}

function directoryHasTransformPlugin(directory) {
  const stat = tryStat(directory)
  if (!stat || !stat.isDirectory()) return false

  const extensions = getTransformPluginExtensions()
  return fs
    .readdirSync(directory)
    .some(
      (file) =>
        file.startsWith('omega_transform_') &&
        extensions.some((extension) => file.endsWith(extension))
    )
}

function tryStat(filePath) {
  if (!filePath) return null
  try {
    return fs.statSync(filePath)
  } catch {
    return null
  }
}

function splitPathList(value) {
  return (value || '')
    .split(path.delimiter)
    .map((directory) => directory.trim())
    .filter(Boolean)
}

function findServerBinary() {
  const searchPaths = [
    process.env.CPP_SERVER_BINARY || '',
    path.join(repoRoot, 'server', 'cpp', 'build', serverBinaryName),
    path.join(repoRoot, 'server', 'cpp', 'build', 'Release', serverBinaryName),
    path.join(repoRoot, 'server', 'cpp', 'build', 'Debug', serverBinaryName),
    path.join(repoRoot, '_build', 'server', 'cpp', serverBinaryName),
    path.join(repoRoot, 'build', 'server', 'cpp', serverBinaryName),
    path.join(repoRoot, 'build', 'server', 'cpp', 'Release', serverBinaryName),
  ].filter(Boolean)

  for (const candidate of searchPaths) {
    const normalized = normalizeWindowsPath(candidate)
    if (fs.existsSync(normalized)) return normalized
  }
  return null
}

function findTransformPluginHostBinary() {
  const searchPaths = [
    process.env.CPP_TRANSFORM_PLUGIN_HOST_BINARY || '',
    process.env.OMEGA_EDIT_TRANSFORM_PLUGIN_HOST || '',
    path.join(repoRoot, '_build_core', 'core', transformPluginHostBinaryName),
    path.join(
      repoRoot,
      'server',
      'cpp',
      'build',
      transformPluginHostBinaryName
    ),
    path.join(
      repoRoot,
      'server',
      'cpp',
      'build',
      'Release',
      transformPluginHostBinaryName
    ),
    path.join(
      repoRoot,
      'server',
      'cpp',
      'build',
      'Debug',
      transformPluginHostBinaryName
    ),
    path.join(repoRoot, '_build', 'core', transformPluginHostBinaryName),
    path.join(repoRoot, '_build-codex', 'core', transformPluginHostBinaryName),
    path.join(
      repoRoot,
      'build-shared-Debug',
      'core',
      transformPluginHostBinaryName
    ),
    path.join(
      repoRoot,
      'build-shared-Release',
      'core',
      transformPluginHostBinaryName
    ),
    path.join(
      repoRoot,
      'build-shared-RelWithDebInfo',
      'core',
      transformPluginHostBinaryName
    ),
  ].filter(Boolean)

  for (const candidate of searchPaths) {
    const normalized = normalizeWindowsPath(candidate)
    if (fs.existsSync(normalized)) return normalized
  }
  return null
}

function findTransformPluginDirectory(platformId) {
  const candidates = [
    ...splitPathList(process.env.OMEGA_EDIT_TRANSFORM_PLUGIN_DIRS),
    ...splitPathList(process.env.OMEGA_EDIT_TRANSFORM_PLUGINS_DIR),
    ...splitPathList(process.env.OMEGA_EDIT_TEST_PLUGIN_DIR),
    path.join(
      repoRoot,
      '.codex-tmp',
      'native-core-build',
      'core',
      'src',
      'tests',
      'plugins'
    ),
    path.join(repoRoot, '_build_core', 'plugins', 'plugins'),
    path.join(repoRoot, '_build_core', 'core', 'src', 'tests', 'plugins'),
    path.join(repoRoot, '_build', 'plugins', 'plugins'),
    path.join(repoRoot, 'build', 'core', 'src', 'tests', 'plugins'),
    path.join(repoRoot, 'build-coverage', 'core', 'src', 'tests', 'plugins'),
    path.join(
      repoRoot,
      'build-shared-Debug',
      'core',
      'src',
      'tests',
      'plugins'
    ),
    path.join(
      repoRoot,
      'build-shared-Release',
      'core',
      'src',
      'tests',
      'plugins'
    ),
    path.join(
      repoRoot,
      'build-shared-RelWithDebInfo',
      'core',
      'src',
      'tests',
      'plugins'
    ),
  ].filter(Boolean)

  for (const candidate of candidates) {
    const platformCandidate = path.join(candidate, platformId)
    if (directoryHasTransformPlugin(platformCandidate)) {
      return platformCandidate
    }
    if (directoryHasTransformPlugin(candidate)) {
      return candidate
    }
  }
  return null
}

function copyTransformPlugins() {
  const platformId = getTransformPluginPlatformId()
  if (!platformId) return

  const sourceDir = findTransformPluginDirectory(platformId)
  if (!sourceDir) {
    const message =
      'Transform plugin binaries not found. Set OMEGA_EDIT_TRANSFORM_PLUGINS_DIR or build the plugins first.'
    if (process.env.CI) {
      throw new Error(message)
    }
    console.warn(`WARNING: ${message}`)
    return
  }

  const extensions = getTransformPluginExtensions()
  const destDir = path.join(outputPath, 'transform-plugins', platformId)
  emptyDirectory(destDir)
  fs.mkdirSync(destDir, { recursive: true })

  const plugins = fs
    .readdirSync(sourceDir)
    .filter(
      (file) =>
        file.startsWith('omega_transform_') &&
        extensions.some((extension) => file.endsWith(extension))
    )
    .sort()

  for (const plugin of plugins) {
    const src = path.join(sourceDir, plugin)
    const dest = path.join(destDir, plugin)
    copyFileReplacing(src, dest, { executable: !plugin.endsWith('.dll') })
  }

  const magicDb = path.join(sourceDir, 'magic.mgc')
  if (fs.existsSync(magicDb) && fs.statSync(magicDb).isFile()) {
    copyFileReplacing(magicDb, path.join(destDir, 'magic.mgc'))
  }

  console.log(
    `Copied ${plugins.length} transform plugin(s): ${sourceDir} -> ${destDir}`
  )
}

function copyUniversalTransformPlugins() {
  const sourceRoots = [
    ...splitPathList(process.env.OMEGA_EDIT_TRANSFORM_PLUGIN_DIRS),
    ...splitPathList(process.env.OMEGA_EDIT_TRANSFORM_PLUGINS_DIR),
  ].map(normalizeWindowsPath)

  for (const platform of supportedTransformPluginPlatforms) {
    const sourceDir = sourceRoots
      .map((sourceRoot) => path.join(sourceRoot, platform.id))
      .find((candidate) => tryStat(candidate)?.isDirectory())
    if (!sourceDir) {
      throw new Error(
        `Transform plugin binaries for ${platform.id} not found. Set OMEGA_EDIT_TRANSFORM_PLUGINS_DIR to the universal plugin staging directory.`
      )
    }

    const plugins = fs
      .readdirSync(sourceDir)
      .filter(
        (file) =>
          file.startsWith('omega_transform_') &&
          platform.extensions.some((extension) => file.endsWith(extension))
      )
      .sort()
    if (plugins.length === 0) {
      throw new Error(`No transform plugins found for ${platform.id}`)
    }

    const destDir = path.join(outputPath, 'transform-plugins', platform.id)
    fs.mkdirSync(destDir, { recursive: true })
    for (const plugin of plugins) {
      copyFileReplacing(
        path.join(sourceDir, plugin),
        path.join(destDir, plugin),
        {
          executable: !plugin.endsWith('.dll'),
        }
      )
    }

    const magicDb = path.join(sourceDir, 'magic.mgc')
    if (tryStat(magicDb)?.isFile()) {
      copyFileReplacing(magicDb, path.join(destDir, 'magic.mgc'))
    }
    console.log(
      `Copied ${plugins.length} transform plugin(s) for ${platform.id}`
    )
  }
}

function findSharedLibrary() {
  const oeLibDir = process.env.OE_LIB_DIR || path.join(repoRoot, '_install')
  const libPatterns = isWin
    ? ['omega_edit.dll']
    : process.platform === 'darwin'
      ? ['libomega_edit.dylib']
      : ['libomega_edit.so']

  for (const pattern of libPatterns) {
    const searchPaths = [
      path.join(oeLibDir, pattern),
      path.join(oeLibDir, 'lib', pattern),
      path.join(oeLibDir, 'bin', pattern),
    ]

    for (const libPath of searchPaths) {
      if (fs.existsSync(libPath)) return libPath
    }
  }
  return null
}

function copyUniversalBinaries(binDir, binariesDir) {
  const files = fs.readdirSync(binariesDir)
  if (files.length === 0) {
    throw new Error(`CPP_SERVER_BINARIES_DIR (${binariesDir}) is empty.`)
  }

  for (const file of files) {
    const src = path.join(binariesDir, file)
    if (!fs.statSync(src).isFile()) continue
    const dest = path.join(binDir, file)
    copyFileReplacing(src, dest, {
      executable: !file.endsWith('.exe') && !file.endsWith('.dll'),
    })
    console.log(`Copied: ${src} -> ${dest}`)
  }
}

function copySinglePlatformBinaries(binDir) {
  const serverBinary = findServerBinary()
  if (serverBinary) {
    const destBinary = path.join(binDir, serverBinaryName)
    copyFileReplacing(serverBinary, destBinary, { executable: !isWin })
    console.log(`Copied C++ server binary: ${serverBinary} -> ${destBinary}`)
  } else if (process.env.CI) {
    throw new Error(
      'C++ server binary not found. Set CPP_SERVER_BINARY env var or build the server first.'
    )
  } else {
    console.warn(
      'WARNING: C++ server binary not found. Set CPP_SERVER_BINARY env var or build the server first.'
    )
  }

  const transformPluginHostBinary = findTransformPluginHostBinary()
  if (transformPluginHostBinary) {
    const destBinary = path.join(binDir, transformPluginHostBinaryName)
    copyFileReplacing(transformPluginHostBinary, destBinary, {
      executable: !isWin,
    })
    console.log(
      `Copied transform plugin host: ${transformPluginHostBinary} -> ${destBinary}`
    )
  } else if (process.env.CI) {
    throw new Error(
      'Transform plugin host binary not found. Set CPP_TRANSFORM_PLUGIN_HOST_BINARY env var or build the core first.'
    )
  } else {
    console.warn(
      'WARNING: Transform plugin host binary not found. Transform plugins require omega-transform-plugin-host.'
    )
  }

  const sharedLib = findSharedLibrary()
  if (sharedLib) {
    const destLib = path.join(binDir, path.basename(sharedLib))
    copyFileReplacing(sharedLib, destLib)
    console.log(`Copied shared library: ${sharedLib} -> ${destLib}`)
  }
}

function resolveTsc() {
  const packageJsonPath = require.resolve('typescript/package.json', {
    paths: [repoRoot],
  })
  const typescriptPackage = require(packageJsonPath)
  const binPath = typescriptPackage.bin && typescriptPackage.bin.tsc
  if (!binPath) {
    throw new Error('Unable to resolve TypeScript compiler entry point.')
  }
  return path.join(path.dirname(packageJsonPath), binPath)
}

function runTsc() {
  const result = spawnSync(
    process.execPath,
    [resolveTsc(), '-p', 'tsconfig.json'],
    {
      cwd: packageRoot,
      stdio: 'inherit',
    }
  )

  if (result.error) {
    process.stderr.write(
      `@omega-edit/server: failed to run TypeScript compiler: ${String(
        result.error
      )}\n`
    )
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function stagePackageFiles() {
  fs.copyFileSync(
    path.join(packageRoot, 'README.md'),
    path.join(outputPath, 'README.md')
  )

  const binDir = path.join(outputPath, 'bin')
  emptyDirectory(binDir)
  fs.mkdirSync(binDir, { recursive: true })

  const binariesDir = process.env.CPP_SERVER_BINARIES_DIR
  if (binariesDir && fs.existsSync(binariesDir)) {
    copyUniversalBinaries(binDir, binariesDir)
  } else {
    copySinglePlatformBinaries(binDir)
  }

  emptyDirectory(path.join(outputPath, 'transform-plugins'))
  if (binariesDir) {
    copyUniversalTransformPlugins()
  } else {
    copyTransformPlugins()
  }
}

function emptyDirectory(directory) {
  if (!fs.existsSync(directory)) return
  for (const entry of fs.readdirSync(directory)) {
    removeStaleArtifact(path.join(directory, entry))
  }
}

function copyFileReplacing(src, dest, options = {}) {
  const tempDest = path.join(
    path.dirname(dest),
    `.${path.basename(dest)}.${process.pid}.tmp`
  )

  try {
    fs.copyFileSync(src, tempDest)
    if (options.executable) {
      fs.chmodSync(tempDest, 0o755)
    }
    fs.renameSync(tempDest, dest)
  } catch (error) {
    removeStaleArtifact(tempDest)
    throw error
  }
}

function removeStaleArtifact(artifactPath) {
  try {
    fs.rmSync(artifactPath, { recursive: true, force: true })
  } catch (error) {
    if (process.env.CI) {
      throw error
    }
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.warn(
      `WARNING: Unable to remove stale packaged artifact ${artifactPath}: ${errorMessage}`
    )
  }
}

function cleanGeneratedOutput() {
  fs.mkdirSync(outputPath, { recursive: true })
  for (const file of [
    'README.md',
    'index.d.ts',
    'index.js',
    'index.js.map',
    '.prepackage-stamp.json',
  ]) {
    removeStaleArtifact(path.join(outputPath, file))
  }
}

function main() {
  cleanGeneratedOutput()
  runTsc()
  stagePackageFiles()
}

main()
