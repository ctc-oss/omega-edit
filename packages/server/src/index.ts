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

/**
 * @fileoverview
 * This file contains the main entry point for the Omega Edit gRPC server.
 * It is responsible for starting the gRPC server in a platform-agnostic way.
 * It can be imported as a module.
 */

import { ChildProcess, spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * Server runtime options passed as native CLI flags to the C++ gRPC server.
 */
export interface HeartbeatOptions {
  /** Idle session timeout in milliseconds (0 = disabled). */
  sessionTimeoutMs?: number
  /** Reaper sweep interval in milliseconds (0 = disabled). */
  cleanupIntervalMs?: number
  /** When true, the server exits after reaping the last session. */
  shutdownWhenNoSessions?: boolean
  /** Cap buffered session events per subscription (0 = unbounded). */
  sessionEventQueueCapacity?: number
  /** Cap buffered viewport events per subscription (0 = unbounded). */
  viewportEventQueueCapacity?: number
  /** Limit insert and overwrite payload size in bytes (0 = unbounded). */
  maxChangeBytes?: number
  /** Limit concurrently open viewports per session (0 = unbounded). */
  maxViewportsPerSession?: number
  /** Append native server lifecycle logs to this file. */
  logFile?: string
  /** Native server log level. */
  logLevel?: string
  /** Compatibility shim: read native log file/level from a logback-style XML config. */
  logConfigFile?: string
  /** Register transform plugins from these directories. */
  transformPluginDirectories?: string[]
  /** Worker executable used to run transform plugins out of process. */
  transformPluginHostPath?: string
  /** Load experimental transform plugins from registered directories. */
  allowExperimentalTransformPlugins?: boolean
  /** Load test-only transform plugins from registered directories. */
  allowTestTransformPlugins?: boolean
  /** Permit unauthenticated TCP binds outside loopback. */
  insecureAllowNonLoopback?: boolean
}

/**
 * Checks to see if either path to the server bin directory exists
 * @param baseDir the base path to the directory to check against
 * @returns
 *    - one of the checked paths if they exist
 *    OR
 *    - calls the getBinFolderPath going back a directory
 */
const checkForBinPath = (baseDir: string): string => {
  const serverbasePath = 'node_modules/@omega-edit/server'

  // These two are checked as when testing locally it will want to use out/bin
  const pathsToCheck: string[] = [
    path.join(baseDir, serverbasePath, 'bin'),
    path.join(baseDir, serverbasePath, 'out', 'bin'),
  ]

  for (const p of pathsToCheck) {
    if (fs.existsSync(p)) return path.resolve(p)
  }

  return getBinFolderPath(path.join(baseDir, '..'))
}

/**
 * Recursively finds the bin folder path
 * @param baseDir the base path to the directory to check against
 * @returns
 *    - path to bin directory
 *    OR
 *    - recursively calls itself till path is found
 */
function stripNodeModulesSuffix(baseDir: string): string {
  return baseDir.endsWith('node_modules')
    ? baseDir.slice(0, -'node_modules'.length)
    : baseDir
}

export const getBinFolderPath = (baseDir: string): string => {
  if (!baseDir.endsWith('node_modules')) {
    if (fs.readdirSync(baseDir).includes('node_modules')) {
      return checkForBinPath(baseDir)
    } else {
      return getBinFolderPath(path.join(baseDir, '..'))
    }
  } else {
    return checkForBinPath(stripNodeModulesSuffix(baseDir))
  }
}

/**
 * Returns the platform-specific binary name for the C++ gRPC server.
 * For example: "omega-edit-grpc-server-linux-x64" on Linux x64, or
 * "omega-edit-grpc-server-windows-x64.exe" on 64-bit Windows.
 */
function getPlatformId(): string {
  const platform = os.platform()
  const arch = os.arch()
  if (platform === 'darwin') return `macos-${arch}`
  if (platform === 'win32') return `windows-${arch}`
  return `${platform}-${arch}`
}

function executableExtension(): string {
  return os.platform() === 'win32' ? '.exe' : ''
}

function getPlatformBinaryName(): string {
  return `omega-edit-grpc-server-${getPlatformId()}${executableExtension()}`
}

function getPlatformTransformPluginHostBinaryName(): string {
  return `omega-transform-plugin-host-${getPlatformId()}${executableExtension()}`
}

function getPlainTransformPluginHostBinaryName(): string {
  return `omega-transform-plugin-host${executableExtension()}`
}

function getTransformPluginPlatformId(): string | undefined {
  const platform = os.platform()
  const arch = os.arch()

  if (platform === 'linux' && (arch === 'x64' || arch === 'arm64')) {
    return `linux-${arch}`
  }
  if (platform === 'darwin' && (arch === 'x64' || arch === 'arm64')) {
    return `macos-${arch}`
  }
  if (platform === 'win32' && arch === 'x64') {
    return 'windows-x64'
  }
  return undefined
}

function getTransformPluginExtensions(): string[] {
  if (os.platform() === 'win32') return ['.dll']
  if (os.platform() === 'darwin') return ['.dylib', '.so']
  return ['.so']
}

function directoryExists(directory: string): boolean {
  try {
    return fs.statSync(directory).isDirectory()
  } catch {
    return false
  }
}

function directoryHasTransformPlugin(directory: string): boolean {
  if (!directoryExists(directory)) return false

  const extensions = getTransformPluginExtensions()
  return fs.readdirSync(directory).some((file) => {
    return (
      file.startsWith('omega_transform_') &&
      extensions.some((extension) => file.endsWith(extension))
    )
  })
}

function normalizeWindowsPath(directory: string): string {
  if (os.platform() !== 'win32') return directory

  const msysPath = directory.match(/^\/([a-zA-Z])\/(.*)$/)
  return msysPath
    ? `${msysPath[1]}:\\${msysPath[2].replace(/\//g, '\\')}`
    : directory
}

function splitPathList(value: string | undefined): string[] {
  return (value ?? '')
    .split(path.delimiter)
    .map((directory) => normalizeWindowsPath(directory.trim()))
    .filter(Boolean)
}

function findRepositoryRoot(startDir: string): string {
  const candidates = [
    path.resolve(startDir, '..'),
    path.resolve(startDir, '..', '..'),
    path.resolve(startDir, '..', '..', '..'),
  ]

  return (
    candidates.find(
      (candidate) =>
        directoryExists(path.join(candidate, 'packages', 'server')) &&
        directoryExists(path.join(candidate, 'server', 'cpp'))
    ) ?? path.resolve(startDir, '..')
  )
}

function getDefaultTransformPluginDirectories(binDir: string): string[] {
  const platformId = getTransformPluginPlatformId()
  const outDir = path.dirname(binDir)
  const repoRoot = findRepositoryRoot(outDir)
  const envCandidates = [
    ...splitPathList(process.env.OMEGA_EDIT_TRANSFORM_PLUGIN_DIRS),
    ...splitPathList(process.env.OMEGA_EDIT_TRANSFORM_PLUGINS_DIR),
    ...splitPathList(process.env.OMEGA_EDIT_TEST_PLUGIN_DIR),
  ]
  const candidates = [
    ...envCandidates,
    platformId ? path.join(outDir, 'transform-plugins', platformId) : '',
    path.join(
      repoRoot,
      '.codex-tmp',
      'native-core-build',
      'core',
      'src',
      'tests',
      'plugins'
    ),
    path.join(repoRoot, '_build_core', 'plugins', 'plugins'),
    path.join(repoRoot, '_build_core', 'core', 'src', 'tests', 'plugins'),
    path.join(repoRoot, '_build', 'plugins', 'plugins'),
    path.join(repoRoot, 'build', 'core', 'src', 'tests', 'plugins'),
    path.join(repoRoot, 'build-coverage', 'core', 'src', 'tests', 'plugins'),
    path.join(
      repoRoot,
      'build-shared-Debug',
      'core',
      'src',
      'tests',
      'plugins'
    ),
    path.join(
      repoRoot,
      'build-shared-Release',
      'core',
      'src',
      'tests',
      'plugins'
    ),
    path.join(
      repoRoot,
      'build-shared-RelWithDebInfo',
      'core',
      'src',
      'tests',
      'plugins'
    ),
  ].filter(Boolean)

  const expandedCandidates = candidates.flatMap((candidate) =>
    platformId ? [path.join(candidate, platformId), candidate] : [candidate]
  )

  return Array.from(new Set(expandedCandidates)).filter(
    directoryHasTransformPlugin
  )
}

/**
 * Find the C++ server binary path.
 * First checks the CPP_SERVER_BINARY environment variable for a local dev override.
 * Then looks for a platform-specific native binary (e.g., omega-edit-grpc-server-linux-x64).
 * Falls back to the plain name (omega-edit-grpc-server) for backward-compatible
 * single-platform/dev packages only when no platform-suffixed binaries are present.
 * @param binDir the bin directory to search in
 * @returns the resolved path to the server executable
 */
function findServerBinary(binDir: string): string {
  // Allow local dev override via environment variable
  const envOverride = process.env.CPP_SERVER_BINARY
  if (envOverride) {
    const resolved = path.resolve(normalizeWindowsPath(envOverride))
    if (fs.existsSync(resolved)) {
      return resolved
    }
    throw new Error(
      `CPP_SERVER_BINARY is set to '${envOverride}' but the file does not exist.`
    )
  }

  const isWin = os.platform() === 'win32'

  // Check for platform-specific C++ binary (universal package layout)
  const platformBinary = path.join(binDir, getPlatformBinaryName())
  if (fs.existsSync(platformBinary)) {
    return platformBinary
  }

  const packagedBinaries = fs
    .readdirSync(binDir)
    .filter((file) =>
      /^omega-edit-grpc-server-(linux|macos|windows)-/.test(file)
    )
  if (packagedBinaries.length > 0) {
    const normalizedPlatform =
      os.platform() === 'darwin'
        ? 'macos'
        : os.platform() === 'win32'
          ? 'windows'
          : os.platform()
    throw new Error(
      `No pre-built server binary for ${normalizedPlatform}-${os.arch()} in ${binDir}.\n` +
        `Expected ${getPlatformBinaryName()} because this package contains platform-specific server binaries.\n` +
        'Supported platforms: linux-x64, linux-arm64, macos-x64, macos-arm64, windows-x64.\n' +
        'To use a custom build, set CPP_SERVER_BINARY=/path/to/omega-edit-grpc-server\n' +
        'Build from source: https://github.com/ctc-oss/omega-edit/blob/main/CONTRIBUTING.md'
    )
  }

  // Check for plain-named C++ binary (single-platform or dev build)
  const plainName = isWin
    ? 'omega-edit-grpc-server.exe'
    : 'omega-edit-grpc-server'
  const plainBinary = path.join(binDir, plainName)
  if (fs.existsSync(plainBinary)) {
    return plainBinary
  }

  const normalizedPlatform =
    os.platform() === 'darwin'
      ? 'macos'
      : os.platform() === 'win32'
        ? 'windows'
        : os.platform()
  throw new Error(
    `No pre-built server binary for ${normalizedPlatform}-${os.arch()} in ${binDir}.\n` +
      'Supported platforms: linux-x64, linux-arm64, macos-x64, macos-arm64, windows-x64.\n' +
      'To use a custom build, set CPP_SERVER_BINARY=/path/to/omega-edit-grpc-server\n' +
      'Build from source: https://github.com/ctc-oss/omega-edit/blob/main/CONTRIBUTING.md'
  )
}

function findTransformPluginHostBinary(binDir: string): string | undefined {
  const envOverride =
    process.env.CPP_TRANSFORM_PLUGIN_HOST_BINARY ||
    process.env.OMEGA_EDIT_TRANSFORM_PLUGIN_HOST
  if (envOverride) {
    const resolved = path.resolve(normalizeWindowsPath(envOverride))
    if (fs.existsSync(resolved)) {
      return resolved
    }
    throw new Error(
      `Transform plugin host override is set to '${envOverride}' but the file does not exist.`
    )
  }

  const platformBinary = path.join(
    binDir,
    getPlatformTransformPluginHostBinaryName()
  )
  if (fs.existsSync(platformBinary)) {
    return platformBinary
  }

  const packagedBinaries = fs
    .readdirSync(binDir)
    .filter((file) =>
      /^omega-transform-plugin-host-(linux|macos|windows)-/.test(file)
    )
  if (packagedBinaries.length > 0) {
    throw new Error(
      `No transform plugin host for ${getPlatformId()} in ${binDir}.\n` +
        `Expected ${getPlatformTransformPluginHostBinaryName()} because this package contains platform-specific host binaries.`
    )
  }

  const plainBinary = path.join(binDir, getPlainTransformPluginHostBinaryName())
  return fs.existsSync(plainBinary) ? plainBinary : undefined
}

/**
 * Convert HeartbeatOptions to native CLI flags understood by the C++ server.
 */
function heartbeatToArgs(
  opts?: HeartbeatOptions,
  defaultTransformPluginDirectories: string[] = [],
  defaultTransformPluginHostPath?: string
): string[] {
  if (
    !opts &&
    defaultTransformPluginDirectories.length === 0 &&
    !defaultTransformPluginHostPath
  ) {
    return []
  }
  const args: string[] = []
  if (opts?.sessionTimeoutMs !== undefined) {
    args.push(`--session-timeout=${opts.sessionTimeoutMs}`)
  }
  if (opts?.cleanupIntervalMs !== undefined) {
    args.push(`--cleanup-interval=${opts.cleanupIntervalMs}`)
  }
  if (opts?.shutdownWhenNoSessions) {
    args.push('--shutdown-when-no-sessions')
  }
  if (opts?.sessionEventQueueCapacity !== undefined) {
    args.push(
      `--session-event-queue-capacity=${opts.sessionEventQueueCapacity}`
    )
  }
  if (opts?.viewportEventQueueCapacity !== undefined) {
    args.push(
      `--viewport-event-queue-capacity=${opts.viewportEventQueueCapacity}`
    )
  }
  if (opts?.maxChangeBytes !== undefined) {
    args.push(`--max-change-bytes=${opts.maxChangeBytes}`)
  }
  if (opts?.maxViewportsPerSession !== undefined) {
    args.push(`--max-viewports-per-session=${opts.maxViewportsPerSession}`)
  }
  if (opts?.logConfigFile !== undefined) {
    args.push(`--log-config=${opts.logConfigFile}`)
  }
  if (opts?.logFile !== undefined) {
    args.push(`--log-file=${opts.logFile}`)
  }
  if (opts?.logLevel !== undefined) {
    args.push(`--log-level=${opts.logLevel}`)
  }
  if (opts?.insecureAllowNonLoopback) {
    args.push('--insecure-allow-non-loopback')
  }
  const transformPluginHostPath =
    opts?.transformPluginHostPath || defaultTransformPluginHostPath
  if (transformPluginHostPath) {
    args.push(`--transform-plugin-host=${transformPluginHostPath}`)
  }
  if (opts?.allowExperimentalTransformPlugins) {
    args.push('--allow-experimental-transform-plugins')
  }
  if (opts?.allowTestTransformPlugins) {
    args.push('--allow-test-transform-plugins')
  }
  const configuredTransformPluginDirectories =
    opts?.transformPluginDirectories?.filter(
      (directory) =>
        typeof directory === 'string' && directory.trim().length > 0
    ) ?? []
  const transformPluginDirectories =
    configuredTransformPluginDirectories.length > 0
      ? configuredTransformPluginDirectories
      : defaultTransformPluginDirectories
  for (const directory of transformPluginDirectories) {
    args.push(`--transform-plugin-dir=${directory}`)
  }
  return args
}

/**
 * Execute the server
 * @param args arguments to pass to the server
 * @param heartbeat optional heartbeat / session-reaping options
 * @returns {Promise<ChildProcess>} server process
 */
async function executeServer(
  args: string[],
  heartbeat?: HeartbeatOptions
): Promise<ChildProcess> {
  const binDir = getBinFolderPath(path.resolve(__dirname))
  const serverBinary = findServerBinary(binDir)
  const transformPluginHostBinary = findTransformPluginHostBinary(
    path.dirname(serverBinary)
  )
  const defaultTransformPluginDirectories =
    getDefaultTransformPluginDirectories(binDir)

  const serverArgs = [
    ...args,
    ...heartbeatToArgs(
      heartbeat,
      defaultTransformPluginDirectories,
      transformPluginHostBinary
    ),
  ]

  if (!serverBinary.endsWith('.exe')) {
    fs.chmodSync(serverBinary, 0o755)
  }

  const serverProcess: ChildProcess = spawn(serverBinary, serverArgs, {
    cwd: path.dirname(serverBinary),
    detached: true,
    shell: false,
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true, // avoid showing a console window
  })

  serverProcess.on('error', (err: Error) => {
    // ignore the error if the process was cancelled
    if (!err.message.includes('Call cancelled')) throw err
  })

  serverProcess.unref()

  return serverProcess
}

/**
 * Run the server
 * @param port port number
 * @param host hostname or IP address (default: 127.0.0.1)
 * @param pidfile resolved path to the PID file
 * @param heartbeat optional heartbeat / session-reaping options
 * @returns {Promise<ChildProcess>} server process
 */
export async function runServer(
  port: number,
  host: string = '127.0.0.1',
  pidfile?: string,
  heartbeat?: HeartbeatOptions
): Promise<ChildProcess> {
  // NOTE: Do not wrap args with double quotes, this causes issues when being
  // passed to the script

  const args: string[] = [`--interface=${host}`, `--port=${port}`]

  if (pidfile) {
    args.push(`--pidfile=${pidfile}`)
  }

  return await executeServer(args, heartbeat)
}

/**
 * Run the server with custom CLI args (e.g., UDS-only mode).
 * @param args arguments to pass to the server
 * @param heartbeat optional heartbeat / session-reaping options
 * @returns {Promise<ChildProcess>} server process
 */
export async function runServerWithArgs(
  args: string[],
  heartbeat?: HeartbeatOptions
): Promise<ChildProcess> {
  return await executeServer(args, heartbeat)
}
