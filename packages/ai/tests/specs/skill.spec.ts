/*
 * Copyright (c) 2026 Concurrent Technologies Corporation.
 * Licensed under the Apache License, Version 2.0.
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import { strict as assert } from 'assert'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { findFirstAvailablePort } from '@omega-edit/client'
import { describe, it } from 'vitest'
import { OmegaEditToolkit } from '../../src/service'
import type { PatchPreview, ReadRangeResult } from '../../src/types'

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
)
const skillRoot = path.join(packageRoot, 'skills/omega-edit')
const skillFiles = [
  'SKILL.md',
  'references/dfdl.md',
  'references/reverse-engineering.md',
  'references/byte-edit.json',
]

type SkillExample = {
  cli: string[]
  mcp: { name: string; arguments: Record<string, string | number | boolean> }
}

type SkillFixture = {
  inputHex: string
  outputHex: string
  offset: number
  expectedBeforeHex: string
  replacementHex: string
  examples: SkillExample[]
}

function readSkillFile(relativePath: string): string {
  const filePath = path.join(skillRoot, relativePath)
  assert.ok(
    fs.existsSync(filePath),
    `missing shipped skill asset: ${relativePath}`
  )
  return fs.readFileSync(filePath, 'utf8')
}

function readFixture(): SkillFixture {
  return JSON.parse(readSkillFile('references/byte-edit.json')) as SkillFixture
}

function runNode(script: string, args: string[] = [], input?: string) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, OMEGA_EDIT_CLIENT_LOG_LEVEL: 'fatal' },
    input,
    timeout: 10_000,
  })
  assert.ifError(result.error)
  return result
}

describe('@omega-edit/ai portable skill', () => {
  it('ships concise portable metadata and complete workflow references', () => {
    const skill = readSkillFile('SKILL.md')
    const frontmatter = /^---\n([\s\S]+?)\n---\n/.exec(skill)
    assert.ok(frontmatter, 'skill must start with YAML frontmatter')
    assert.match(frontmatter[1], /^name: omega-edit$/m)
    assert.match(frontmatter[1], /^license: Apache-2\.0$/m)
    const description = /^description: (.+)$/m.exec(frontmatter[1])?.[1]
    assert.ok(description)
    assert.ok(description.length <= 60)
    assert.ok(description.endsWith('.'))
    assert.match(frontmatter[1], /^compatibility: .+Node\.js 22/m)
    assert.match(frontmatter[1], /^  version: ['"]?0\.1\.0['"]?$/m)
    assert.match(frontmatter[1], /^  author: .+Hermes Agent$/m)
    for (const section of [
      'When to Use',
      'Prerequisites',
      'Procedure',
      'Pitfalls',
      'Verification',
    ]) {
      assert.ok(skill.includes(`## ${section}`), `missing ${section} procedure`)
    }
    for (const relativePath of skillFiles.slice(1)) {
      assert.ok(
        skill.includes(`(${relativePath})`),
        `unlinked asset: ${relativePath}`
      )
      readSkillFile(relativePath)
    }
    assert.doesNotMatch(skill, /\/home\/|\/Users\/|C:\\\\Users\\\\/)
    const normalizedSkill = skill.replace(/\s+/g, ' ')
    assert.match(normalizedSkill, /expected original bytes/i)
    assert.match(normalizedSkill, /not atomic/i)
    assert.match(normalizedSkill, /session.*exclusive|exclusive.*session/i)
    assert.match(normalizedSkill, /DFDL.*not.*built.in/i)
    assert.match(normalizedSkill, /reopen/i)
    assert.match(normalizedSkill, /destroy-session/)
    assert.match(normalizedSkill, /diff-session.*not.*full.*diff/i)
  })

  it('keeps the worked byte edit internally consistent', () => {
    const fixture = readFixture()
    for (const hex of [
      fixture.inputHex,
      fixture.outputHex,
      fixture.expectedBeforeHex,
      fixture.replacementHex,
    ]) {
      assert.match(hex, /^(?:[0-9a-f]{2})+$/)
    }
    const original = Buffer.from(fixture.inputHex, 'hex')
    const before = Buffer.from(fixture.expectedBeforeHex, 'hex')
    const replacement = Buffer.from(fixture.replacementHex, 'hex')
    assert.ok(Number.isSafeInteger(fixture.offset) && fixture.offset >= 0)
    assert.equal(
      before.length,
      replacement.length,
      'tutorial is a fixed-width overwrite'
    )
    assert.equal(
      original
        .subarray(fixture.offset, fixture.offset + before.length)
        .toString('hex'),
      fixture.expectedBeforeHex
    )
    const expected = Buffer.from(original)
    replacement.copy(expected, fixture.offset)
    assert.equal(expected.toString('hex'), fixture.outputHex)
    const previews = fixture.examples.filter(
      (example) => example.mcp.name === 'omega_edit_preview_patch'
    )
    const patches = fixture.examples.filter(
      (example) => example.mcp.name === 'omega_edit_apply_patch'
    )
    assert.equal(previews.length, 1)
    assert.equal(patches.length, 1)
    assert.deepEqual(previews[0].mcp.arguments, patches[0].mcp.arguments)
    assert.equal(patches[0].mcp.arguments.offset, fixture.offset)
    assert.equal(patches[0].mcp.arguments.hex, fixture.replacementHex)
    assert.equal(patches[0].mcp.arguments.operation, 'overwrite')
  })

  it('accepts every example through the real CLI without starting a server', async () => {
    const fixture = readFixture()
    const port = await findFirstAvailablePort(23000, 23999)
    assert.ok(port, 'expected an unused port for syntax validation')
    for (const example of fixture.examples) {
      const result = runNode(path.join(packageRoot, 'dist/cjs/cli.js'), [
        ...example.cli,
        '--no-autostart',
        '--port',
        String(port),
      ])
      assert.equal(result.status, 1, JSON.stringify(example.cli))
      const error = JSON.parse(result.stderr) as { error: string }
      assert.match(
        error.error,
        /OmegaEdit server is not running/,
        JSON.stringify(example.cli)
      )
      assert.equal(
        result.stdout,
        '',
        'failed commands must not emit a success result'
      )
    }
  })

  it('keeps CLI and MCP example arguments equivalent', () => {
    const aliases: Record<string, string> = {
      '--session': 'sessionId',
      '--file': 'filePath',
      '--output': 'outputPath',
      '--delete-length': 'deleteLength',
      '--context': 'previewContext',
    }
    const integerFields = new Set([
      'offset',
      'length',
      'limit',
      'deleteLength',
      'previewContext',
    ])
    for (const example of readFixture().examples) {
      const argumentsObject: Record<string, string | number | boolean> = {}
      for (let index = 1; index < example.cli.length; index += 1) {
        const option = example.cli[index]
        assert.ok(option.startsWith('--'), `expected an option: ${option}`)
        if (option === '--dry-run') {
          assert.equal(example.mcp.name, 'omega_edit_preview_patch')
          continue
        }
        const value = example.cli[++index]
        assert.ok(
          value !== undefined && !value.startsWith('--'),
          `missing value for ${option}`
        )
        const key = aliases[option] || option.slice(2)
        if (integerFields.has(key)) {
          assert.match(value, /^\d+$/)
          argumentsObject[key] = Number(value)
        } else {
          argumentsObject[key] = value
        }
      }
      assert.deepEqual(
        argumentsObject,
        example.mcp.arguments,
        JSON.stringify(example.cli)
      )
    }
  })

  it('executes the worked CLI edit and reopens verified native output', async () => {
    const fixture = readFixture()
    const port = await findFirstAvailablePort(23000, 23999)
    assert.ok(port, 'expected an unused port for the native example')
    const toolkit = new OmegaEditToolkit({ port, autoStart: true })
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'omega-edit-skill-live-')
    )
    const inputPath = path.join(tempDir, 'input.bin')
    const outputPath = path.join(tempDir, 'candidate.bin')
    const changeLogPath = path.join(tempDir, 'changes.json')
    const original = Buffer.from(fixture.inputHex, 'hex')
    fs.writeFileSync(inputPath, original)
    const sessions = new Set<string>()
    let sessionId = ''
    let started = false
    const invoke = <T>(args: string[]): T => {
      const result = runNode(path.join(packageRoot, 'dist/cjs/cli.js'), [
        ...args,
        '--no-autostart',
        '--port',
        String(port),
      ])
      assert.equal(
        result.status,
        0,
        `${JSON.stringify(args)}: ${result.stderr}`
      )
      return JSON.parse(result.stdout) as T
    }
    const read = (offset = 0, length = original.length) => {
      const result = invoke<ReadRangeResult>([
        'view',
        '--session',
        sessionId,
        '--offset',
        String(offset),
        '--length',
        String(length),
      ])
      assert.equal(result.actualLength, length)
      return result.data.hex
    }

    try {
      await toolkit.startServer()
      started = true
      for (const example of fixture.examples) {
        const replacements: Record<string, string> = {
          '<input>': inputPath,
          '<candidate>': outputPath,
          '<change-log>': changeLogPath,
          '<session-id>': sessionId,
        }
        const args = example.cli.map((arg) => replacements[arg] ?? arg)
        if (example.mcp.name === 'omega_edit_apply_patch') {
          assert.equal(
            read(fixture.offset, fixture.expectedBeforeHex.length / 2),
            fixture.expectedBeforeHex
          )
        }
        const result = invoke<Record<string, unknown>>(args)
        if (example.mcp.name === 'omega_edit_create_session') {
          assert.equal(typeof result.sessionId, 'string')
          sessionId = result.sessionId as string
          sessions.add(sessionId)
        } else if (example.mcp.name === 'omega_edit_preview_patch') {
          assert.equal(result.applied, false)
          const preview = result.preview as PatchPreview
          assert.equal(preview.targetBefore.hex, fixture.expectedBeforeHex)
          assert.equal(preview.targetAfter.hex, fixture.replacementHex)
          assert.equal(
            read(),
            fixture.inputHex,
            'preview must preserve content'
          )
        } else if (
          example.mcp.name === 'omega_edit_apply_patch' ||
          example.mcp.name === 'omega_edit_redo'
        ) {
          assert.equal(read(), fixture.outputHex)
        } else if (example.mcp.name === 'omega_edit_undo') {
          assert.equal(read(), fixture.inputHex)
        } else if (example.mcp.name === 'omega_edit_save_session') {
          assert.equal(result.status, 0)
          assert.equal(
            fs.realpathSync.native(result.filePath as string),
            fs.realpathSync.native(outputPath)
          )
        } else if (example.mcp.name === 'omega_edit_destroy_session') {
          sessions.delete(sessionId)
        }
      }
      const saved = fs.readFileSync(outputPath)
      assert.equal(saved.toString('hex'), fixture.outputHex)
      assert.equal(saved.length, original.length)
      assert.deepEqual(
        saved.subarray(0, fixture.offset),
        original.subarray(0, fixture.offset)
      )
      const end = fixture.offset + fixture.replacementHex.length / 2
      assert.deepEqual(saved.subarray(end), original.subarray(end))
      assert.deepEqual(
        fs.readFileSync(inputPath),
        original,
        'source must remain unchanged'
      )
      const changeLog = JSON.parse(fs.readFileSync(changeLogPath, 'utf8'))
      assert.equal(changeLog.complete, true)
      assert.equal(changeLog.changeCount, '1')

      const reopened = invoke<{ sessionId: string }>([
        'create-session',
        '--file',
        outputPath,
      ])
      sessionId = reopened.sessionId
      sessions.add(sessionId)
      assert.equal(
        read(),
        fixture.outputHex,
        'fresh session must read the saved bytes'
      )
      invoke(['destroy-session', '--session', sessionId])
      sessions.delete(sessionId)
    } finally {
      try {
        for (const id of sessions) await toolkit.destroySession(id)
      } finally {
        try {
          if (started) await toolkit.stopServer()
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      }
    }
  })

  it('matches each example to the live MCP input schema', () => {
    const fixture = readFixture()
    const requests = [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'skill-example-test', version: '1.0.0' },
        },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]
    const result = runNode(
      path.join(packageRoot, 'dist/cjs/mcp.js'),
      ['--no-autostart'],
      `${requests.map((request) => JSON.stringify(request)).join('\n')}\n`
    )
    assert.equal(result.status, 0, result.stderr)
    const messages = result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const tools = messages.find((message) => message.id === 2)?.result
      ?.tools as Array<{
      name: string
      inputSchema: {
        required?: string[]
        properties: Record<string, { type: string }>
      }
    }>
    assert.ok(
      Array.isArray(tools),
      'tools/list must return actual tool schemas'
    )
    for (const example of fixture.examples) {
      const tool = tools.find(
        (candidate) => candidate.name === example.mcp.name
      )
      assert.ok(tool, `missing MCP tool: ${example.mcp.name}`)
      for (const required of tool.inputSchema.required || []) {
        assert.ok(
          required in example.mcp.arguments,
          `${example.mcp.name} requires ${required}`
        )
      }
      for (const [key, value] of Object.entries(example.mcp.arguments)) {
        const property: { type: string } | undefined =
          tool.inputSchema.properties[key]
        assert.ok(property, `unknown argument: ${example.mcp.name}.${key}`)
        assert.equal(
          property.type === 'integer'
            ? Number.isSafeInteger(value)
            : typeof value === property.type,
          true,
          `${example.mcp.name}.${key}`
        )
      }
    }
  })

  it('includes the complete skill in a verified npm archive', () => {
    for (const relativePath of skillFiles) readSkillFile(relativePath)
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'omega-edit-skill-pack-')
    )
    try {
      const packed = spawnSync(
        process.platform === 'win32' ? 'npm.cmd' : 'npm',
        ['pack', '--ignore-scripts', '--json', '--pack-destination', tempDir],
        {
          cwd: packageRoot,
          encoding: 'utf8',
          shell: process.platform === 'win32',
          timeout: 30_000,
        }
      )
      assert.ifError(packed.error)
      assert.equal(packed.status, 0, packed.stderr)
      type NpmPackArchive = {
        filename: string
        files: Array<{ path: string }>
      }
      const packOutput = JSON.parse(packed.stdout) as
        | NpmPackArchive[]
        | Record<string, NpmPackArchive>
      const archives = Array.isArray(packOutput)
        ? packOutput
        : Object.values(packOutput)
      assert.equal(archives.length, 1, 'expected one npm archive')
      const [archive] = archives
      const entries = archive.files.map((file) => file.path)
      for (const relativePath of skillFiles) {
        assert.ok(
          entries.includes(`skills/omega-edit/${relativePath}`),
          `asset missing from npm archive: ${relativePath}`
        )
      }
      const verification = runNode(
        path.resolve(packageRoot, '../../scripts/verify-package-contents.js'),
        ['npm', path.join(tempDir, archive.filename)]
      )
      assert.equal(verification.status, 0, verification.stderr)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('rejects unrelated files instead of broadly allowing a skills directory', () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'omega-edit-skill-policy-')
    )
    const extraPaths = [
      'package/skills/omega-edit/extra.md',
      'package/skills/other/SKILL.md',
      'package/skills/omega-edit/references/unrelated.js',
      'package/src/unrelated.ts',
    ]
    try {
      for (const relativePath of ['package/package.json', ...extraPaths]) {
        const filePath = path.join(tempDir, relativePath)
        fs.mkdirSync(path.dirname(filePath), { recursive: true })
        fs.writeFileSync(
          filePath,
          relativePath.endsWith('package.json')
            ? '{}'
            : 'unexpected test payload'
        )
      }
      const archivePath = path.join(tempDir, 'unexpected.tar')
      const archive = spawnSync(
        'cmake',
        ['-E', 'tar', 'cf', archivePath, '--format=gnutar', 'package'],
        { cwd: tempDir, encoding: 'utf8', timeout: 10_000 }
      )
      assert.ifError(archive.error)
      assert.equal(archive.status, 0, archive.stderr)
      const verification = runNode(
        path.resolve(packageRoot, '../../scripts/verify-package-contents.js'),
        ['npm', archivePath]
      )
      assert.equal(verification.status, 1)
      assert.match(verification.stderr, /unexpected paths/)
      for (const relativePath of extraPaths)
        assert.ok(verification.stderr.includes(relativePath))
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
