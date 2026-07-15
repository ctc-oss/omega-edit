#!/usr/bin/env node
/*
 * Copyright (c) 2021 Concurrent Technologies Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance
 * with the License. You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
 * an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations under the License.
 */

const fs = require('fs')
const { builtinModules } = require('module')
const path = require('path')
const esbuild = require('esbuild')

const extensionRoot = path.resolve(__dirname, '..')
const production = process.argv.includes('--production')

async function main() {
  const result = await esbuild.build({
    entryPoints: [path.join(extensionRoot, 'src', 'extension.ts')],
    outfile: path.join(extensionRoot, 'out', 'extension.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['vscode', '@omega-edit/server'],
    minify: production,
    sourcemap: production ? false : 'external',
    sourcesContent: false,
    metafile: true,
    logLevel: 'info',
  })

  const metadataPath = path.join(extensionRoot, 'out', 'extension.meta.json')
  fs.writeFileSync(metadataPath, `${JSON.stringify(result.metafile, null, 2)}\n`)

  const externalPackages = new Set()
  for (const output of Object.values(result.metafile.outputs)) {
    for (const imported of output.imports ?? []) {
      if (imported.external && !imported.path.startsWith('node:')) externalPackages.add(imported.path)
    }
  }
  const unexpected = [...externalPackages].filter(
    (packageName) =>
      packageName !== 'vscode' &&
      packageName !== '@omega-edit/server' &&
      !builtinModules.includes(packageName)
  )
  if (unexpected.length > 0) {
    throw new Error(`Unexpected external bundle imports: ${unexpected.join(', ')}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
