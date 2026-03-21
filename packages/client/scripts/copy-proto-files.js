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

// Proto-generated files/directories to copy
const protoEntries = ['omega_edit']

distDirs.forEach((distDir) => {
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true })
  }

  protoEntries.forEach((entry) => {
    const srcPath = path.join(srcDir, entry)
    const destPath = path.join(distDir, entry)

    if (fs.existsSync(srcPath)) {
      const stats = fs.statSync(srcPath)

      if (stats.isDirectory()) {
        fs.cpSync(srcPath, destPath, { recursive: true })
      } else {
        fs.copyFileSync(srcPath, destPath)
      }

      console.log(
        `Copied ${entry} to ${path.relative(process.cwd(), destPath)}`
      )
    } else {
      console.warn(`Warning: ${entry} not found in src directory`)
    }
  })
})

console.log('Proto files copied successfully')
