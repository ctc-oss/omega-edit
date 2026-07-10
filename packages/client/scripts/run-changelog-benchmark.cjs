/*
 * Licensed under the Apache License, Version 2.0.
 */

const path = require('node:path')
const { spawnSync } = require('node:child_process')

const packageRoot = path.join(__dirname, '..')
const compile = spawnSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    '-p',
    path.join(packageRoot, 'tsconfig.scripts.esm.json'),
  ],
  { cwd: packageRoot, env: process.env, stdio: 'inherit' }
)
if (compile.error) throw compile.error
if (compile.status !== 0) process.exit(compile.status ?? 1)

const run = spawnSync(
  process.execPath,
  [
    path.join(packageRoot, 'out', 'scripts', 'benchmark-changelog.js'),
    ...process.argv.slice(2),
  ],
  {
    cwd: path.join(packageRoot, '..', '..'),
    env: process.env,
    stdio: 'inherit',
  }
)
if (run.error) throw run.error
process.exit(run.status ?? 1)
