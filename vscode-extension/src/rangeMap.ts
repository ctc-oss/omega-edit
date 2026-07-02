import type {
  ExternalHighlightKind,
  WebviewExternalHighlight,
  WebviewRangeMapNode,
} from './webviewProtocol'
import { MAX_LABEL_LENGTH } from './webviewProtocol'

export const RANGE_MAP_FORMAT = 'omega-edit.range-map'
export const RANGE_MAP_VERSION = 1
const MAX_RANGE_MAP_NODES = 512
const MAX_RANGE_MAP_DEPTH = 64
const MAX_RANGE_MAP_LABEL_LENGTH = 128
// MAX_RANGE_MAP_ID_LENGTH matches the protocol limit enforced by normalizeExternalHighlights
const MAX_RANGE_MAP_ID_LENGTH = MAX_LABEL_LENGTH // 128
const MAX_RANGE_MAP_PATH_LENGTH = 512
const MAX_RANGE_MAP_VALUE_LENGTH = 128

export interface RangeMapNode {
  path: string
  label: string
  offset: number
  length: number
  kind: ExternalHighlightKind
  source?: string
  type?: string
  value?: string
  children: RangeMapNode[]
}

export interface RangeMapDocument {
  format: typeof RANGE_MAP_FORMAT
  version: typeof RANGE_MAP_VERSION
  source?: string
  selectedPath?: string
  nodes: RangeMapNode[]
}

export interface ParsedRangeMap {
  document: RangeMapDocument
  highlights: WebviewExternalHighlight[]
  tree: WebviewRangeMapNode[]
  selectedHighlight?: WebviewExternalHighlight
  nodeCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeString(
  value: unknown,
  name: string,
  allowEmpty = false,
  maxLength = MAX_RANGE_MAP_LABEL_LENGTH
): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const text = value.trim()
  if (!allowEmpty && text.length === 0) {
    return undefined
  }
  if (text.length > maxLength) {
    throw new Error(`${name} must be at most ${maxLength} characters`)
  }
  return text
}

function safeNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined
}

function safeHighlightKind(value: unknown): ExternalHighlightKind | undefined {
  return value === 'current' ||
    value === 'parsed' ||
    value === 'error' ||
    value === 'warning' ||
    value === 'breakpoint' ||
    value === 'secondary'
    ? value
    : undefined
}

function safeValueText(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value === null) {
    return 'null'
  }
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    return Array.isArray(value) ? '[array]' : '[object]'
  }

  const text = String(value)
  return text.length <= MAX_RANGE_MAP_VALUE_LENGTH
    ? text
    : `${text.slice(0, MAX_RANGE_MAP_VALUE_LENGTH - 3)}...`
}

interface RangeMapParseContext {
  nodeCount: number
  seenPaths: Set<string>
}

function parseRangeMapNode(
  raw: unknown,
  indexPath: string,
  depth: number,
  context: RangeMapParseContext
): RangeMapNode {
  if (depth > MAX_RANGE_MAP_DEPTH) {
    throw new Error(
      `Range map node ${indexPath} exceeds maximum depth ${MAX_RANGE_MAP_DEPTH}`
    )
  }
  context.nodeCount += 1
  if (context.nodeCount > MAX_RANGE_MAP_NODES) {
    throw new Error(
      `Range map cannot contain more than ${MAX_RANGE_MAP_NODES} nodes`
    )
  }
  if (!isRecord(raw)) {
    throw new Error(`Range map node ${indexPath} must be an object`)
  }

  const path = safeString(
    raw.path,
    `Range map node ${indexPath} path`,
    false,
    MAX_RANGE_MAP_PATH_LENGTH
  )
  const label =
    safeString(raw.label, `Range map node ${indexPath} label`, true) ?? path
  const offset = safeNonNegativeInteger(raw.offset)
  const length = safeNonNegativeInteger(raw.length)
  const kind = safeHighlightKind(raw.kind) ?? 'parsed'
  const source =
    raw.source === undefined
      ? undefined
      : safeString(raw.source, `Range map node ${indexPath} source`)
  const type =
    raw.type === undefined
      ? undefined
      : safeString(raw.type, `Range map node ${indexPath} type`)

  if (!path) {
    throw new Error(`Range map node ${indexPath} requires path`)
  }
  if (context.seenPaths.has(path)) {
    throw new Error(`Range map path is duplicated: ${path}`)
  }
  context.seenPaths.add(path)
  if (offset === undefined) {
    throw new Error(`Range map node ${indexPath} requires offset`)
  }
  if (length === undefined || length === 0) {
    throw new Error(`Range map node ${indexPath} requires positive length`)
  }

  const children = Array.isArray(raw.children)
    ? raw.children.map((child, childIndex) =>
        parseRangeMapNode(
          child,
          `${indexPath}.${childIndex}`,
          depth + 1,
          context
        )
      )
    : []

  return {
    path,
    label: label || path,
    offset,
    length,
    kind,
    source,
    type,
    value: safeValueText(raw.value),
    children,
  }
}

function flattenRangeMapNodes(nodes: RangeMapNode[]): RangeMapNode[] {
  const flattened: RangeMapNode[] = []
  const visit = (node: RangeMapNode) => {
    for (const child of node.children) {
      visit(child)
    }
    // Child-first ordering lets the most specific nested labels win overlap precedence in the webview.
    flattened.push(node)
  }
  for (const node of nodes) {
    visit(node)
  }
  return flattened
}

