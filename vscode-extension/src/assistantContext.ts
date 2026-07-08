import {
  OMEGA_EDIT_APPLY_CHANGE_LOG_COMMAND,
  OMEGA_EDIT_CLEAR_EXTERNAL_HIGHLIGHTS_COMMAND,
  OMEGA_EDIT_CREATE_CHECKPOINT_COMMAND,
  OMEGA_EDIT_EXPORT_CHANGE_LOG_COMMAND,
  OMEGA_EDIT_GET_ASSISTANT_CONTEXT_COMMAND,
  OMEGA_EDIT_GET_EDITOR_STATE_COMMAND,
  OMEGA_EDIT_GO_TO_OFFSET_COMMAND,
  OMEGA_EDIT_LOAD_RANGE_MAP_COMMAND,
  OMEGA_EDIT_OPEN_IN_HEX_EDITOR_COMMAND,
  OMEGA_EDIT_REFRESH_TRANSFORM_PLUGINS_COMMAND,
  OMEGA_EDIT_REDO_COMMAND,
  OMEGA_EDIT_RESTORE_CHECKPOINT_COMMAND,
  OMEGA_EDIT_ROLLBACK_CHECKPOINT_COMMAND,
  OMEGA_EDIT_ROLLBACK_SESSION_COMMAND,
  OMEGA_EDIT_SEARCH_NEXT_COMMAND,
  OMEGA_EDIT_SEARCH_PREVIOUS_COMMAND,
  OMEGA_EDIT_SET_EXTERNAL_HIGHLIGHTS_COMMAND,
  OMEGA_EDIT_UNDO_COMMAND,
  OMEGA_EDIT_UNLOAD_RANGE_MAP_COMMAND,
} from './constants'
import type {
  GridEditPane,
  InsertDirection,
  OffsetRadix,
  TextEncoding,
  WebviewEditMode,
} from './webviewProtocol'

export const OMEGA_EDIT_ASSISTANT_CONTEXT_VERSION = 1

export interface AssistantCommandSurfaceEntry {
  action: string
  ui?: string
  vscodeCommands?: string[]
  extensionApis?: string[]
  cliCommands?: string[]
  mcpTools?: string[]
  result: string
}

export interface AssistantTransformPluginSummary {
  id: string
  name: string
  description?: string
  operation: number
  operationName?: string
  support: number
  supportName?: string
  flags: number
  abiVersion?: number
}

export interface AssistantSessionContext {
  version: typeof OMEGA_EDIT_ASSISTANT_CONTEXT_VERSION
  session: {
    id: string
    uri: string | null
    filePath: string | null
    contentType: string | null
    language: string | null
  }
  sizes: {
    computed: number
    original: number | string | null
  }
  dirty: boolean
  selection: {
    offset: number
    start: number
    end: number
    length: number
  } | null
  viewport: {
    count: number
    activeViewportId: string | null
    visibleOffset: number | null
    visibleByteCount: number | null
    bytesPerRow: number | null
    offsetRadix: OffsetRadix | null
    activePane: GridEditPane | null
    editMode: WebviewEditMode | null
    insertDirection: InsertDirection | null
    textEncoding: TextEncoding | null
  }
  history: {
    changeCount: number
    undoCount: number
    redoCount: number
    undoStackDepth: number
    redoStackDepth: number
    canUndo: boolean
    canRedo: boolean
    checkpointCount: number | null
    checkpointAvailable: boolean
    savedChangeDepth: number | null
    pendingChanges: boolean
    pendingOperation: 'undo' | 'redo' | null
    pendingCount: number
  }
  transforms: {
    inFlight: boolean
    available: boolean
    pluginCount: number
    plugins: AssistantTransformPluginSummary[]
  }
  changeLog: {
    format: 'omega-edit.change-log'
    version: 2
    exportAvailable: boolean
    applyAvailable: boolean
    sourceChangeCount: number
    completeExportAvailable: boolean
  }
  commands: AssistantCommandSurfaceEntry[]
}

