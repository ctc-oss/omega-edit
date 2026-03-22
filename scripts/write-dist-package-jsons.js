#!/usr/bin/env node
/*
 * Copyright (c) 2021 Concurrent Technologies Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
 * an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations under the License.
 */

const fs = require('fs')
const path = require('path')

const packageRoot = process.cwd()
const esmDir = path.join(packageRoot, 'dist', 'esm')
const targets = [
  {
    directory: esmDir,
    manifest: {
      type: 'module',
      main: './index.js',
      types: './index.d.ts',
    },
  },
  {
    directory: path.join(packageRoot, 'dist', 'cjs'),
    manifest: {
      type: 'commonjs',
      main: './index.js',
    },
  },
]

function shouldRewriteRelativeSpecifier(specifier) {
  if (!(specifier.startsWith('./') || specifier.startsWith('../'))) {
    return false
  }

  return !/\.(?:[cm]?js|json|node)$/i.test(specifier)
}

function rewriteModuleSpecifiers(sourceText) {
  const replaceSpecifier = (_match, prefix, specifier, suffix) => {
    if (!shouldRewriteRelativeSpecifier(specifier)) {
      return `${prefix}${specifier}${suffix}`
    }
    return `${prefix}${specifier}.js${suffix}`
  }

  return sourceText
    .replace(/(^\s*import\s+['"])(\.{1,2}\/[^'"]+)(['"]\s*;?)/gm, replaceSpecifier)
    .replace(/(\bfrom\s+['"])(\.{1,2}\/[^'"]+)(['"])/g, replaceSpecifier)
    .replace(/(\bimport\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\))/g, replaceSpecifier)
}

function rewriteEsmImportsRecursively(directory) {
  if (!fs.existsSync(directory)) {
    return
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      rewriteEsmImportsRecursively(entryPath)
      continue
    }

    if (!entry.isFile()) continue
    if (!entry.name.endsWith('.js') && !entry.name.endsWith('.d.ts')) continue

    const original = fs.readFileSync(entryPath, 'utf8')
    const rewritten = rewriteModuleSpecifiers(original)
    if (rewritten !== original) {
      fs.writeFileSync(entryPath, rewritten)
    }
  }
}

for (const target of targets) {
  fs.mkdirSync(target.directory, { recursive: true })
  fs.writeFileSync(
    path.join(target.directory, 'package.json'),
    `${JSON.stringify(target.manifest, null, 2)}\n`
  )
}

rewriteEsmImportsRecursively(esmDir)
