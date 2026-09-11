/*
 * Copyright (c) 2026 Concurrent Technologies Corporation.
 * Licensed under the Apache License, Version 2.0.
 * You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
 */

import * as vscode from 'vscode'
import type { OmegaEditExtensionApi } from './omegaEditApi'

/** Activate the installed extension; no OmegaEdit npm package is required. */
export async function getOmegaEditApi(): Promise<OmegaEditExtensionApi> {
  const id = 'ctc-oss.omega-edit-data-editor'
  const extension = vscode.extensions.getExtension<OmegaEditExtensionApi>(id)
  if (!extension) {
    throw new Error(
      `OmegaEdit Data Editor (${id}) is unavailable. Install or enable it and reload VS Code.`
    )
  }

  let api: OmegaEditExtensionApi
  try {
    api = await extension.activate()
  } catch (error) {
    throw new Error(
      `Could not activate OmegaEdit Data Editor: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (
    !api ||
    api.extensionId !== id ||
    api.version !== 2 ||
    typeof api.open !== 'function' ||
    typeof api.setExternalHighlights !== 'function' ||
    typeof api.clearExternalHighlights !== 'function'
  ) {
    throw new Error(
      'Incompatible OmegaEdit Data Editor API. This integration requires API version 2; update the extension or integration.'
    )
  }
  return api
}