export const OMEGA_EDIT_ASSISTANT_COMMAND_SURFACES: readonly AssistantCommandSurfaceEntry[] =
  [
    {
      action: 'openSession',
      ui: 'Open in Data Editor',
      vscodeCommands: [OMEGA_EDIT_OPEN_IN_HEX_EDITOR_COMMAND],
      extensionApis: ['open'],
      cliCommands: ['oe create-session --file <path>'],
      mcpTools: ['omega_edit_create_session'],
      result: 'structured session id and file path',
    },
    {
      action: 'assistantContext',
      vscodeCommands: [OMEGA_EDIT_GET_ASSISTANT_CONTEXT_COMMAND],
      extensionApis: ['getAssistantContext'],
      cliCommands: ['oe session-context --session <id> [--file <path>]'],
      mcpTools: ['omega_edit_session_context'],
      result: 'stable assistant-readable session context JSON',
    },
    {
      action: 'editorState',
      vscodeCommands: [OMEGA_EDIT_GET_EDITOR_STATE_COMMAND],
      extensionApis: ['getEditorState'],
      result: 'raw editor state JSON for VS Code integrations',
    },
    {
      action: 'navigateRange',
      ui: 'Go to Offset',
      vscodeCommands: [OMEGA_EDIT_GO_TO_OFFSET_COMMAND],
      extensionApis: ['reveal'],
      cliCommands: ['oe view --session <id> --offset <n> --length <n>'],
      mcpTools: ['omega_edit_read_range'],
      result: 'selected offset or bounded range bytes',
    },
    {
      action: 'profileRange',
      cliCommands: [
        'oe profile-range --session <id> --offset <n> --length <n>',
      ],
      mcpTools: ['omega_edit_profile_range'],
      result: 'bounded range profile metrics',
    },
    {
      action: 'search',
      ui: 'Search',
      vscodeCommands: [
        OMEGA_EDIT_SEARCH_NEXT_COMMAND,
        OMEGA_EDIT_SEARCH_PREVIOUS_COMMAND,
      ],
      cliCommands: ['oe search --session <id> --text <value>'],
      mcpTools: ['omega_edit_search'],
      result: 'structured match offsets and lengths',
    },
    {
      action: 'patchRange',
      ui: 'Insert, delete, overwrite, or replace bytes',
      cliCommands: ['oe patch --session <id> --offset <n> --operation <kind>'],
      mcpTools: ['omega_edit_preview_patch', 'omega_edit_apply_patch'],
      result: 'operation kind, range, serial, preview, and resulting state',
    },
    {
      action: 'undoRedo',
      ui: 'Undo / Redo',
      vscodeCommands: [OMEGA_EDIT_UNDO_COMMAND, OMEGA_EDIT_REDO_COMMAND],
      cliCommands: ['oe undo --session <id>', 'oe redo --session <id>'],
      mcpTools: ['omega_edit_undo', 'omega_edit_redo'],
      result: 'serial and updated history counts',
    },
    {
      action: 'transforms',
      ui: 'Refresh or apply transform plugins',
      vscodeCommands: [OMEGA_EDIT_REFRESH_TRANSFORM_PLUGINS_COMMAND],
      cliCommands: [
        'oe list-transform-plugins',
        'oe apply-transform-plugin --session <id> --plugin <id>',
      ],
      mcpTools: [
        'omega_edit_list_transform_plugins',
        'omega_edit_apply_transform_plugin',
      ],
      result: 'plugin metadata or transform result with serial and descriptor',
    },
    {
      action: 'checkpoints',
      ui: 'Create, restore, or roll back checkpoints',
      vscodeCommands: [
        OMEGA_EDIT_CREATE_CHECKPOINT_COMMAND,
        OMEGA_EDIT_RESTORE_CHECKPOINT_COMMAND,
        OMEGA_EDIT_ROLLBACK_CHECKPOINT_COMMAND,
      ],
      extensionApis: [
        'createCheckpoint',
        'restoreCheckpoint',
        'rollbackCheckpoint',
      ],
      cliCommands: [
        'oe create-checkpoint',
        'oe restore-checkpoint',
        'oe rollback-checkpoint',
      ],
      mcpTools: [
        'omega_edit_create_checkpoint',
        'omega_edit_restore_checkpoint',
        'omega_edit_rollback_checkpoint',
      ],
      result: 'checkpoint count and resulting state',
    },
    {
      action: 'changeLog',
      ui: 'Export or apply change log',
      vscodeCommands: [
        OMEGA_EDIT_EXPORT_CHANGE_LOG_COMMAND,
        OMEGA_EDIT_APPLY_CHANGE_LOG_COMMAND,
      ],
      extensionApis: ['exportChangeLog', 'applyChangeLog'],
      cliCommands: ['oe export-change-log', 'oe apply-change-log'],
      mcpTools: ['omega_edit_export_change_log', 'omega_edit_apply_change_log'],
      result: 'change-log format, source counts, fingerprints, and state',
    },
    {
      action: 'rollbackSession',
      ui: 'Roll Back Session',
      vscodeCommands: [OMEGA_EDIT_ROLLBACK_SESSION_COMMAND],
      result: 'resulting editor state',
    },
    {
      action: 'annotations',
      vscodeCommands: [
        OMEGA_EDIT_SET_EXTERNAL_HIGHLIGHTS_COMMAND,
        OMEGA_EDIT_CLEAR_EXTERNAL_HIGHLIGHTS_COMMAND,
        OMEGA_EDIT_LOAD_RANGE_MAP_COMMAND,
        OMEGA_EDIT_UNLOAD_RANGE_MAP_COMMAND,
      ],
      extensionApis: [
        'setExternalHighlights',
        'clearExternalHighlights',
        'loadRangeMap',
        'unloadRangeMap',
      ],
      result: 'annotation counts, selected range, and resulting editor state',
    },
  ]

export function cloneAssistantCommandSurfaces(): AssistantCommandSurfaceEntry[] {
  return OMEGA_EDIT_ASSISTANT_COMMAND_SURFACES.map((entry) => {
    const clone: AssistantCommandSurfaceEntry = {
      action: entry.action,
      result: entry.result,
    }
    if (entry.ui) {
      clone.ui = entry.ui
    }
    if (entry.vscodeCommands) {
      clone.vscodeCommands = [...entry.vscodeCommands]
    }
    if (entry.extensionApis) {
      clone.extensionApis = [...entry.extensionApis]
    }
    if (entry.cliCommands) {
      clone.cliCommands = [...entry.cliCommands]
    }
    if (entry.mcpTools) {
      clone.mcpTools = [...entry.mcpTools]
    }
    return clone
  })
}
