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

const [, , kind, archiveArgument] = process.argv
const supportedKinds = new Set(['source', 'core', 'npm'])

if (!supportedKinds.has(kind) || !archiveArgument) {
  fail('Usage: verify-package-contents.js <source|core|npm> <archive>')
}

const archive = path.resolve(archiveArgument)
if (!fs.existsSync(archive)) fail(`Package archive does not exist: ${archive}`)

const listing = spawnSync('cmake', ['-E', 'tar', 'tf', archive], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
if (listing.error)
  fail(`Unable to inspect ${archive}: ${listing.error.message}`)
if (listing.status !== 0) {
  fail(
    `Unable to inspect ${archive}: ${(listing.stderr || listing.stdout).trim()}`
  )
}

const entries = listing.stdout
  .split(/\r?\n/)
  .map((entry) => entry.replaceAll('\\', '/').replace(/^\.\//, ''))
  .filter(Boolean)
const files = entries.filter((entry) => !entry.endsWith('/'))
const size = fs.statSync(archive).size

if (kind === 'source') verifySource(files, size)
if (kind === 'core') verifyCore(files, size)
if (kind === 'npm') verifyNpm(files, size)

process.stdout.write(
  `Verified ${kind} package ${path.basename(archive)}: ${files.length} files, ${formatBytes(size)}\n`
)

function verifySource(packageFiles, packageSize) {
  enforceLimits(packageFiles, packageSize, 2500, 100 * 1024 * 1024)
  requireSuffixes(packageFiles, [
    '/CMakeLists.txt',
    '/LICENSE.txt',
    '/README.md',
    '/VERSION',
    '/plugins/src/zstd.c',
    '/packages/client/package.json',
    '/yarn.lock',
  ])
  rejectMatches(packageFiles, [
    /\/(?:\.venv[^/]*|venv[^/]*)\//,
    /^[^/]+\/(?:build[^/]*|_build[^/]*|cmake-build[^/]*)\//,
    /^[^/]+\/(?:_install[^/]*|node_modules|_CPack_Packages|CMakeFiles|coverage|dist|out)\//,
    /\/(?:CMakeCache\.txt|CPack(?:Source)?Config\.cmake|cmake_install\.cmake)$/,
    /\.(?:a|dll|dylib|lib|o|obj|pdb|so|tgz|vsix|zip)$/,
  ])
}

function verifyCore(packageFiles, packageSize) {
  enforceLimits(packageFiles, packageSize, 250, 100 * 1024 * 1024)
  requireSuffixes(packageFiles, [
    '/include/omega_edit/edit.h',
    '/share/doc/omega_edit/README.md',
  ])
  requireMatch(
    packageFiles,
    /\/lib\/cmake\/omega_edit\/omega_editConfig\.cmake$/
  )
  requireMatch(packageFiles, /\/omega-transform-plugin-host(?:\.exe)?$/)
  requireMatch(
    packageFiles,
    /\/(?:libomega_edit\.(?:a|dylib|so)|omega_edit\.(?:dll|lib))$/
  )
  rejectMatches(packageFiles, [
    /\/(?:src|tests|node_modules|\.venv[^/]*)\//,
    /\/(?:CMakeCache\.txt|cmake_install\.cmake)$/,
    /\/(?:include\/zstd(?:_errors)?\.h|include\/zdict\.h|lib\/libzstd\.|lib\/cmake\/zstd\/|lib\/pkgconfig\/libzstd\.pc)/,
  ])
}

function verifyNpm(packageFiles, packageSize) {
  enforceLimits(packageFiles, packageSize, 500, 100 * 1024 * 1024)
  if (!packageFiles.includes('package/package.json'))
    fail('npm package is missing package/package.json')
  const allowedRootFiles = new Set([
    'package',
    'package/dist',
    'package/LICENSE',
    'package/LICENSE.txt',
    'package/out',
    'package/README',
    'package/README.md',
    'package/package.json',
  ])
  const unexpected = packageFiles.filter(
    (entry) =>
      !allowedRootFiles.has(entry) &&
      !entry.startsWith('package/dist/') &&
      !entry.startsWith('package/out/')
  )
  if (unexpected.length > 0)
    fail(
      `npm package contains unexpected paths:\n${unexpected.slice(0, 20).join('\n')}`
    )
}

function enforceLimits(packageFiles, packageSize, maxFiles, maxBytes) {
  if (packageFiles.length > maxFiles)
    fail(`Package contains ${packageFiles.length} files; limit is ${maxFiles}`)
  if (packageSize > maxBytes)
    fail(
      `Package is ${formatBytes(packageSize)}; limit is ${formatBytes(maxBytes)}`
    )
}

function requireSuffixes(packageFiles, suffixes) {
  for (const suffix of suffixes) {
    if (!packageFiles.some((entry) => entry.endsWith(suffix)))
      fail(`Package is missing required path *${suffix}`)
  }
}

function requireMatch(packageFiles, pattern) {
  if (!packageFiles.some((entry) => pattern.test(entry)))
    fail(`Package has no path matching ${pattern}`)
}

function rejectMatches(packageFiles, patterns) {
  const rejected = packageFiles.filter((entry) =>
    patterns.some((pattern) => pattern.test(entry))
  )
  if (rejected.length > 0)
    fail(
      `Package contains forbidden paths:\n${rejected.slice(0, 20).join('\n')}`
    )
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
