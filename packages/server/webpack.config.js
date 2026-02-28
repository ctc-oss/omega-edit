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

// Look for the C++ server binary in several possible locations
function findServerBinary() {
  const searchPaths = [
    path.resolve('../../server/cpp/build', serverBinaryName),
    path.resolve('../../server/cpp/build/Release', serverBinaryName),
    path.resolve('../../server/cpp/build/Debug', serverBinaryName),
    path.resolve('../../_build/server/cpp', serverBinaryName),
    path.resolve('../../build/server/cpp', serverBinaryName),
    path.resolve('../../build/server/cpp/Release', serverBinaryName),
    // Environment variable override
    process.env.CPP_SERVER_BINARY || '',
  ].filter(Boolean)

  for (const p of searchPaths) {
    if (fs.existsSync(p)) return p
  }
  return null
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
    const libPath = path.join(oeLibDir, pattern)
    if (fs.existsSync(libPath)) return libPath
    // Also check lib subdirectory
    const libSubPath = path.join(oeLibDir, 'lib', pattern)
    if (fs.existsSync(libSubPath)) return libSubPath
  }
  return null
}

// Look for the magic.mgc database file
function findMagicDatabase() {
  const searchPaths = [
    process.env.MAGIC_MGC_PATH || '',
    path.resolve('../../server/cpp/build/magic.mgc'),
    // vcpkg installed locations
    process.env.VCPKG_INSTALLED_DIR
      ? path.join(process.env.VCPKG_INSTALLED_DIR, 'share', 'libmagic', 'misc', 'magic.mgc')
      : '',
    // Common system locations
    '/usr/share/misc/magic.mgc',
    '/usr/share/file/magic.mgc',
  ].filter(Boolean)

  for (const p of searchPaths) {
    if (fs.existsSync(p)) return p
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
      // Copy C++ server binary and shared library into out/bin
      apply: (compiler) => {
        compiler.hooks.done.tap('copyCppServerBinary', async () => {
          const binDir = path.resolve('out/bin')
          fs.mkdirSync(binDir, { recursive: true })

          const serverBinary = findServerBinary()
          if (serverBinary) {
            const destBinary = path.join(binDir, serverBinaryName)
            fs.copyFileSync(serverBinary, destBinary)
            if (!isWin) {
              fs.chmodSync(destBinary, '755')
            }
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

          const sharedLib = findSharedLibrary()
          if (sharedLib) {
            const destLib = path.join(binDir, path.basename(sharedLib))
            fs.copyFileSync(sharedLib, destLib)
            console.log(`Copied shared library: ${sharedLib} -> ${destLib}`)
          }

          const magicDb = findMagicDatabase()
          if (magicDb) {
            const destMagic = path.join(binDir, 'magic.mgc')
            fs.copyFileSync(magicDb, destMagic)
            console.log(`Copied magic database: ${magicDb} -> ${destMagic}`)
          } else {
            console.warn(
              'WARNING: magic.mgc database not found. Content type detection may not work at runtime.'
            )
          }
          // NOTE: shared library is optional; when the C++ server is statically
          // linked against the core library, no shared lib is needed at runtime.
        })
      },
    },
  ],
}
