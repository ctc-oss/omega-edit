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

const path = require('path')
const CopyPlugin = require('copy-webpack-plugin')
const fs = require('fs')

// Determine the C++ server binary name based on platform
const isWin = process.platform === 'win32'
const serverBinaryName = isWin
  ? 'omega-edit-grpc-server.exe'
  : 'omega-edit-grpc-server'
const transformPluginHostBinaryName = isWin
  ? 'omega-transform-plugin-host.exe'
  : 'omega-transform-plugin-host'

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
  if (!directory || !fs.existsSync(directory)) return false
  if (!fs.statSync(directory).isDirectory()) return false

  const extensions = getTransformPluginExtensions()
  return fs
    .readdirSync(directory)
    .some(
      (file) =>
        file.startsWith('omega_transform_') &&
        extensions.some((extension) => file.endsWith(extension))
    )
}

function splitPathList(value) {
  return (value || '')
    .split(path.delimiter)
    .map((directory) => directory.trim())
    .filter(Boolean)
}

// Look for the C++ server binary in several possible locations
function findServerBinary() {
  const searchPaths = [
    // Environment variable override
    process.env.CPP_SERVER_BINARY || '',
    path.resolve('../../server/cpp/build', serverBinaryName),
    path.resolve('../../server/cpp/build/Release', serverBinaryName),
    path.resolve('../../server/cpp/build/Debug', serverBinaryName),
    path.resolve('../../_build/server/cpp', serverBinaryName),
    path.resolve('../../build/server/cpp', serverBinaryName),
    path.resolve('../../build/server/cpp/Release', serverBinaryName),
  ].filter(Boolean)

  for (const p of searchPaths) {
    const normalized = normalizeWindowsPath(p)
    if (fs.existsSync(normalized)) return normalized
  }
  return null
}

function findTransformPluginHostBinary() {
  const searchPaths = [
    process.env.CPP_TRANSFORM_PLUGIN_HOST_BINARY || '',
    process.env.OMEGA_EDIT_TRANSFORM_PLUGIN_HOST || '',
    path.resolve('../../_build_core/core', transformPluginHostBinaryName),
    path.resolve('../../server/cpp/build', transformPluginHostBinaryName),
    path.resolve(
      '../../server/cpp/build/Release',
      transformPluginHostBinaryName
    ),
    path.resolve('../../server/cpp/build/Debug', transformPluginHostBinaryName),
    path.resolve('../../_build/core', transformPluginHostBinaryName),
    path.resolve('../../_build-codex/core', transformPluginHostBinaryName),
    path.resolve(
      '../../build-shared-Debug/core',
      transformPluginHostBinaryName
    ),
    path.resolve(
      '../../build-shared-Release/core',
      transformPluginHostBinaryName
    ),
    path.resolve(
      '../../build-shared-RelWithDebInfo/core',
      transformPluginHostBinaryName
    ),
  ].filter(Boolean)

  for (const p of searchPaths) {
    const normalized = normalizeWindowsPath(p)
    if (fs.existsSync(normalized)) return normalized
  }
  return null
}

