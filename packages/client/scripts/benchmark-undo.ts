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

import { existsSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'

interface BenchmarkOptions {
  host: string
  longToken: string
  matches: number
  port: number
  rounds: number
  separator: string
  shortToken: string
  useExistingServer: boolean
}

const DEFAULT_OPTIONS: BenchmarkOptions = {
  host: '127.0.0.1',
  longToken: 'Everybody Wang Chung Tonight',
  matches: 100,
  port: 9123,
  rounds: 3,
  separator: '|',
  shortToken: 'PDF',
  useExistingServer: false,
}

function parseIntegerOption(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`)
  }
  return parsed
}

function parseArgs(argv: string[]): BenchmarkOptions {
  const options = { ...DEFAULT_OPTIONS }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]

    if (arg === '--port' && value) {
      options.port = parseIntegerOption(value, '--port')
      index += 1
      continue
    }

    if (arg === '--matches' && value) {
      options.matches = parseIntegerOption(value, '--matches')
      index += 1
      continue
    }

    if (arg === '--rounds' && value) {
      options.rounds = parseIntegerOption(value, '--rounds')
      index += 1
      continue
    }

    if (arg === '--host' && value) {
      options.host = value
      index += 1
      continue
    }

    if (arg === '--short-token' && value) {
      options.shortToken = value
      index += 1
      continue
    }

    if (arg === '--long-token' && value) {
      options.longToken = value
      index += 1
      continue
    }

    if (arg === '--separator' && value) {
      options.separator = value
      index += 1
      continue
    }

    if (arg === '--help') {
      printUsage()
      process.exit(0)
    }

    if (arg === '--use-existing-server') {
      options.useExistingServer = true
      continue
    }

    throw new Error(`Unknown or incomplete argument: ${arg}`)
  }

  return options
}

function printUsage(): void {
  console.log(`Usage: yarn benchmark:undo -- [options]

Options:
  --port <n>           Server port to use (default: ${DEFAULT_OPTIONS.port})
  --host <host>        Server host to use (default: ${DEFAULT_OPTIONS.host})
  --matches <n>        Number of token matches per transaction (default: ${DEFAULT_OPTIONS.matches})
  --rounds <n>         Number of stacked replace transactions and undos (default: ${DEFAULT_OPTIONS.rounds})
  --short-token <txt>  Initial token to repeat (default: ${DEFAULT_OPTIONS.shortToken})
  --long-token <txt>   Replacement token to alternate with (default: ${DEFAULT_OPTIONS.longToken})
  --separator <txt>    Separator inserted between repeated tokens (default: "${DEFAULT_OPTIONS.separator}")
  --use-existing-server
                       Connect to an already-running server instead of starting one
  --help               Show this help text`)
}

function buildHaystack(
  token: string,
  count: number,
  separator: string
): Uint8Array {
  return Buffer.from(Array.from({ length: count }, () => token).join(separator))
}

function summarize(values: number[]): {
  avg: number
  max: number
  min: number
} {
  const total = values.reduce((sum, value) => sum + value, 0)
  return {
    avg: total / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

function formatMs(value: number): string {
  return `${value.toFixed(2)} ms`
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath)
  } catch {}
}

async function loadClientPackage(): Promise<typeof import('../src/index')> {
  const packagePath = path.resolve(process.cwd(), 'dist/esm/index.js')
  return (await import(
    pathToFileURL(packagePath).href
  )) as typeof import('../src/index')
}

function prependToPath(directory: string): void {
  const currentPath = process.env.PATH || ''
  const segments = currentPath.split(path.delimiter).filter(Boolean)
  if (!segments.includes(directory)) {
    process.env.PATH = [directory, ...segments].join(path.delimiter)
  }
}

function configureLocalServerRuntime(): void {
  const repoRoot = path.resolve(process.cwd(), '..', '..')
  const localServerBinary = path.join(
    repoRoot,
    'server',
    'cpp',
    'build',
    process.platform === 'win32'
      ? 'omega-edit-grpc-server.exe'
      : 'omega-edit-grpc-server'
  )

  if (existsSync(localServerBinary)) {
    process.env.CPP_SERVER_BINARY = localServerBinary
    console.log(`server binary: ${localServerBinary}`)
  }

  if (process.platform !== 'win32') {
    return
  }

  const runtimeCandidates = [
    path.join(repoRoot, '_install', 'bin'),
    path.join(repoRoot, 'build-Debug', 'core'),
    path.join(repoRoot, 'server', 'cpp', 'build'),
  ]

  for (const candidate of runtimeCandidates) {
    if (existsSync(path.join(candidate, 'omega_edit.dll'))) {
      prependToPath(candidate)
      console.log(`runtime path: ${candidate}`)
      return
    }
  }

  console.warn('warning: omega_edit.dll runtime path was not found locally')
}

async function main(): Promise<void> {
  const {
    createSession,
    destroySession,
    getClient,
    getComputedFileSize,
    getSegment,
    overwrite,
    replaceSession,
    resetClient,
    startServer,
    stopProcessUsingPID,
    undo,
  } = await loadClientPackage()

  configureLocalServerRuntime()

  const options = parseArgs(process.argv.slice(2))
  const pidFile = path.resolve(
    process.cwd(),
    `.undo-benchmark-${options.port}.pid`
  )

  let pid: number | undefined
  let sessionId = ''

  const replaceLatencies: number[] = []
  const undoLatencies: number[] = []

  try {
    await safeUnlink(pidFile)

    console.log('OmegaEdit client undo benchmark')
    console.log(
      `config: host=${options.host} port=${options.port} matches=${options.matches} rounds=${options.rounds}`
    )

    if (options.useExistingServer) {
      await getClient(options.port, options.host)
      console.log('using existing server')
    } else {
      pid = await startServer(options.port, options.host, pidFile)
      if (!pid) {
        throw new Error('Failed to start local OmegaEdit server')
      }
      await getClient(options.port, options.host)
      console.log(`server pid: ${pid}`)
    }

    const session = await createSession()
    sessionId = session.getSessionId()
    console.log(`session id: ${sessionId}`)

    await overwrite(
      sessionId,
      0,
      buildHaystack(options.shortToken, options.matches, options.separator)
    )
    console.log(`initial size: ${await getComputedFileSize(sessionId)}`)

    let currentToken = options.shortToken
    let nextToken = options.longToken

    for (let round = 0; round < options.rounds; round += 1) {
      const start = performance.now()
      const replaced = await replaceSession(sessionId, currentToken, nextToken)
      const elapsed = performance.now() - start
      replaceLatencies.push(elapsed)

      console.log(
        `replace ${round + 1}: ${replaced} matches in ${formatMs(elapsed)} (size=${await getComputedFileSize(
          sessionId
        )})`
      )

      ;[currentToken, nextToken] = [nextToken, currentToken]
    }

    for (let round = 0; round < options.rounds; round += 1) {
      const start = performance.now()
      const serial = await undo(sessionId)
      const elapsed = performance.now() - start
      undoLatencies.push(elapsed)

      console.log(
        `undo ${round + 1}: serial=${serial} in ${formatMs(elapsed)} (size=${await getComputedFileSize(
          sessionId
        )})`
      )
    }

    const replaceSummary = summarize(replaceLatencies)
    const undoSummary = summarize(undoLatencies)
    const finalSize = await getComputedFileSize(sessionId)
    const finalPreview = Buffer.from(
      await getSegment(sessionId, 0, Math.min(finalSize, 80))
    ).toString()

    console.log('summary:')
    console.log(
      `  replace avg=${formatMs(replaceSummary.avg)} min=${formatMs(
        replaceSummary.min
      )} max=${formatMs(replaceSummary.max)}`
    )
    console.log(
      `  undo    avg=${formatMs(undoSummary.avg)} min=${formatMs(
        undoSummary.min
      )} max=${formatMs(undoSummary.max)}`
    )
    console.log(`final size: ${finalSize}`)
    console.log(`final preview: ${finalPreview}`)
  } finally {
    if (sessionId) {
      try {
        await destroySession(sessionId)
      } catch (error) {
        console.error('destroySession cleanup failed', error)
      }
    }

    resetClient()

    if (pid) {
      try {
        await stopProcessUsingPID(pid)
      } catch (error) {
        console.error('stopProcessUsingPID cleanup failed', error)
      }
    }

    await safeUnlink(pidFile)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
