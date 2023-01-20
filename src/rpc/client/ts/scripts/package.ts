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

// @ts-nocheck <-- This is needed as this file is basically a JavaScript script
//                 but with some TypeScript niceness baked in
const fs = require('fs')
const path = require('path')
const glob = require('glob')
const execSync = require('child_process').execSync
const pkg_dir = 'dist/package'
const pkg_version = JSON.parse(fs.readFileSync('./package.json').toString())[
  'version'
]

async function copyGlob(pattern, destDir = pkg_dir, dir = '.') {
  glob(pattern, { cwd: dir }, (error, files) => {
    for (let i = 0; i < files.length; i++) {
      let src = path.join(dir, files[i])
      let dst = path.join(destDir, path.parse(files[i]).base)
      let dstDir = path.dirname(dst)

      fs.mkdirSync(dstDir, { recursive: true })

      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, dst)
      }
    }
  })
}

// Setup package directory
function setup() {
  if (fs.existsSync(pkg_dir)) {
    fs.rmSync(pkg_dir, { recursive: true, force: true })
  }

  fs.mkdirSync(pkg_dir, { recursive: true })

  await copyGlob('src/*.d.ts')
  await copyGlob('src/*.js')
  await copyGlob('out/*')

  const omegaEditServer = `omega-edit-server-${pkg_version}.zip`
  fs.copyFileSync(omegaEditServer, `${pkg_dir}/${omegaEditServer}`)
  fs.copyFileSync('yarn.lock', `${pkg_dir}/yarn.lock`)
  fs.copyFileSync('package.json', `${pkg_dir}/package.json`)
  fs.copyFileSync('.npmignore', `${pkg_dir}/.npmignore`)
  fs.copyFileSync('README.md', `${pkg_dir}/README.md`)
}

// Create package
function create() {
  execSync('yarn install', { cwd: pkg_dir })
  execSync(`yarn pack --cwd ${pkg_dir}`)
  const packageFile = `omega-edit-v${pkg_version}.tgz`
  fs.renameSync(path.join(pkg_dir, packageFile), packageFile)
}

module.exports = {
  setup: setup,
  create: create,
}
