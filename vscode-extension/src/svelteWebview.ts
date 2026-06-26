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

import * as crypto from 'node:crypto'
import * as vscode from 'vscode'
import { type BytesPerRow, normalizeBytesPerRow } from './webviewProtocol'

const SVELTE_WEBVIEW_OUT_DIR = ['out', 'svelte-webview'] as const
const AUTO_WEBVIEW_LANGUAGE = 'auto'
const SUPPORTED_WEBVIEW_LANGUAGES = new Set(['en', 'es'])
const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ps', 'ur'])

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function nonce(): string {
  return crypto.randomBytes(16).toString('base64')
}

function textDirectionForLanguage(language: string): 'ltr' | 'rtl' {
  const [baseLanguage] = language
    .trim()
    .replace(/_/g, '-')
    .toLowerCase()
    .split('-')
  return RTL_LANGUAGES.has(baseLanguage) ? 'rtl' : 'ltr'
}

function normalizeLanguage(language: string): string {
  return language.trim().replace(/_/g, '-').toLowerCase()
}

function resolveWebviewLanguage(): string {
  const config = vscode.workspace.getConfiguration('omegaEdit')
  const configuredLanguage = normalizeLanguage(
    config.get<string>('language', AUTO_WEBVIEW_LANGUAGE)
  )
  if (configuredLanguage === AUTO_WEBVIEW_LANGUAGE) {
    return vscode.env.language || 'en'
  }
  return SUPPORTED_WEBVIEW_LANGUAGES.has(configuredLanguage)
    ? configuredLanguage
    : vscode.env.language || 'en'
}

export function getSvelteWebviewLocalResourceRoot(
  extensionUri: vscode.Uri
): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, ...SVELTE_WEBVIEW_OUT_DIR)
}

export function getSvelteWebviewContent(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  bytesPerRow: BytesPerRow
): string {
  const resourceRoot = getSvelteWebviewLocalResourceRoot(extensionUri)
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(resourceRoot, 'webview.js')
  )
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(resourceRoot, 'webview.css')
  )
  const cspSource = escapeHtmlAttribute(webview.cspSource)
  const scriptNonce = nonce()
  const normalizedBytesPerRow = normalizeBytesPerRow(bytesPerRow)
  const language = resolveWebviewLanguage()
  const escapedLanguage = escapeHtmlAttribute(language)
  const textDirection = textDirectionForLanguage(language)
  const title = escapeHtmlText(vscode.l10n.t('OmegaEdit Data Editor'))
  const loading = escapeHtmlText(
    vscode.l10n.t('Loading OmegaEdit Data Editor...')
  )

  return `<!DOCTYPE html>
<html lang="${escapedLanguage}" dir="${textDirection}">
<head>
  <meta charset="UTF-8">
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource}; script-src 'nonce-${scriptNonce}' ${cspSource};"
  >
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>${title}</title>
</head>
<body>
  <div id="app" data-bytes-per-row="${normalizedBytesPerRow}" data-locale="${escapedLanguage}">
    <p class="bootstrap-status">${loading}</p>
  </div>
  <script nonce="${scriptNonce}" type="module" src="${scriptUri.toString()}"></script>
</body>
</html>`
}
