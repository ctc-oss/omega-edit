/*
 * Copyright (c) 2026 Concurrent Technologies Corporation.
 * Licensed under the Apache License, Version 2.0.
 * You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
 */

import * as vscode from 'vscode'
import type { OmegaEditExtensionApi } from './omegaEditApi'

const OMEGA_EDIT_EXTENSION_ID = 'ctc-oss.omega-edit-data-editor'
const EXPECTED_API_VERSION = 2

/** Activate the installed extension; no OmegaEdit npm package is required. */
export async function getOmegaEditApi(): Promise<OmegaEditExtensionApi> {
  const extension = vscode.extensions.getExtension<OmegaEditExtensionApi>(
    OMEGA_EDIT_EXTENSION_ID
  )
  if (!extension) {
    throw new Error(
      `OmegaEdit Data Editor (${OMEGA_EDIT_EXTENSION_ID}) is unavailable. Install or enable it and reload VS Code.`
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
    api.extensionId !== OMEGA_EDIT_EXTENSION_ID ||
    api.version !== EXPECTED_API_VERSION ||
    typeof api.open !== 'function' ||
    typeof api.setExternalHighlights !== 'function' ||
    typeof api.clearExternalHighlights !== 'function'
  ) {
    throw new Error(
      `Incompatible OmegaEdit Data Editor API. This integration requires API version ${EXPECTED_API_VERSION}; update the extension or integration.`
    )
  }
  return api
}
