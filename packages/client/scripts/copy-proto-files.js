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

const srcDir = path.join(__dirname, '..', 'src')
const distDirs = [
  path.join(__dirname, '..', 'dist', 'esm'),
  path.join(__dirname, '..', 'dist', 'cjs'),
]

// Proto-generated files to copy
const protoFiles = [
  'omega_edit_pb.js',
  'omega_edit_pb.d.ts',
  'omega_edit_grpc_pb.js',
  'omega_edit_grpc_pb.d.ts',
]

distDirs.forEach((distDir) => {
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true })
  }

  protoFiles.forEach((file) => {
    const srcPath = path.join(srcDir, file)
    const destPath = path.join(distDir, file)

    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath)
      console.log(`Copied ${file} to ${path.relative(process.cwd(), destPath)}`)
    } else {
      console.warn(`Warning: ${file} not found in src directory`)
    }
  })
})

console.log('Proto files copied successfully')
