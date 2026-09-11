/*
 * Copyright (c) 2026 Concurrent Technologies Corporation.
 * Licensed under the Apache License, Version 2.0.
 * You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const helper = fs.readFileSync(
  path.join(root, 'integration/omegaEdit.ts'),
  'utf8'
)

function loadHelper(extension) {
  const exports = {}
  const { outputText } = ts.transpileModule(helper, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  })
  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      assert.equal(
        name,
        'vscode',
        'The helper must not import an OmegaEdit runtime'
      )
      return {
        extensions: {
          getExtension(id) {
            assert.equal(id, 'ctc-oss.omega-edit-data-editor')
            return extension
          },
        },
      }
    },
  })
  return exports.getOmegaEditApi
}

test('copied consumer files compile with only VS Code types', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-edit-consumer-'))
  try {
    for (const file of ['omegaEdit.ts', 'omegaEditApi.d.ts']) {
      fs.copyFileSync(
        path.join(root, 'integration', file),
        path.join(dir, file)
      )
    }
    const contract = fs.readFileSync(
      path.join(dir, 'omegaEditApi.d.ts'),
      'utf8'
    )
    assert.equal(
      contract,
      fs.readFileSync(path.join(root, 'out/api.d.ts'), 'utf8')
    )
    const consumer = path.join(dir, 'consumer.ts')
    fs.writeFileSync(
      consumer,
      `
import * as vscode from 'vscode'
import { getOmegaEditApi } from './omegaEdit'
import type { OmegaEditExtensionApi } from './omegaEditApi'
async function integrate() {
  const api: OmegaEditExtensionApi = await getOmegaEditApi()
  const uri = vscode.Uri.file('/data.bin')
  await api.open(uri)
  await api.setExternalHighlights({ uri, reveal: true, highlights: [
    { id: 'current', offset: 0, length: 1, kind: 'current', label: 'Parser' }
  ] })
  api.clearExternalHighlights({ uri })
  // @ts-expect-error URI selectors cannot be numbers
  api.clearExternalHighlights({ uri: 42 })
}
`
    )
    const program = ts.createProgram(
      [consumer, require.resolve('@types/vscode/index.d.ts')],
      {
        strict: true,
        noEmit: true,
        types: [],
        skipLibCheck: false,
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
      }
    )
    const diagnostics = ts.getPreEmitDiagnostics(program)
    assert.equal(
      diagnostics.length,
      0,
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (file) => file,
        getCurrentDirectory: () => dir,
        getNewLine: () => '\n',
      })
    )
    const localImports = program
      .getSourceFiles()
      .filter(
        (file) =>
          file.fileName.includes('omega-edit') &&
          !file.fileName.startsWith(dir + path.sep) &&
          !file.fileName.includes('node_modules')
      )
    assert.deepEqual(
      localImports.map((file) => file.fileName),
      []
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('consumer helper returns the installed extension API', async () => {
  const api = {
    extensionId: 'ctc-oss.omega-edit-data-editor',
    version: 2,
    open() {},
    setExternalHighlights() {},
    clearExternalHighlights() {},
  }
  assert.equal(await loadHelper({ activate: async () => api })(), api)
})

test('consumer helper explains missing, incompatible, and failed activation', async () => {
  await assert.rejects(loadHelper(undefined)(), /Install or enable/)
  for (const api of [undefined, null, {}, { version: 1 }, { version: 2 }]) {
    await assert.rejects(
      loadHelper({ activate: async () => api })(),
      /Incompatible/
    )
  }
  await assert.rejects(
    loadHelper({
      activate: async () => {
        throw 'startup failed'
      },
    })(),
    /Could not activate OmegaEdit Data Editor: startup failed/
  )
})
