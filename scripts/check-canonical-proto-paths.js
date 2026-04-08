#!/usr/bin/env node
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

const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const canonicalProtoPath = 'proto/omega_edit/v1/omega_edit.proto'
const legacyRepoProtoPath = 'proto/omega_edit.proto'
const legacyImportPath = 'import "omega_edit.proto"'
const legacyRemovalMarkers = [
  'intentionally removed',
  'gone in 2.x',
  'canonical schema location',
  'canonical published contract',
  'sole source of truth',
]

const scanRoots = [
  'README.md',
  'UPGRADE-v1-to-v2.md',
  'buf.yaml',
  'package.json',
  'examples',
  'packages',
  'proto',
  'scripts',
]

const excludedDirectories = new Set([
  '.git',
  'coverage',
  'dist',
  'node_modules',
  'out',
])

const checkedExtensions = new Set([
  '.cjs',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.proto',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
])

function toRepoPath(relativePath) {
  return relativePath.replaceAll('\\', '/')
}

const allowedLegacyMentions = new Set([
  'scripts/check-canonical-proto-paths.js',
])

const requiredCanonicalMentions = new Set([
  'UPGRADE-v1-to-v2.md',
  'packages/client/DEVELOPMENT.md',
  'packages/client/scripts/generate-protobuf.js',
  'proto/README.md',
])

function collectFiles(rootDir) {
  const files = []
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const absolutePath = path.join(rootDir, entry.name)
    const relativePath = toRepoPath(path.relative(repoRoot, absolutePath))

    if (entry.isDirectory()) {
      if (excludedDirectories.has(entry.name)) {
        continue
      }
      files.push(...collectFiles(absolutePath))
      continue
    }

    if (checkedExtensions.has(path.extname(entry.name))) {
      files.push(relativePath)
    }
  }
  return files
}

function collectScanFiles() {
  const files = []

  for (const scanRoot of scanRoots) {
    const absolutePath = path.join(repoRoot, scanRoot)
    if (!fs.existsSync(absolutePath)) {
      continue
    }

    const stats = fs.statSync(absolutePath)
    if (stats.isDirectory()) {
      files.push(...collectFiles(absolutePath))
      continue
    }

    files.push(toRepoPath(scanRoot))
  }

  return files
}

function documentsLegacyPathRemoval(contents) {
  const normalizedContents = contents.toLowerCase()
  const normalizedLegacyPath = legacyRepoProtoPath.toLowerCase()
  const lines = normalizedContents.split(/\r?\n/)
  const contextLineRadius = 1

  return lines.some((line, index) => {
    if (!line.includes(normalizedLegacyPath)) {
      return false
    }

    const start = Math.max(0, index - contextLineRadius)
    const end = Math.min(lines.length - 1, index + contextLineRadius)
    const surroundingText = lines.slice(start, end + 1).join('\n')

    return legacyRemovalMarkers.some((marker) =>
      surroundingText.includes(marker)
    )
  })
}

function main() {
  const files = collectScanFiles()
  const errors = []

  for (const relativePath of files) {
    const absolutePath = path.join(repoRoot, relativePath)
    const contents = fs.readFileSync(absolutePath, 'utf8')

    const mentionsLegacyImport = contents.includes(legacyImportPath)
    const mentionsLegacyPath = contents.includes(legacyRepoProtoPath)
    const documentsLegacyRemoval = documentsLegacyPathRemoval(contents)

    if (mentionsLegacyImport && !allowedLegacyMentions.has(relativePath)) {
      errors.push(
        `${relativePath}: use ${canonicalProtoPath} as the canonical schema path instead of importing the legacy root proto`
      )
    }

    if (
      mentionsLegacyPath &&
      !allowedLegacyMentions.has(relativePath) &&
      !documentsLegacyRemoval
    ) {
      errors.push(
        `${relativePath}: use ${canonicalProtoPath} as the canonical schema path instead of the legacy root proto`
      )
    }

    if (
      requiredCanonicalMentions.has(relativePath) &&
      !contents.includes(canonicalProtoPath)
    ) {
      errors.push(
        `${relativePath}: expected a canonical-schema reference to ${canonicalProtoPath}`
      )
    }
  }

  if (errors.length > 0) {
    console.error('Canonical proto path check failed:')
    for (const error of errors) {
      console.error(`- ${error}`)
    }
    process.exit(1)
  }

  console.log(`Canonical proto path check passed (${canonicalProtoPath})`)
}

main()
