import { strict as assert } from 'assert'

const LEGACY_SURFACE_FIELDS = [
  'vscodeCommand',
  'extensionApi',
  'cli',
  'mcpTool',
]

const ARRAY_SURFACE_FIELDS = [
  'vscodeCommands',
  'extensionApis',
  'cliCommands',
  'mcpTools',
]

export function assertAssistantCommandSurface(
  commands: unknown
): Array<Record<string, unknown>> {
  assert.ok(Array.isArray(commands), 'expected assistant commands array')
  assert.ok(commands.length > 0, 'expected assistant command entries')

  const entries = commands as Array<Record<string, unknown>>
  for (const entry of entries) {
    assert.equal(typeof entry.action, 'string', 'entry action is named')
    assert.equal(typeof entry.result, 'string', `${entry.action}.result`)

    for (const legacyField of LEGACY_SURFACE_FIELDS) {
      assert.equal(
        Object.hasOwn(entry, legacyField),
        false,
        `${entry.action}.${legacyField} must not leak legacy singular field`
      )
    }

    for (const arrayField of ARRAY_SURFACE_FIELDS) {
      if (!Object.hasOwn(entry, arrayField)) {
        continue
      }

      const values = entry[arrayField]
      assert.ok(Array.isArray(values), `${entry.action}.${arrayField}`)
      assert.ok(values.length > 0, `${entry.action}.${arrayField} not empty`)
      for (const value of values) {
        assert.equal(typeof value, 'string', `${entry.action}.${arrayField}`)
        assert.equal(
          value.includes(' / '),
          false,
          `${entry.action}.${arrayField} must use separate array values`
        )
      }
    }
  }

  const byAction = new Map(entries.map((entry) => [entry.action, entry]))
  assert.deepEqual(byAction.get('assistantContext')?.vscodeCommands, [
    'omegaEdit.getAssistantContext',
  ])
  assert.deepEqual(byAction.get('assistantContext')?.extensionApis, [
    'getAssistantContext',
  ])
  assert.deepEqual(byAction.get('assistantContext')?.cliCommands, [
    'oe session-context --session <id> [--file <path>]',
  ])
  assert.deepEqual(byAction.get('assistantContext')?.mcpTools, [
    'omega_edit_session_context',
  ])
  assert.deepEqual(byAction.get('patchRange')?.mcpTools, [
    'omega_edit_preview_patch',
    'omega_edit_apply_patch',
  ])
  assert.deepEqual(byAction.get('undoRedo')?.vscodeCommands, [
    'omegaEdit.undo',
    'omegaEdit.redo',
  ])
  assert.deepEqual(byAction.get('undoRedo')?.cliCommands, [
    'oe undo --session <id>',
    'oe redo --session <id>',
  ])
  assert.deepEqual(byAction.get('undoRedo')?.mcpTools, [
    'omega_edit_undo',
    'omega_edit_redo',
  ])

  return entries
}

export function assertAssistantContextPayloadBudget(context: unknown): void {
  assert.ok(
    Buffer.byteLength(JSON.stringify(context), 'utf8') < 32 * 1024,
    'assistant context should stay compact for small sessions'
  )
}
