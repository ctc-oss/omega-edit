#!/usr/bin/env node

import { parseArgs } from 'node:util'
import { OmegaEditToolkit } from './service'
import { parseInputData } from './codec'
import { InputEncoding, PatchKind } from './types'

type CommandResult = object

const commonOptions = {
  host: { type: 'string' as const },
  port: { type: 'string' as const },
  'no-autostart': { type: 'boolean' as const },
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function printError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${JSON.stringify({ error: message }, null, 2)}\n`)
}

function usage(): string {
  return [
    'Usage: oe <command> [options]',
    '',
    'Commands:',
    '  server-start',
    '  server-stop',
    '  server-info',
    '  create-session --file <path>',
    '  destroy-session --session <id>',
    '  session-status --session <id>',
    '  diff-session --session <id>',
    '  view --session <id> --offset <n> --length <n>',
    '  search --session <id> (--text <value> | --hex <value> | --base64 <value>) [--limit <n>]',
    '  patch --session <id> --offset <n> [--operation <insert|overwrite|delete|replace>]',
    '        [--text <value> | --hex <value> | --base64 <value>] [--delete-length <n>] [--dry-run]',
    '  undo --session <id>',
    '  redo --session <id>',
    '  save-session --session <id> --output <path> [--overwrite]',
    '  export-range --session <id> --offset <n> --length <n> --output <path> [--overwrite]',
    '',
    'Common options:',
    '  --host <host>          OmegaEdit server host (default 127.0.0.1)',
    '  --port <port>          OmegaEdit server port (default 9000)',
    '  --no-autostart         Refuse to auto-start OmegaEdit when not already running',
  ].join('\n')
}

function parseIntegerOption(
  value: string | undefined,
  optionName: string,
  defaultValue?: number
): number {
  if (value === undefined) {
    if (defaultValue !== undefined) return defaultValue
    throw new Error(`${optionName} is required`)
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${optionName} must be a non-negative integer`)
  }

  return parsed
}

function requireStringOption(
  value: string | undefined,
  optionName: string
): string {
  if (!value) {
    throw new Error(`${optionName} is required`)
  }
  return value
}

function getToolkit(values: Record<string, string | boolean | undefined>) {
  return new OmegaEditToolkit({
    host: values.host as string | undefined,
    port:
      values.port !== undefined
        ? parseIntegerOption(values.port as string, 'port')
        : undefined,
    autoStart: values['no-autostart'] ? false : true,
  })
}

function getInputValue(values: Record<string, string | boolean | undefined>): {
  data?: Uint8Array
  inputEncoding?: InputEncoding
} {
  const provided = [
    values.text !== undefined ? 'utf8' : undefined,
    values.hex !== undefined ? 'hex' : undefined,
    values.base64 !== undefined ? 'base64' : undefined,
  ].filter((value): value is InputEncoding => value !== undefined)

  if (provided.length > 1) {
    throw new Error('Provide only one of --text, --hex, or --base64')
  }

  if (provided.length === 0) {
    return {}
  }

  const inputEncoding = provided[0]
  const rawValue =
    inputEncoding === 'utf8'
      ? (values.text as string)
      : inputEncoding === 'hex'
        ? (values.hex as string)
        : (values.base64 as string)

  return {
    data: parseInputData(rawValue, inputEncoding),
    inputEncoding,
  }
}

function inferPatchKind(
  explicitOperation: string | undefined,
  dataLength: number,
  deleteLength: number
): PatchKind {
  if (explicitOperation) {
    if (
      explicitOperation === 'insert' ||
      explicitOperation === 'overwrite' ||
      explicitOperation === 'delete' ||
      explicitOperation === 'replace'
    ) {
      return explicitOperation
    }

    throw new Error(
      'operation must be one of insert, overwrite, delete, replace'
    )
  }

  if (deleteLength > 0 && dataLength > 0) return 'replace'
  if (deleteLength > 0) return 'delete'
  if (dataLength > 0) return 'overwrite'

  throw new Error(
    'Unable to infer patch operation. Provide --operation or patch data/delete length.'
  )
}