function findTransformPluginDirectory(platformId) {
  const candidates = [
    ...splitPathList(process.env.OMEGA_EDIT_TRANSFORM_PLUGIN_DIRS),
    ...splitPathList(process.env.OMEGA_EDIT_TRANSFORM_PLUGINS_DIR),
    ...splitPathList(process.env.OMEGA_EDIT_TEST_PLUGIN_DIR),
    path.resolve('../../.codex-tmp/native-core-build/core/src/tests/plugins'),
    path.resolve('../../_build_core/plugins/plugins'),
    path.resolve('../../_build_core/core/src/tests/plugins'),
    path.resolve('../../_build/plugins/plugins'),
    path.resolve('../../build/core/src/tests/plugins'),
    path.resolve('../../build-coverage/core/src/tests/plugins'),
    path.resolve('../../build-shared-Debug/core/src/tests/plugins'),
    path.resolve('../../build-shared-Release/core/src/tests/plugins'),
    path.resolve('../../build-shared-RelWithDebInfo/core/src/tests/plugins'),
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

function copyTransformPlugins(outputPath) {
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
  const destDir = path.resolve(outputPath, 'transform-plugins', platformId)
  fs.rmSync(destDir, { recursive: true, force: true })
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
    fs.copyFileSync(src, dest)
    if (!plugin.endsWith('.dll')) {
      fs.chmodSync(dest, 0o755)
    }
  }
  const magicDb = path.join(sourceDir, 'magic.mgc')
  if (fs.existsSync(magicDb) && fs.statSync(magicDb).isFile()) {
    fs.copyFileSync(magicDb, path.join(destDir, 'magic.mgc'))
  }
  console.log(
    `Copied ${plugins.length} transform plugin(s): ${sourceDir} -> ${destDir}`
  )
}

// Find the omega_edit shared library
function findSharedLibrary() {
  const oeLibDir = process.env.OE_LIB_DIR || path.resolve('../../_install')
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

module.exports = {
  entry: './src/index.ts',
  devtool: 'source-map',
  target: 'node',
  output: {
    path: path.resolve(__dirname, 'out'),
    filename: 'index.js',
    libraryTarget: 'commonjs2',
    clean: true, // makes sure the output directory is remade
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules|test|omega-edit-grpc-server/,
        use: {
          loader: 'ts-loader',
        },
      },
    ],
  },
  plugins: [
    new CopyPlugin({
      patterns: ['README.md'],
    }),
    {
      // Copy C++ server binary/binaries and shared library into out/bin.
      // Supports two modes:
      //   1. CPP_SERVER_BINARIES_DIR: copy ALL files from this directory (universal/release builds)
      //   2. Single-platform: find the binary for the host platform (local dev / CI test)
      apply: (compiler) => {
        compiler.hooks.done.tap('copyCppServerBinary', () => {
          const binDir = path.resolve(compiler.options.output.path, 'bin')
          fs.mkdirSync(binDir, { recursive: true })

          const binariesDir = process.env.CPP_SERVER_BINARIES_DIR
          if (binariesDir && fs.existsSync(binariesDir)) {
            // Universal mode: copy every file from the binaries directory
            const files = fs.readdirSync(binariesDir)
            if (files.length === 0) {
              throw new Error(
                `CPP_SERVER_BINARIES_DIR (${binariesDir}) is empty.`
              )
            }
            for (const file of files) {
              const src = path.join(binariesDir, file)
              if (!fs.statSync(src).isFile()) continue
              const dest = path.join(binDir, file)
              fs.copyFileSync(src, dest)
              if (!file.endsWith('.exe') && !file.endsWith('.dll')) {
                fs.chmodSync(dest, 0o755)
              }
              console.log(`Copied: ${src} -> ${dest}`)
            }
          } else {
            // Single-platform mode: find binary for the current host
            const serverBinary = findServerBinary()
            if (serverBinary) {
              const destBinary = path.join(binDir, serverBinaryName)
              fs.copyFileSync(serverBinary, destBinary)
              if (!isWin) {
                fs.chmodSync(destBinary, 0o755)
              }
              console.log(
                `Copied C++ server binary: ${serverBinary} -> ${destBinary}`
              )
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
              const destBinary = path.join(
                binDir,
                transformPluginHostBinaryName
              )
              fs.copyFileSync(transformPluginHostBinary, destBinary)
              if (!isWin) {
                fs.chmodSync(destBinary, 0o755)
              }
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
              fs.copyFileSync(sharedLib, destLib)
              console.log(`Copied shared library: ${sharedLib} -> ${destLib}`)
            }
          }
          // NOTE: shared library is optional; when the C++ server is statically
          // linked against the core library, no shared lib is needed at runtime.
          copyTransformPlugins(compiler.options.output.path)
        })
      },
    },
  ],
}
