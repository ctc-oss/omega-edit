#!/usr/bin/env node
/*
 * Copyright (c) 2026 Concurrent Technologies Corporation.
 * Licensed under the Apache License, Version 2.0.
 * You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
 */

const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const entry = path.join(root, 'out/api.d.ts')
const program = ts.createProgram([entry], { skipLibCheck: true })
const checker = program.getTypeChecker()
const selected = new Set()
const dependencies = []
const api = program.getSourceFile(entry)

// Follow declaration symbols rather than copying internal modules wholesale.
// Only types reachable from the public API belong in the consumer contract.
function include(statement) {
  if (selected.has(statement)) return
  selected.add(statement)
  dependencies.push(statement)
  function visit(node) {
    if (ts.isIdentifier(node)) {
      let symbol = checker.getSymbolAtLocation(node)
      if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
        symbol = checker.getAliasedSymbol(symbol)
      }
      for (const declaration of symbol?.declarations ?? []) {
        const source = declaration.getSourceFile()
        if (!source.fileName.startsWith(path.join(root, 'out') + path.sep)) continue
        let top = declaration
        while (top.parent && !ts.isSourceFile(top.parent)) top = top.parent
        if (!ts.isImportDeclaration(top) && !ts.isSourceFile(top)) include(top)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(statement)
}

for (const statement of api.statements) {
  if (!ts.isImportDeclaration(statement)) include(statement)
}

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
const declaration = [
  '// Copyright (c) 2026 Concurrent Technologies Corporation.',
  '// Licensed under the Apache License, Version 2.0.',
  '// https://www.apache.org/licenses/LICENSE-2.0',
  '// Generated from src/api.ts. Do not edit; run npm run compile:extension.',
  '// Copy with omegaEdit.ts into your extension. Only @types/vscode is required.',
  "import type * as vscode from 'vscode';",
  ...dependencies.map(statement => printer.printNode(
    ts.EmitHint.Unspecified, statement, statement.getSourceFile()
  )),
  '',
].join('\n\n')

// The package entrypoint and vendorable contract are identical and self-contained.
fs.writeFileSync(entry, declaration)
fs.writeFileSync(path.join(root, 'integration/omegaEditApi.d.ts'), declaration)
