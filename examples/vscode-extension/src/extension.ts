// Copyright 2024 Concurrent Technologies Corporation
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {
  getClient,
  startServer,
  startServerUnixSocket,
  stopServerGraceful,
} from '@omega-edit/client'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'
import {
  OMEGA_EDIT_EXTENSION_API_VERSION,
  type OmegaEditExtensionApi,
  type OmegaEditExternalHighlightRequest,
  type OmegaEditOpenOptions,
  type OmegaEditRevealOptions,
} from './api'
import {
  OMEGA_EDIT_CREATE_CHECKPOINT_COMMAND,
  OMEGA_EDIT_CLEAR_EXTERNAL_HIGHLIGHTS_COMMAND,
  OMEGA_EDIT_EXPORT_CHANGE_SCRIPT_COMMAND,
  OMEGA_EDIT_GET_EDITOR_STATE_COMMAND,
  OMEGA_EDIT_GO_TO_OFFSET_COMMAND,
  OMEGA_EDIT_OPEN_IN_HEX_EDITOR_COMMAND,
  OMEGA_EDIT_REFRESH_TRANSFORM_PLUGINS_COMMAND,
  OMEGA_EDIT_REDO_COMMAND,
  OMEGA_EDIT_REPLAY_CHANGE_SCRIPT_COMMAND,
  OMEGA_EDIT_ROLLBACK_CHECKPOINT_COMMAND,
  OMEGA_EDIT_ROLLBACK_SESSION_COMMAND,
  OMEGA_EDIT_SEARCH_NEXT_COMMAND,
  OMEGA_EDIT_SEARCH_PREVIOUS_COMMAND,
  OMEGA_EDIT_SET_EXTERNAL_HIGHLIGHTS_COMMAND,
  OMEGA_EDIT_UNDO_COMMAND,
  OMEGA_EDIT_VIEW_TYPE,
} from './constants'
import { HexEditorProvider } from './hexEditorProvider'

let activeProvider: HexEditorProvider | undefined
let activeServerSocketPath: string | undefined

const DEFAULT_SERVER_PORT = 9000
const SERVER_PORT_OVERRIDE_ENV = 'OMEGA_EDIT_SERVER_PORT'
const SERVER_SOCKET_OVERRIDE_ENV = 'OMEGA_EDIT_SERVER_SOCKET'
const UNIX_SOCKET_UNSUPPORTED_MESSAGE =
  'Unix domain sockets are not supported on Windows by the current Node/gRPC stack'
const VALID_LOG_LEVELS = new Set([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
])

type ServerConnection =
  | { kind: 'tcp'; port: number }
  | {
      kind: 'unix'
      port: number
      socketPath: string
    }

interface StartedServer {
  connection: ServerConnection
  serverPid: number | undefined
}

function parseServerPort(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 && value <= 65535
      ? value
      : undefined
  }

  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
    return undefined
  }

  const port = Number.parseInt(value.trim(), 10)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined
}

function isFileUri(uri: vscode.Uri | undefined): uri is vscode.Uri {
  return !!uri && uri.scheme === 'file'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseApiFileUri(value: unknown): vscode.Uri | undefined {
  if (value instanceof vscode.Uri) {
    return isFileUri(value) ? value : undefined
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined
  }

  try {
    const uri = vscode.Uri.parse(value.trim(), true)
    return isFileUri(uri) ? uri : undefined
  } catch {
    return undefined
  }
}

function requireApiFileUri(value: unknown): vscode.Uri {
  const uri = parseApiFileUri(value)
  if (!uri) {
    throw new Error(
      vscode.l10n.t('OmegaEdit Hex Editor can only open local files')
    )
  }
  return uri
}

function normalizeRevealOptions(
  uriOrOptions: vscode.Uri | string | OmegaEditRevealOptions,
  offset?: number
): { uri?: vscode.Uri | string; offset: number } {
  const normalizeOffset = (value: unknown): number => {
    if (!Number.isSafeInteger(value) || Number(value) < 0) {
      throw new Error(
        vscode.l10n.t('OmegaEdit requires a non-negative integer offset')
      )
    }
    return Number(value)
  }

  if (isRecord(uriOrOptions) && 'offset' in uriOrOptions) {
    const options: { uri?: vscode.Uri; offset: number } = {
      offset: normalizeOffset(uriOrOptions.offset),
    }
    if ('uri' in uriOrOptions && uriOrOptions.uri !== undefined) {
      options.uri = requireApiFileUri(uriOrOptions.uri)
    }
    return options
  }

  return {
    uri: requireApiFileUri(uriOrOptions),
    offset: normalizeOffset(offset),
  }
}

function parseOffsetInput(value: string): number | undefined {
  const text = value.trim()
  if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(text)) {
    return undefined
  }
  const offset = text.toLowerCase().startsWith('0x')
    ? Number.parseInt(text.slice(2), 16)
    : Number.parseInt(text, 10)
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : undefined
}

