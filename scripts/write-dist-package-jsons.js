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
const cjsDir = path.join(packageRoot, 'dist', 'cjs')
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
  return (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    path.posix.extname(specifier) === ''
  )
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

function toExportStatement(name, sourceObject = 'raw') {
  return `export const ${name} = ${sourceObject}.${name};`
}

function writeFileIfChanged(filePath, content) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null
  if (existing !== content) {
    fs.writeFileSync(filePath, content)
  }
}

function generateClientProtoEsmBridges() {
  const cjsProtoModule = path.join(cjsDir, 'omega_edit', 'v1', 'omega_edit_pb.js')
  const cjsGrpcModule = path.join(cjsDir, 'omega_edit', 'v1', 'omega_edit_grpc_pb.js')
  const targetProtoWrapper = path.join(esmDir, 'omega_edit_pb.js')
  const targetGrpcWrapper = path.join(esmDir, 'omega_edit_grpc_pb.js')

  if (!fs.existsSync(cjsProtoModule) || !fs.existsSync(cjsGrpcModule)) {
    return
  }

  const rawProtoModule = require(cjsProtoModule)
  const rawGrpcModule = require(cjsGrpcModule)
  const protoExportNames = Object.keys(rawProtoModule).sort()
  const grpcExportNames = Object.keys(rawGrpcModule).sort()

  const protoWrapper = [
    "import './google_protobuf_compat.js';",
    "import { createRequire } from 'module';",
    '',
    'const require = createRequire(import.meta.url);',
    "const raw = require('../cjs/omega_edit/v1/omega_edit_pb.js');",
    '',
    ...protoExportNames.map((name) => toExportStatement(name)),
    '',
    'export const SessionEvent = raw.SubscribeToSessionEventsResponse;',
    'export const ViewportEvent = raw.SubscribeToViewportEventsResponse;',
    'export const HeartbeatRequest = raw.GetHeartbeatRequest;',
    'export const HeartbeatResponse = raw.GetHeartbeatResponse;',
    'export const ServerInfoResponse = raw.GetServerInfoResponse;',
    '',
    'export class EventSubscriptionRequest extends raw.SubscribeToSessionEventsRequest {}',
    '',
  ].join('\n')

  const grpcWrapper = [
    "import { createRequire } from 'module';",
    "import { EventSubscriptionRequest, SubscribeToSessionEventsRequest, SubscribeToViewportEventsRequest } from './omega_edit_pb.js';",
    '',
    'const require = createRequire(import.meta.url);',
    "const raw = require('../cjs/omega_edit/v1/omega_edit_grpc_pb.js');",
    '',
    ...grpcExportNames.map((name) => toExportStatement(name)),
    '',
    'export class EditorClient extends raw.EditorServiceClient {',
    '  subscribeToSessionEvents(request, ...args) {',
    '    const normalized = request instanceof SubscribeToSessionEventsRequest',
    '      ? request',
    '      : normalizeSubscriptionRequest(request, SubscribeToSessionEventsRequest);',
    '    return super.subscribeToSessionEvents(normalized, ...args);',
    '  }',
    '',
    '  subscribeToViewportEvents(request, ...args) {',
    '    const normalized = request instanceof SubscribeToViewportEventsRequest',
    '      ? request',
    '      : normalizeSubscriptionRequest(request, SubscribeToViewportEventsRequest);',
    '    return super.subscribeToViewportEvents(normalized, ...args);',
    '  }',
    '}',
    '',
    'function normalizeSubscriptionRequest(request, ctor) {',
    '  if (request instanceof ctor) {',
    '    return request;',
    '  }',
    '',
    '  if (!(request instanceof EventSubscriptionRequest)) {',
    "    throw new TypeError('Subscription request must be an EventSubscriptionRequest or generated protobuf request');",
    '  }',
    '',
    '  const normalized = new ctor().setId(request.getId());',
    "  const hasInterest = typeof request.hasInterest === 'function' ? request.hasInterest() : undefined;",
    "  const interest = typeof request.getInterest === 'function' ? request.getInterest() : undefined;",
    '  if (hasInterest === true && interest !== undefined) {',
    '    normalized.setInterest(interest);',
    '  } else if (hasInterest === undefined && interest !== undefined) {',
    '    normalized.setInterest(interest);',
    '  }',
    '  return normalized;',
    '}',
    '',
  ].join('\n')

  writeFileIfChanged(targetProtoWrapper, `${protoWrapper}\n`)
  writeFileIfChanged(targetGrpcWrapper, `${grpcWrapper}\n`)
}

for (const target of targets) {
  fs.mkdirSync(target.directory, { recursive: true })
  fs.writeFileSync(
    path.join(target.directory, 'package.json'),
    `${JSON.stringify(target.manifest, null, 2)}\n`
  )
}

rewriteEsmImportsRecursively(esmDir)
generateClientProtoEsmBridges()