async function runCommand(
  command: string,
  args: string[]
): Promise<CommandResult> {
  switch (command) {
    case 'server-start': {
      const parsed = parseArgs({
        args,
        options: commonOptions,
        allowPositionals: false,
      })
      return await getToolkit(parsed.values).startServer()
    }
    case 'server-stop': {
      const parsed = parseArgs({
        args,
        options: commonOptions,
        allowPositionals: false,
      })
      return await getToolkit(parsed.values).stopServer()
    }
    case 'server-info': {
      const parsed = parseArgs({
        args,
        options: commonOptions,
        allowPositionals: false,
      })
      return await getToolkit(parsed.values).serverInfo()
    }
    case 'create-session': {
      const parsed = parseArgs({
        args,
        options: {
          ...commonOptions,
          file: { type: 'string' as const },
          session: { type: 'string' as const },
          checkpoint: { type: 'string' as const },
        },
        allowPositionals: false,
      })
      return await getToolkit(parsed.values).createSession(
        (parsed.values.file as string | undefined) || '',
        (parsed.values.session as string | undefined) || '',
        (parsed.values.checkpoint as string | undefined) || ''
      )
    }
    case 'destroy-session': {
      const parsed = parseArgs({
        args,
        options: {
          ...commonOptions,
          session: { type: 'string' as const },
        },
        allowPositionals: false,
      })
      return await getToolkit(parsed.values).destroySession(
        requireStringOption(
          parsed.values.session as string | undefined,
          'session'
        )
      )
    }
    case 'session-status':
    case 'diff-session': {
      const parsed = parseArgs({
        args,
        options: {
          ...commonOptions,
          session: { type: 'string' as const },
        },
        allowPositionals: false,
      })
      const result = await getToolkit(parsed.values).sessionStatus(
        requireStringOption(
          parsed.values.session as string | undefined,
          'session'
        )
      )
      return command === 'diff-session'
        ? {
            ...result,
            diffMode: 'last-change-summary',
          }
        : result
    }
    case 'view': {
      const parsed = parseArgs({
        args,
        options: {
          ...commonOptions,
          session: { type: 'string' as const },
          offset: { type: 'string' as const },
          length: { type: 'string' as const },
        },
        allowPositionals: false,
      })
      return await getToolkit(parsed.values).readRange(
        requireStringOption(
          parsed.values.session as string | undefined,
          'session'
        ),
        parseIntegerOption(
          parsed.values.offset as string | undefined,
          'offset'
        ),
        parseIntegerOption(parsed.values.length as string | undefined, 'length')
      )
    }
    case 'search': {
      const parsed = parseArgs({
        args,
        options: {
          ...commonOptions,
          session: { type: 'string' as const },
          text: { type: 'string' as const },
          hex: { type: 'string' as const },
          base64: { type: 'string' as const },
          offset: { type: 'string' as const },
          length: { type: 'string' as const },
          limit: { type: 'string' as const },
          reverse: { type: 'boolean' as const },
          'case-insensitive': { type: 'boolean' as const },
        },
        allowPositionals: false,
      })
      const { data, inputEncoding } = getInputValue(parsed.values)
      if (!data) {
        throw new Error('search requires one of --text, --hex, or --base64')
      }
      return await getToolkit(parsed.values).search({
        sessionId: requireStringOption(
          parsed.values.session as string | undefined,
          'session'
        ),
        pattern: data,
        inputEncoding,
        offset: parseIntegerOption(
          parsed.values.offset as string | undefined,
          'offset',
          0
        ),
        length: parseIntegerOption(
          parsed.values.length as string | undefined,
          'length',
          0
        ),
        limit: parseIntegerOption(
          parsed.values.limit as string | undefined,
          'limit',
          100
        ),
        reverse: Boolean(parsed.values.reverse),
        caseInsensitive: Boolean(parsed.values['case-insensitive']),
      })
    }
    case 'patch': {
      const parsed = parseArgs({
        args,
        options: {
          ...commonOptions,
          session: { type: 'string' as const },
          offset: { type: 'string' as const },
          operation: { type: 'string' as const },
          text: { type: 'string' as const },
          hex: { type: 'string' as const },
          base64: { type: 'string' as const },
          'delete-length': { type: 'string' as const },
          context: { type: 'string' as const },
          'dry-run': { type: 'boolean' as const },
        },
        allowPositionals: false,
      })
      const { data } = getInputValue(parsed.values)
      const deleteLength = parseIntegerOption(
        parsed.values['delete-length'] as string | undefined,
        'delete-length',
        0
      )
      const kind = inferPatchKind(
        parsed.values.operation as string | undefined,
        data?.length || 0,
        deleteLength
      )
      return await getToolkit(parsed.values).applyPatch({
        sessionId: requireStringOption(
          parsed.values.session as string | undefined,
          'session'
        ),
        kind,
        offset: parseIntegerOption(
          parsed.values.offset as string | undefined,
          'offset'
        ),
        data,
        removeLength: deleteLength,
        previewContext: parseIntegerOption(
          parsed.values.context as string | undefined,
          'context',
          64
        ),
        dryRun: Boolean(parsed.values['dry-run']),
      })
    }
    case 'undo': {
      const parsed = parseArgs({
        args,
        options: {
          ...commonOptions,
          session: { type: 'string' as const },
        },
        allowPositionals: false,
      })
      return await getToolkit(parsed.values).undo(
        requireStringOption(
          parsed.values.session as string | undefined,
          'session'
        )
      )
    }
    case 'redo': {
      const parsed = parseArgs({
        args,
        options: {
          ...commonOptions,
          session: { type: 'string' as const },
        },
        allowPositionals: false,
      })
      return await getToolkit(parsed.values).redo(
        requireStringOption(
          parsed.values.session as string | undefined,
          'session'
        )
      )
    }
    case 'save-session': {
      const parsed = parseArgs({
        args,
        options: {
          ...commonOptions,
          session: { type: 'string' as const },
          output: { type: 'string' as const },
          overwrite: { type: 'boolean' as const },
        },
        allowPositionals: false,
      })
      return await getToolkit(parsed.values).saveSession(
        requireStringOption(
          parsed.values.session as string | undefined,
          'session'
        ),
        requireStringOption(
          parsed.values.output as string | undefined,
          'output'
        ),
        Boolean(parsed.values.overwrite)
      )
    }
    case 'export-range': {
      const parsed = parseArgs({
        args,
        options: {
          ...commonOptions,
          session: { type: 'string' as const },
          offset: { type: 'string' as const },
          length: { type: 'string' as const },
          output: { type: 'string' as const },
          overwrite: { type: 'boolean' as const },
        },
        allowPositionals: false,
      })
      return await getToolkit(parsed.values).exportRange(
        requireStringOption(
          parsed.values.session as string | undefined,
          'session'
        ),
        parseIntegerOption(
          parsed.values.offset as string | undefined,
          'offset'
        ),
        parseIntegerOption(
          parsed.values.length as string | undefined,
          'length'
        ),
        requireStringOption(
          parsed.values.output as string | undefined,
          'output'
        ),
        Boolean(parsed.values.overwrite)
      )
    }
    default:
      throw new Error(`Unknown command: ${command}`)
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)

  if (
    !command ||
    command === 'help' ||
    command === '--help' ||
    command === '-h'
  ) {
    process.stdout.write(`${usage()}\n`)
    return
  }

  const result = await runCommand(command, args)
  printJson({
    command,
    ...(result as Record<string, unknown>),
  })
}

void main().catch((error) => {
  printError(error)
  process.exitCode = 1
})
