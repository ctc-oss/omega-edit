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

import { getClient, startServer, stopServerGraceful } from '@omega-edit/client'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'
import {
  OMEGA_EDIT_CREATE_CHECKPOINT_COMMAND,
  OMEGA_EDIT_EXPORT_CHANGE_SCRIPT_COMMAND,
  OMEGA_EDIT_GO_TO_OFFSET_COMMAND,
  OMEGA_EDIT_OPEN_IN_HEX_EDITOR_COMMAND,
  OMEGA_EDIT_REDO_COMMAND,
  OMEGA_EDIT_REPLAY_CHANGE_SCRIPT_COMMAND,
  OMEGA_EDIT_ROLLBACK_CHECKPOINT_COMMAND,
  OMEGA_EDIT_ROLLBACK_SESSION_COMMAND,
  OMEGA_EDIT_UNDO_COMMAND,
  OMEGA_EDIT_VIEW_TYPE,
} from './constants'
import { HexEditorProvider } from './hexEditorProvider'

let serverPid: number | undefined
let activeProvider: HexEditorProvider | undefined

const DEFAULT_SERVER_PORT = 9000
const SERVER_PORT_OVERRIDE_ENV = 'OMEGA_EDIT_SERVER_PORT'

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
  const configured = config
    .get<string[]>('transformPluginDirectories', [])
    .filter((directory) => directory.trim().length > 0)

  return configured.length > 0
    ? configured
    : getDefaultTransformPluginDirectories(context)
}

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test'
}

function resolveServerPort(config: vscode.WorkspaceConfiguration): number {
  const envPort = Number.parseInt(
    process.env[SERVER_PORT_OVERRIDE_ENV] ?? '',
    10
  )
  if (Number.isInteger(envPort) && envPort > 0 && envPort <= 65535) {
    return envPort
  }

  return config.get<number>('serverPort', DEFAULT_SERVER_PORT)
}

function reportActivationError(message: string): void {
  if (isTestRuntime()) {
    console.error(message)
    return
  }

  void vscode.window.showErrorMessage(message)
}

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const config = vscode.workspace.getConfiguration('omegaEdit')
  const port = resolveServerPort(config)

  const logLevel = config.get<string>('logLevel', 'info')
  process.env.OMEGA_EDIT_CLIENT_LOG_LEVEL = logLevel
  const transformPluginDirectories = resolveTransformPluginDirectories(
    context,
    config
  )

  try {
    serverPid = await startServer(port, undefined, undefined, {
      transformPluginDirectories,
    })
    if (serverPid && !isTestRuntime()) {
      void vscode.window.showInformationMessage(
        `Ωedit™ server started on port ${port} (pid ${serverPid})`
      )
    }
  } catch (err) {
    reportActivationError(
      `Failed to start Ωedit™ server: ${err instanceof Error ? err.message : String(err)}`
    )
    return
  }

  try {
    await getClient(port)
  } catch {
    reportActivationError('Ωedit™ server started but is not reachable')
    return
  }

  const provider = new HexEditorProvider(context, port)
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
              openLabel: 'Open in Ωedit™ Hex Editor',
              title: 'Select a file to open in Ωedit™ Hex Editor',
            })
          )?.[0]
        }

        if (!target) {
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
          prompt: 'Enter byte offset (decimal or 0x hex)',
          placeHolder: '0x0000',
          validateInput: (value) => {
            const offset = value.startsWith('0x')
              ? parseInt(value, 16)
              : parseInt(value, 10)
            return Number.isNaN(offset) || offset < 0
              ? 'Enter a valid non-negative integer'
              : null
          },
        })

        if (input !== undefined) {
          const offset = input.startsWith('0x')
            ? parseInt(input, 16)
            : parseInt(input, 10)
          provider.goToOffset(offset)
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
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('omegaEdit.bytesPerRow')) {
        provider.refreshBytesPerRow()
      }
    })
  )
}

export async function deactivate(): Promise<void> {
  activeProvider = undefined

  try {
    await stopServerGraceful()
  } catch {
    // Server may already be stopped; swallow errors during deactivation.
  }
}

export function getHexEditorProviderForTesting():
  | HexEditorProvider
  | undefined {
  return isTestRuntime() ? activeProvider : undefined
}
