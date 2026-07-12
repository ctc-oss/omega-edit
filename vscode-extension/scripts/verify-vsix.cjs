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
const path = require('path')
const { spawnSync } = require('child_process')

const archive = path.resolve(process.argv[2] || 'omega-edit-data-editor.vsix')
if (!fs.existsSync(archive)) fail(`VSIX does not exist: ${archive}`)

const listing = spawnSync('cmake', ['-E', 'tar', 'tf', archive], {
  encoding: 'utf8',
  maxBuffer: 8 * 1024 * 1024,
})
if (listing.error || listing.status !== 0) {
  fail(`Unable to inspect VSIX: ${listing.error?.message || listing.stderr.trim()}`)
}

const entries = listing.stdout
  .split(/\r?\n/)
  .map((entry) => entry.replaceAll('\\', '/'))
  .filter(Boolean)
const size = fs.statSync(archive).size
const required = [
  'extension/package.json',
  'extension/out/extension.js',
  'extension/out/svelte-webview/webview.css',
  'extension/out/svelte-webview/webview.js',
]
for (const entry of required) {
  if (!entries.includes(entry)) fail(`VSIX is missing ${entry}`)
}

const forbidden = entries.filter(
  (entry) =>
    /\/(?:node_modules|src|tests|webview-ui)\//.test(entry) ||
    /\.(?:d\.ts|map|tsbuildinfo)$/.test(entry)
)
if (forbidden.length > 0) fail(`VSIX contains development files:\n${forbidden.slice(0, 20).join('\n')}`)
if (entries.length > 100) fail(`VSIX contains ${entries.length} entries; limit is 100`)
if (size > 25 * 1024 * 1024) fail(`VSIX is ${(size / (1024 * 1024)).toFixed(1)} MiB; limit is 25 MiB`)

process.stdout.write(`Verified VSIX: ${entries.length} entries, ${(size / (1024 * 1024)).toFixed(1)} MiB\n`)

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