function transformPluginFileExtension(): string {
  switch (os.platform()) {
    case 'win32':
      return '.dll'
    case 'darwin':
      return '.dylib'
    default:
      return '.so'
  }
}

function directoryHasTransformPlugin(directory: string): boolean {
  try {
    const extension = transformPluginFileExtension()
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .some(
        (entry) =>
          entry.isFile() &&
          entry.name.startsWith('omega_transform_') &&
          entry.name.endsWith(extension)
      )
  } catch {
    return false
  }
}

function getDefaultTransformPluginDirectories(
  context: vscode.ExtensionContext
): string[] {
  const repoRoot = path.resolve(context.extensionPath, '..', '..')
  const candidates = [
    process.env.OMEGA_EDIT_TEST_PLUGIN_DIR ?? '',
    path.join(repoRoot, '_build_core', 'plugins', 'plugins'),
    path.join(repoRoot, '_build_core', 'core', 'src', 'tests', 'plugins'),
    path.join(repoRoot, '_build', 'plugins', 'plugins'),
    path.join(repoRoot, 'build', 'core', 'src', 'tests', 'plugins'),
    path.join(repoRoot, 'build-coverage', 'core', 'src', 'tests', 'plugins'),
  ].filter(Boolean)

  return candidates.filter(directoryHasTransformPlugin)
}

function resolveTransformPluginDirectories(
  context: vscode.ExtensionContext,
  config: vscode.WorkspaceConfiguration
): string[] {
  const configuredValue = config.get<unknown>('transformPluginDirectories', [])
  const configured = Array.isArray(configuredValue)
    ? configuredValue
        .filter(
          (directory): directory is string =>
            typeof directory === 'string' && directory.trim().length > 0
        )
        .map((directory) => directory.trim())
    : []

  return configured.length > 0
    ? configured
    : getDefaultTransformPluginDirectories(context)
}

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test'
}

function hasExplicitServerPortConfiguration(
  config: vscode.WorkspaceConfiguration
): boolean {
  const inspected = config.inspect<unknown>('serverPort')
  return !!(
    inspected &&
    (inspected.globalValue !== undefined ||
      inspected.workspaceValue !== undefined ||
      inspected.workspaceFolderValue !== undefined ||
      inspected.globalLanguageValue !== undefined ||
      inspected.workspaceLanguageValue !== undefined ||
      inspected.workspaceFolderLanguageValue !== undefined)
  )
}

function platformCanAttemptUnixSocket(): boolean {
  return process.platform === 'darwin' || process.platform === 'linux'
}

function resolveServerSocketOverride(): string | undefined {
  const value = process.env[SERVER_SOCKET_OVERRIDE_ENV]?.trim()
  return value && value.length > 0 ? value : undefined
}

function getDefaultServerSocketDirectory(): string {
  if (process.platform === 'linux') {
    const xdgRuntimeDir = process.env.XDG_RUNTIME_DIR?.trim()
    if (xdgRuntimeDir && path.isAbsolute(xdgRuntimeDir)) {
      return path.join(xdgRuntimeDir, 'omega-edit')
    }
  }

  return os.tmpdir()
}

