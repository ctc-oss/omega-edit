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

/**
 * Ωedit™ Hex Editor — VS Code Extension Entry Point
 *
 * This file demonstrates the minimal lifecycle management needed to integrate
 * Ωedit™ into a VS Code extension:
 *   1. activate()  — start the Ωedit™ gRPC server
 *   2. Register a CustomReadonlyEditorProvider (HexEditorProvider)
 *   3. deactivate() — gracefully shut down the server
 */

import * as vscode from 'vscode'
import { startServer, stopServerGraceful, getClient } from '@omega-edit/client'
import { HexEditorProvider } from './hexEditorProvider'

let serverPid: number | undefined

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('omegaEdit')
  const port = config.get<number>('serverPort', 9000)

  // Set log level from configuration before starting
  const logLevel = config.get<string>('logLevel', 'info')
  process.env.OMEGA_EDIT_CLIENT_LOG_LEVEL = logLevel

  // --- Step 1: Start the Ωedit™ gRPC server ---
  // The server binary is bundled inside @omega-edit/client, so no external
  // install is needed. startServer() spawns it as a child process.
  try {
    serverPid = await startServer(port)
    if (serverPid) {
      vscode.window.showInformationMessage(
        `Ωedit™ server started on port ${port} (pid ${serverPid})`
      )
    }
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to start Ωedit™ server: ${err instanceof Error ? err.message : String(err)}`
    )
    return
  }

  // Verify the server is reachable
  try {
    const client = await getClient(port)
    const { waitForReady } = await import('@omega-edit/client')
    await waitForReady(client)
  } catch {
    vscode.window.showErrorMessage('Ωedit™ server started but is not reachable')
    return
  }

  // --- Step 2: Register the hex editor ---
  const provider = new HexEditorProvider(context, port)
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

  // --- Commands ---
  context.subscriptions.push(
    vscode.commands.registerCommand('omegaEdit.goToOffset', async () => {
      const input = await vscode.window.showInputBox({
        prompt: 'Enter byte offset (decimal or 0x hex)',
        placeHolder: '0x0000',
        validateInput: (v) => {
          const n = v.startsWith('0x') ? parseInt(v, 16) : parseInt(v, 10)
          return isNaN(n) || n < 0 ? 'Enter a valid non-negative integer' : null
        },
      })
      if (input !== undefined) {
        const offset = input.startsWith('0x') ? parseInt(input, 16) : parseInt(input, 10)
        provider.goToOffset(offset)
      }
    })
  )

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('omegaEdit.bytesPerRow')) {
        provider.refreshBytesPerRow()
      }
    })
  )
}

export async function deactivate(): Promise<void> {
  // --- Step 3: Graceful shutdown ---
  // stopServerGraceful() tells the server to stop accepting new sessions and
  // exit once all existing sessions are destroyed. This mirrors the pattern
  // used by the Apache Daffodil™ VS Code extension.
  try {
    await stopServerGraceful()
  } catch {
    // Server may already be stopped; swallow errors during deactivation
  }
}
