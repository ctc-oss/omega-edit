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
    /^extension\/(?:src|tests|webview-ui)\//.test(entry) ||
    /\/node_modules\/(?:@biomejs|@vscode\/test-electron|@vscode\/vsce|mocha|svelte-check|typescript|vite)\//.test(
      entry
    ) ||
    (/\.(?:d\.ts|map|tsbuildinfo)$/.test(entry) &&
      !entry.startsWith('extension/node_modules/@omega-edit/server/'))
)
if (forbidden.length > 0) fail(`VSIX contains development files:\n${forbidden.slice(0, 20).join('\n')}`)
if (!entries.some((entry) => entry.startsWith('extension/node_modules/@omega-edit/server/')))
  fail('VSIX is missing the @omega-edit/server runtime dependency')
const unexpectedDependencies = entries.filter(
  (entry) =>
    entry.startsWith('extension/node_modules/') &&
    !entry.startsWith('extension/node_modules/@omega-edit/server')
)
if (unexpectedDependencies.length > 0)
  fail(`VSIX contains unbundled dependencies:\n${unexpectedDependencies.slice(0, 20).join('\n')}`)
const duplicatePlugins = entries.filter((entry) =>
  entry.startsWith('extension/bundled/transform-plugins/')
)
if (duplicatePlugins.length > 0)
  fail(`VSIX contains a duplicate transform plugin tree:\n${duplicatePlugins.slice(0, 20).join('\n')}`)

const supportedPlatforms = [
  'linux-x64',
  'linux-arm64',
  'macos-x64',
  'macos-arm64',
  'windows-x64',
]
let packagedPlatforms = supportedPlatforms.filter((platform) =>
  entries.some((entry) =>
    entry.includes(`/out/bin/omega-edit-grpc-server-${platform}`)
  )
)
if (packagedPlatforms.length === 0) {
  const localPlatform =
    process.platform === 'darwin'
      ? `macos-${process.arch}`
      : process.platform === 'win32'
        ? `windows-${process.arch}`
        : `${process.platform}-${process.arch}`
  packagedPlatforms = supportedPlatforms.includes(localPlatform)
    ? [localPlatform]
    : []
}
if (packagedPlatforms.length === 0)
  fail('VSIX does not contain a server binary for a supported platform')
for (const platform of packagedPlatforms) {
  const pluginPrefix = `extension/node_modules/@omega-edit/server/out/transform-plugins/${platform}/`
  const plugins = entries.filter(
    (entry) =>
      entry.startsWith(pluginPrefix) &&
      /omega_transform_[^/]+\.(?:dll|dylib|so)$/.test(entry)
  )
  if (plugins.length < 17)
    fail(`VSIX contains ${plugins.length} transform plugins for ${platform}; expected at least 17`)
  if (!plugins.some((entry) => /omega_transform_zstd\.(?:dll|dylib|so)$/.test(entry)))
    fail(`VSIX is missing the zstd transform plugin for ${platform}`)
}
if (entries.length > 200) fail(`VSIX contains ${entries.length} entries; limit is 200`)
if (size > 70 * 1024 * 1024) fail(`VSIX is ${(size / (1024 * 1024)).toFixed(1)} MiB; limit is 70 MiB`)

process.stdout.write(`Verified VSIX: ${entries.length} entries, ${(size / (1024 * 1024)).toFixed(1)} MiB\n`)

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
