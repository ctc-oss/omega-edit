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
const { spawnSync } = require('child_process')

const packageRoot = path.join(__dirname, '..')

const compile = spawnSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    '-p',
    path.join(packageRoot, 'tsconfig.scripts.esm.json'),
  ],
  {
    cwd: packageRoot,
    env: process.env,
    stdio: 'inherit',
  }
)

if (compile.error) {
  console.error(compile.error)
  process.exit(1)
}

if (compile.status !== 0) {
  process.exit(compile.status ?? 1)
}

const run = spawnSync(
  process.execPath,
  [
    path.join(packageRoot, 'out', 'scripts', 'benchmark-undo.js'),
    ...process.argv.slice(2),
  ],
  {
    cwd: packageRoot,
    env: process.env,
    stdio: 'inherit',
  }
)

if (run.error) {
  console.error(run.error)
  process.exit(1)
}

process.exit(run.status ?? 1)
