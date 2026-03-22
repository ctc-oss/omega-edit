#!/usr/bin/env node
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
const { execFileSync } = require('child_process')

const clientRoot = path.join(__dirname, '..')
const repoRoot = path.join(clientRoot, '..', '..')
const protoRoot = path.join(repoRoot, 'proto')
const protoFile = path.join(protoRoot, 'omega_edit', 'v1', 'omega_edit.proto')
const generatedRoot = path.join(clientRoot, 'src', 'protobuf_ts', 'generated')
const tempToolsRoot = path.join(clientRoot, 'out', 'protobuf-ts-tools')

function ensureExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`)
  }
}

function resolvePackagePath(packageName) {
  return path.dirname(
    require.resolve(`${packageName}/package.json`, {
      paths: [clientRoot, repoRoot],
    })
  )
}

function writePluginWrapper(pluginEntry) {
  fs.rmSync(tempToolsRoot, { recursive: true, force: true })
  fs.mkdirSync(tempToolsRoot, { recursive: true })

  const isWindows = process.platform === 'win32'
  const wrapperPath = path.join(
    tempToolsRoot,
    isWindows ? 'protoc-gen-protobuf-ts.cmd' : 'protoc-gen-protobuf-ts'
  )
  const content = isWindows
    ? `@ECHO OFF\r\n"${process.execPath}" "${pluginEntry}" %*\r\n`
    : `#!/bin/sh\n"${process.execPath}" "${pluginEntry}" "$@"\n`

  fs.writeFileSync(wrapperPath, content)

  if (!isWindows) {
    fs.chmodSync(wrapperPath, 0o755)
  }

  return wrapperPath
}

const grpcToolsEntry = require.resolve('grpc-tools/bin/protoc.js', {
  paths: [clientRoot, repoRoot],
})
const prettierEntry = require.resolve('prettier/bin/prettier.cjs', {
  paths: [clientRoot, repoRoot],
})
const protobufTsPluginRoot = resolvePackagePath('@protobuf-ts/plugin')
const protobufTsPluginEntry = path.join(
  protobufTsPluginRoot,
  'bin',
  'protoc-gen-ts'
)

ensureExists(protoFile, 'proto file')
ensureExists(grpcToolsEntry, 'grpc-tools protoc entry')
ensureExists(prettierEntry, 'prettier entry')
ensureExists(protobufTsPluginEntry, 'protobuf-ts plugin entry')

fs.rmSync(generatedRoot, { recursive: true, force: true })
fs.mkdirSync(generatedRoot, { recursive: true })

const pluginWrapper = writePluginWrapper(protobufTsPluginEntry)

const args = [
  grpcToolsEntry,
  '-I',
  protoRoot,
  `--plugin=protoc-gen-ts=${pluginWrapper}`,
  '--ts_out',
  generatedRoot,
  '--ts_opt',
  'client_grpc1,force_server_none,long_type_number',
  protoFile,
]

execFileSync(process.execPath, args, {
  cwd: clientRoot,
  stdio: 'inherit',
})

execFileSync(process.execPath, [prettierEntry, '--write', generatedRoot], {
  cwd: clientRoot,
  stdio: 'inherit',
})

console.log(
  `Generated protobuf-ts artifacts at ${path.relative(clientRoot, generatedRoot)}`
)