function makeRangeMapHighlightId(
  node: RangeMapNode,
  index: number,
  usedIds: Set<string>
): string {
  const preferredId =
    node.path.length <= MAX_RANGE_MAP_ID_LENGTH ? node.path : `range.${index}`
  if (!usedIds.has(preferredId)) {
    usedIds.add(preferredId)
    return preferredId
  }

  let suffix = 1
  let generatedId = `range.${index}.${suffix}`
  while (usedIds.has(generatedId)) {
    suffix += 1
    generatedId = `range.${index}.${suffix}`
  }
  usedIds.add(generatedId)
  return generatedId
}

function rangeMapNodeToHighlight(
  node: RangeMapNode,
  id: string,
  defaultSource: string | undefined,
  selectedPath: string | undefined
): WebviewExternalHighlight {
  const selected = selectedPath !== undefined && node.path === selectedPath
  const typeSuffix = node.type ? ` (${node.type})` : ''
  const valueSuffix = node.value ? ` = ${node.value}` : ''
  const label = `${node.label}${typeSuffix}${valueSuffix}`

  return {
    id,
    offset: node.offset,
    length: node.length,
    kind: selected ? 'current' : node.kind,
    label:
      label.length <= MAX_RANGE_MAP_LABEL_LENGTH
        ? label
        : `${label.slice(0, MAX_RANGE_MAP_LABEL_LENGTH - 3)}...`,
    source: node.source ?? defaultSource,
  }
}

function rangeMapNodeToWebviewNode(
  node: RangeMapNode,
  idByNode: Map<RangeMapNode, string>,
  defaultSource: string | undefined,
  selectedPath: string | undefined
): WebviewRangeMapNode {
  const id = idByNode.get(node) ?? node.path
  return {
    id,
    path: node.path,
    label: node.label,
    offset: node.offset,
    length: node.length,
    kind:
      selectedPath !== undefined && node.path === selectedPath
        ? 'current'
        : node.kind,
    source: node.source ?? defaultSource,
    type: node.type,
    value: node.value,
    children: node.children.map((child) =>
      rangeMapNodeToWebviewNode(child, idByNode, defaultSource, selectedPath)
    ),
  }
}

export function parseRangeMapContent(content: Uint8Array): ParsedRangeMap {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(content))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid range map JSON: ${message}`)
  }

  if (!isRecord(parsed)) {
    throw new Error('Range map must be an object')
  }
  if (parsed.format !== RANGE_MAP_FORMAT) {
    throw new Error('Unsupported range map format')
  }
  if (parsed.version !== RANGE_MAP_VERSION) {
    throw new Error('Unsupported range map version')
  }
  if (!Array.isArray(parsed.nodes)) {
    throw new Error('Range map nodes must be an array')
  }

  const source =
    parsed.source === undefined
      ? undefined
      : safeString(parsed.source, 'Range map source')
  const selectedPath =
    parsed.selectedPath === undefined
      ? undefined
      : safeString(
          parsed.selectedPath,
          'Range map selectedPath',
          false,
          MAX_RANGE_MAP_PATH_LENGTH
        )
  const context: RangeMapParseContext = {
    nodeCount: 0,
    seenPaths: new Set<string>(),
  }
  const nodes = parsed.nodes.map((node, index) =>
    parseRangeMapNode(node, `${index}`, 1, context)
  )
  const flattened = flattenRangeMapNodes(nodes)

  if (selectedPath && !context.seenPaths.has(selectedPath)) {
    throw new Error(`Range map selectedPath was not found: ${selectedPath}`)
  }

  const document: RangeMapDocument = {
    format: RANGE_MAP_FORMAT,
    version: RANGE_MAP_VERSION,
    source,
    selectedPath,
    nodes,
  }
  const defaultSource = source ?? 'Range map'
  const usedIds = new Set<string>()
  const idByNode = new Map<RangeMapNode, string>()
  flattened.forEach((node, index) => {
    idByNode.set(node, makeRangeMapHighlightId(node, index, usedIds))
  })
  const highlights = flattened.map((node) =>
    rangeMapNodeToHighlight(
      node,
      idByNode.get(node) ?? node.path,
      defaultSource,
      selectedPath
    )
  )
  const tree = nodes.map((node) =>
    rangeMapNodeToWebviewNode(node, idByNode, defaultSource, selectedPath)
  )
  const selectedIndex = selectedPath
    ? flattened.findIndex((node) => node.path === selectedPath)
    : -1

  return {
    document,
    highlights,
    tree,
    selectedHighlight:
      selectedIndex >= 0 ? highlights[selectedIndex] : undefined,
    nodeCount: flattened.length,
  }
}

export function assertRangeMapFitsFile(
  parsed: ParsedRangeMap,
  fileSize: number
): void {
  if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
    throw new Error('Range map file size must be a non-negative safe integer')
  }

  for (const node of flattenRangeMapNodes(parsed.document.nodes)) {
    const remaining = Math.max(0, fileSize - node.offset)
    if (node.offset >= fileSize || node.length > remaining) {
      const endOffset = node.offset + node.length
      throw new Error(
        `Range map node ${node.path} [${node.offset}, ${endOffset}) is outside file bounds (${fileSize} bytes)`
      )
    }
  }
}
