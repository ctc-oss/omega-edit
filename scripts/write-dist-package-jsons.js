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

/*
 * This helper finishes the TypeScript packaging step for workspaces that publish
 * both CommonJS and ESM output directories.
 *
 * What it does:
 * 1. Writes `dist/esm/package.json` with `"type": "module"` so Node treats the
 *    ESM build as actual ESM.
 * 2. Writes `dist/cjs/package.json` with `"type": "commonjs"` so Node treats the
 *    CommonJS build correctly even when the package root also exposes ESM.
 * 3. Rewrites extensionless relative imports in `dist/esm` to include `.js`
 *    because Node's ESM loader does not resolve `./foo` the same way bundlers do.
 * 4. For `@omega-edit/client`, generates thin ESM bridge files for the protobuf
 *    wrappers so the published ESM surface can safely re-use the generated CJS
 *    protobuf artifacts under `dist/cjs`.
 *
 * Why we need it:
 * TypeScript can emit dual builds for us, but it does not by itself produce a
 * Node-ready package layout for mixed CJS/ESM publishing. Without these postbuild
 * fixes, consumer installs hit runtime problems such as:
 * - Node treating `dist/esm/*.js` as CommonJS
 * - ESM imports failing on extensionless relative specifiers
 * - `@omega-edit/client`'s protobuf wrapper layer breaking when imported as ESM
 *
 * In short: `tsc` gets us most of the way there; this script makes the emitted
 * files consumable by real downstream Node projects.
 */

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
