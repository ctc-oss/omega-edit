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

const packageRoot = path.resolve(__dirname, '..')

const suiteConfig = {
  client: [
    '--timeout',
    '100000',
    '--slow',
    '50000',
    '--file',
    'tests/client-suite.ts',
    '--exclude',
    './tests/specs/server.spec.ts',
    './tests/specs/*.spec.ts',
    '--exit',
  ],
  lifecycle: [
    '--timeout',
    '50000',
    '--slow',
    '35000',
    './tests/specs/server.spec.ts',
    '--exit',
  ],
}

function runNodeScript(scriptPath, args = [], env = process.env) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: packageRoot,
    env,
    stdio: 'inherit',
    shell: false,
  })

  if (result.error) {
    console.error(result.error)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function parseArgs(argv) {
  const [suite, ...rest] = argv
  if (!suiteConfig[suite]) {
    console.error(
      `Unknown suite "${suite}". Expected one of: ${Object.keys(suiteConfig).join(', ')}`
    )
    process.exit(1)
  }

  let transport
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (arg === '--transport') {
      transport = rest[index + 1]
      index += 1
      continue
    }

    console.error(`Unknown argument "${arg}"`)
    process.exit(1)
  }

  return { suite, transport }
}

const { suite, transport } = parseArgs(process.argv.slice(2))
const env = {
  ...process.env,
}

if (transport) {
  env.OMEGA_EDIT_TEST_TRANSPORT = transport
}

runNodeScript(path.join(__dirname, 'ensure-test-prereqs.cjs'), [], env)

runNodeScript(
  require.resolve('mocha/bin/mocha.js'),
  [
    '--node-option',
    'import=./tests/register-ts-node-esm.mjs',
    ...suiteConfig[suite],
  ],
  env
)