function getDefaultServerSocketPath(): string {
  return path.join(
    getDefaultServerSocketDirectory(),
    `omega-edit-vscode-${process.pid}.sock`
  )
}

function resolveServerPort(config: vscode.WorkspaceConfiguration): number {
  const envPort = parseServerPort(process.env[SERVER_PORT_OVERRIDE_ENV])
  if (envPort !== undefined) {
    return envPort
  }

  return (
    parseServerPort(config.get<unknown>('serverPort')) ?? DEFAULT_SERVER_PORT
  )
}

function resolveServerConnection(
  config: vscode.WorkspaceConfiguration
): ServerConnection {
  const socketOverride = resolveServerSocketOverride()
  if (socketOverride !== undefined) {
    if (!platformCanAttemptUnixSocket()) {
      throw new Error(UNIX_SOCKET_UNSUPPORTED_MESSAGE)
    }

    return {
      kind: 'unix',
      port: DEFAULT_SERVER_PORT,
      socketPath: socketOverride,
    }
  }

  const envPort = parseServerPort(process.env[SERVER_PORT_OVERRIDE_ENV])
  if (envPort !== undefined) {
    return { kind: 'tcp', port: envPort }
  }

  if (hasExplicitServerPortConfiguration(config)) {
    const configuredPort = parseServerPort(config.get<unknown>('serverPort'))
    if (configuredPort !== undefined) {
      return { kind: 'tcp', port: configuredPort }
    }
  }

  if (platformCanAttemptUnixSocket()) {
    return {
      kind: 'unix',
      port: DEFAULT_SERVER_PORT,
      socketPath: getDefaultServerSocketPath(),
    }
  }

  return { kind: 'tcp', port: resolveServerPort(config) }
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function toTcpConnection(connection: ServerConnection): ServerConnection {
  return { kind: 'tcp', port: connection.port }
}

function removeServerSocketFile(socketPath: string): void {
  try {
    fs.unlinkSync(socketPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(
        `Failed to remove OmegaEdit server socket ${socketPath}: ${toErrorMessage(err)}`
      )
    }
  }
}

async function startTcpServerConnection(
  connection: ServerConnection,
  transformPluginDirectories: string[]
): Promise<StartedServer> {
  const tcpConnection = toTcpConnection(connection)
  return {
    connection: tcpConnection,
    serverPid: await startServer(tcpConnection.port, undefined, undefined, {
      transformPluginDirectories,
    }),
  }
}

async function startServerConnection(
  connection: ServerConnection,
  transformPluginDirectories: string[]
): Promise<StartedServer> {
  if (connection.kind === 'tcp') {
    return startTcpServerConnection(connection, transformPluginDirectories)
  }

  return {
    connection,
    serverPid: await startServerUnixSocket(
      connection.socketPath,
      undefined,
      true,
      connection.port,
      undefined,
      { transformPluginDirectories }
    ),
  }
}

async function connectToServer(connection: ServerConnection): Promise<void> {
  if (connection.kind === 'unix') {
    await getClient(connection.port, undefined, {
      socketPath: connection.socketPath,
    })
    return
  }

  await getClient(connection.port)
}

function resolveLogLevel(config: vscode.WorkspaceConfiguration): string {
  const value = config.get<unknown>('logLevel', 'info')
  return typeof value === 'string' && VALID_LOG_LEVELS.has(value)
    ? value
    : 'info'
}

function reportActivationError(message: string): void {
  if (isTestRuntime()) {
    console.error(message)
    return
  }

  void vscode.window.showErrorMessage(message)
}

function createOmegaEditExtensionApi(
  provider: HexEditorProvider
): OmegaEditExtensionApi {
  return {
    version: OMEGA_EDIT_EXTENSION_API_VERSION,
    onDidChangeEditorState: provider.onDidChangeEditorState,
    async open(uri: vscode.Uri, options: OmegaEditOpenOptions = {}) {
      const target = requireApiFileUri(uri)
      await vscode.commands.executeCommand(
        'vscode.openWith',
        target,
        OMEGA_EDIT_VIEW_TYPE
      )

      if (options.offset === undefined) {
        return provider.getEditorState({ uri: target })
      }

      return provider.revealOffset(
        normalizeRevealOptions(target, options.offset)
      )
    },
    async reveal(uriOrOptions, offset) {
      return provider.revealOffset(normalizeRevealOptions(uriOrOptions, offset))
    },
    getEditorState(options) {
      return provider.getEditorState(options)
    },
    async setExternalHighlights(request: OmegaEditExternalHighlightRequest) {
      return provider.setExternalHighlights(request)
    },
    clearExternalHighlights(options) {
      return provider.clearExternalHighlights(options)
    },
  }
}

export async function activate(
  context: vscode.ExtensionContext
): Promise<OmegaEditExtensionApi | undefined> {
  const config = vscode.workspace.getConfiguration('omegaEdit')

  let connection: ServerConnection
  try {
    connection = resolveServerConnection(config)
  } catch (err) {
    reportActivationError(
      vscode.l10n.t('Failed to start Ωedit™ server: {message}', {
        message: toErrorMessage(err),
      })
    )
    return
  }

  const logLevel = resolveLogLevel(config)
  process.env.OMEGA_EDIT_CLIENT_LOG_LEVEL = logLevel
  const transformPluginDirectories = resolveTransformPluginDirectories(
    context,
    config
  )

  let startedServer: StartedServer
  try {
    startedServer = await startServerConnection(
      connection,
      transformPluginDirectories
    )
    activeServerSocketPath =
      startedServer.connection.kind === 'unix'
        ? startedServer.connection.socketPath
        : undefined
  } catch (err) {
    reportActivationError(
      vscode.l10n.t('Failed to start Ωedit™ server: {message}', {
        message: toErrorMessage(err),
      })
    )
    return
  }

  try {
    await connectToServer(startedServer.connection)
  } catch {
    try {
      await stopServerGraceful()
    } catch {
      // Best effort cleanup; activation will report the connection failure.
    }
    if (startedServer.connection.kind === 'unix') {
      removeServerSocketFile(startedServer.connection.socketPath)
      activeServerSocketPath = undefined
    }
    reportActivationError(
      vscode.l10n.t('Ωedit™ server started but is not reachable')
    )
    return
  }

  if (startedServer.serverPid && !isTestRuntime()) {
    if (startedServer.connection.kind === 'unix') {
      void vscode.window.showInformationMessage(
        vscode.l10n.t(
          'Ωedit™ server started on Unix socket {socketPath} (pid {pid})',
          {
            socketPath: startedServer.connection.socketPath,
            pid: startedServer.serverPid,
          }
        )
      )
    } else {
      void vscode.window.showInformationMessage(
        vscode.l10n.t('Ωedit™ server started on port {port} (pid {pid})', {
          port: startedServer.connection.port,
          pid: startedServer.serverPid,
        })
      )
    }
  }

  const provider = new HexEditorProvider(context)
  activeProvider = provider

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      HexEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    )
  )

  context.subscriptions.push(
    vscode.commands.registerCommand(
      OMEGA_EDIT_OPEN_IN_HEX_EDITOR_COMMAND,
      async (resource?: vscode.Uri) => {
        let target = resource ?? vscode.window.activeTextEditor?.document.uri

        if (!target) {
          target = (
            await vscode.window.showOpenDialog({
              canSelectMany: false,
              canSelectFiles: true,
              canSelectFolders: false,
              openLabel: vscode.l10n.t('Open in Ωedit™ Hex Editor'),
              title: vscode.l10n.t(
                'Select a file to open in Ωedit™ Hex Editor'
              ),
            })
          )?.[0]
        }

        if (!target) {
          return
        }

        if (!isFileUri(target)) {
          void vscode.window.showWarningMessage(
            vscode.l10n.t('OmegaEdit Hex Editor can only open local files')
          )
          return
        }

        await vscode.commands.executeCommand(
          'vscode.openWith',
          target,
          OMEGA_EDIT_VIEW_TYPE
        )
      }
    )
  )

  context.subscriptions.push(
    vscode.commands.registerCommand(
      OMEGA_EDIT_GO_TO_OFFSET_COMMAND,
      async () => {
        const input = await vscode.window.showInputBox({
          prompt: vscode.l10n.t('Enter byte offset (decimal or 0x hex)'),
          placeHolder: '0x0000',
          validateInput: (value) => {
            const offset = parseOffsetInput(value)
            return offset === undefined
              ? vscode.l10n.t('Enter a valid non-negative integer')
              : null
          },
        })

        if (input !== undefined) {
          const offset = parseOffsetInput(input)
          if (offset !== undefined) {
            provider.goToOffset(offset)
          }
        }
      }
    )
  )

  context.subscriptions.push(
    vscode.commands.registerCommand(OMEGA_EDIT_UNDO_COMMAND, async () => {
      await provider.undoActive()
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand(OMEGA_EDIT_REDO_COMMAND, async () => {
      await provider.redoActive()
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand(OMEGA_EDIT_SEARCH_NEXT_COMMAND, () => {
      provider.searchNextActive()
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand(OMEGA_EDIT_SEARCH_PREVIOUS_COMMAND, () => {
      provider.searchPreviousActive()
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand(
      OMEGA_EDIT_REFRESH_TRANSFORM_PLUGINS_COMMAND,
      async () => {
        await provider.refreshActiveTransformPlugins()
      }
    )
  )

  context.subscriptions.push(
    vscode.commands.registerCommand(
      OMEGA_EDIT_EXPORT_CHANGE_SCRIPT_COMMAND,
      async () => {
        await provider.exportActiveChangeScript()
      }
    )
  )

  context.subscriptions.push(
    vscode.commands.registerCommand(
      OMEGA_EDIT_REPLAY_CHANGE_SCRIPT_COMMAND,
      async () => {
        await provider.replayActiveChangeScript()
      }
    )
  )

  context.subscriptions.push(
    vscode.commands.registerCommand(
      OMEGA_EDIT_ROLLBACK_SESSION_COMMAND,
      async () => {
        await provider.rollbackActiveSession()
      }
    )
  )

  context.subscriptions.push(
    vscode.commands.registerCommand(
      OMEGA_EDIT_ROLLBACK_CHECKPOINT_COMMAND,
      async () => {
        await provider.rollbackActiveCheckpoint()
      }
    )
  )

  context.subscriptions.push(
    vscode.commands.registerCommand(
      OMEGA_EDIT_CREATE_CHECKPOINT_COMMAND,
      async () => {
        await provider.createActiveCheckpoint()
      }
    )
  )

  context.subscriptions.push(
    vscode.commands.registerCommand(
      OMEGA_EDIT_GET_EDITOR_STATE_COMMAND,
      (options?: unknown) => provider.getEditorState(options)
    )
  )

  context.subscriptions.push(
    vscode.commands.registerCommand(
      OMEGA_EDIT_SET_EXTERNAL_HIGHLIGHTS_COMMAND,
      async (highlightsOrRequest?: unknown, options?: unknown) =>
        provider.setExternalHighlights(highlightsOrRequest, options)
    )
  )

  context.subscriptions.push(
    vscode.commands.registerCommand(
      OMEGA_EDIT_CLEAR_EXTERNAL_HIGHLIGHTS_COMMAND,
      (options?: unknown) => provider.clearExternalHighlights(options)
    )
  )

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('omegaEdit.bytesPerRow')) {
        provider.refreshBytesPerRow()
      }
    })
  )

  return createOmegaEditExtensionApi(provider)
}

export async function deactivate(): Promise<void> {
  activeProvider = undefined
  const socketPath = activeServerSocketPath
  activeServerSocketPath = undefined

  try {
    await stopServerGraceful()
  } catch {
    // Server may already be stopped; swallow errors during deactivation.
  }

  if (socketPath) {
    removeServerSocketFile(socketPath)
  }
}

export function getHexEditorProviderForTesting():
  | HexEditorProvider
  | undefined {
  return isTestRuntime() ? activeProvider : undefined
}
