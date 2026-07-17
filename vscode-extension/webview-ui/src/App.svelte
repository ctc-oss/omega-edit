<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import ByteInspector from './components/ByteInspector.svelte'
  import ActionJournal from './components/ActionJournal.svelte'
  import CheckpointTimeline from './components/CheckpointTimeline.svelte'
  import EditorWorkspace from './components/EditorWorkspace.svelte'
  import SearchPanel from './components/SearchPanel.svelte'
  import Toolbar from './components/Toolbar.svelte'
  import TransformResultPanel from './components/TransformResultPanel.svelte'
  import { formatNumber, strings } from './i18n'
  import {
    MAX_BYTES_PER_ROW,
    MAX_ANALYSIS_PROFILE_BYTES,
    WEBVIEW_ACTION_JOURNAL_KINDS,
    normalizeBytesPerRow,
    normalizeTextEncoding,
    type BytesPerRow,
    type BytesPerRowMode,
    type ExternalHighlightKind,
    type HostToWebviewMessage,
    type InsertDirection,
    type ServerHealthMessage,
    type TextEncoding,
    type WebviewEditorUiState,
    type WebviewActionJournalKind,
    type WebviewActionJournalViewport,
    type WebviewExternalHighlight,
    type WebviewRangeMapNode,
    type WebviewSessionContentInfo,
    type WebviewSessionContentSource,
    type WebviewTransformPlugin,
  } from './protocol'
  import {
    getPreviewState,
    postToHost,
    setPreviewState,
    type PersistedViewportSnapshot,
  } from './vscodeApi'
  import {
    decodeTextBytes,
    encodeTextToHex,
    printableTextToHex,
  } from '../../src/textEncoding'

  const DEFAULT_VISIBLE_ROWS = 16
  const INTERNAL_HEX_CLIPBOARD_FORMAT = 'application/x-omega-edit-hex'
  const TRANSFORM_RESULT_HISTORY_LIMIT = 8
  const MAX_PERSISTED_RANGE_MAP_NODES = 5000
  const MAX_PERSISTED_RANGE_MAP_DEPTH = 64
  const MAX_PERSISTED_RANGE_MAP_TEXT_LENGTH = 4096
  const EXTERNAL_HIGHLIGHT_KINDS: readonly ExternalHighlightKind[] = [
    'current',
    'parsed',
    'error',
    'warning',
    'breakpoint',
    'secondary',
  ]

  type SearchResultsMessage = Extract<
    HostToWebviewMessage,
    { type: 'searchResults' }
  >
  type SearchNavigationResultMessage = Extract<
    HostToWebviewMessage,
    { type: 'searchNavigationResult' }
  >
  type AnalysisProfileMessage = Extract<
    HostToWebviewMessage,
    { type: 'analysisProfile' }
  >
  type TransformCompleteMessage = Extract<
    HostToWebviewMessage,
    { type: 'transformComplete' }
  >
  type TransformStatusMessage = Extract<
    HostToWebviewMessage,
    { type: 'transformStatus' }
  >
  type FileActionCompleteMessage = Extract<
    HostToWebviewMessage,
    { type: 'fileActionComplete' }
  >
  type SessionActionCompleteMessage = Extract<
    HostToWebviewMessage,
    { type: 'sessionActionComplete' }
  >
  type CheckpointTimelineMessage = Extract<
    HostToWebviewMessage,
    { type: 'checkpointTimeline' }
  >
  type ViewportDataMessage = Extract<
    HostToWebviewMessage,
    { type: 'viewportData' }
  >
  type PendingSearchReveal =
    | { kind: 'results'; message: SearchResultsMessage }
    | { kind: 'navigation'; message: SearchNavigationResultMessage }
    | { kind: 'bounded'; index: number }
  type InspectorEditMode = 'insert' | 'overwrite'
  type GridEditPane = 'hex' | 'ascii'
  type AnalysisMode = 'profile' | 'structure'
  type AnalysisSectionOrder = Record<AnalysisMode, string[]>
  interface TransformResultState {
    id: string
    title: string
    summary: string
    label: string
    contentSource: WebviewSessionContentSource
    contentSourceLabel: string
    value: string
    mimeType: string
    offset: number
    rangeEndOffset: number
    byteLength: number
    createdAtLabel: string
    historyLabel: string
  }

  interface DisplayTransformResultState extends TransformResultState {
    rangeStart: string
    rangeEnd: string
    length: string
  }

  const DEFAULT_ANALYSIS_SECTION_ORDER: AnalysisSectionOrder = {
    profile: ['viewport', 'classes', 'data', 'frequency'],
    structure: ['rangeMap', 'visible', 'history', 'timing', 'server'],
  }

  type ProfilerViewportSnapshot = ViewportDataMessage['profile'] & {
    hostToWebviewMs: number
    renderDurationMs: number
    averageRenderMs: number | null
    messageAt: number
    renderAt: number
    followingByteCount: number
  }

  interface Props {
    initialBytesPerRow?: BytesPerRow
    initialBytesPerRowMode?: BytesPerRowMode
  }

  let {
    initialBytesPerRow = 16,
    initialBytesPerRowMode: _initialBytesPerRowMode = 'fixed',
  }: Props = $props()

  const restoredState = getPreviewState()
  const restoredViewportSnapshot = normalizeViewportSnapshot(
    restoredState?.viewportSnapshot
  )

  const configuredBytesPerRow = normalizeBytesPerRow(
    untrack(() => initialBytesPerRow)
  )
  let bytesPerRowMode = $state<BytesPerRowMode>('fixed')
  let bytesPerRow = $state<BytesPerRow>(
    normalizeBytesPerRow(
      restoredState?.bytesPerRow ?? configuredBytesPerRow
    )
  )
  const initialFileSize = restoredViewportSnapshot?.fileSize ?? 0
  const restoredSelection = normalizePersistedSelection(
    restoredState,
    initialFileSize
  )
  let fileSize = $state(initialFileSize)
  let visibleOffset = $state(restoredViewportSnapshot?.visibleOffset ?? 0)
  let viewportOffset = $state(restoredViewportSnapshot?.viewportOffset ?? 0)
  let viewportData = $state<number[]>(
    restoredViewportSnapshot?.viewportData ?? []
  )
  let visibleRows = $state(DEFAULT_VISIBLE_ROWS)
  let pendingVisibleOffset = $state<number | undefined>(undefined)
  let pendingSearchReveal = $state<PendingSearchReveal | undefined>(undefined)
  let inspectorEditMode = $state<InspectorEditMode>('insert')
  let insertDirection = $state<InsertDirection>(
    normalizeInsertDirection(restoredState?.insertDirection)
  )
  let activePane = $state<GridEditPane>('hex')
  let pendingHexNibble = $state<number | undefined>(undefined)
  let pendingHexLabel = $state('')
  let inspectorLittleEndian = $state(true)
  let inspectorHighlightStart = $state(-1)
  let inspectorHighlightEnd = $state(-1)
  let inspectorExpanded = $state(true)
  let searchPanelVisible = $state(restoredState?.searchPanelVisible ?? false)
  let profilerExpanded = $state(restoredState?.profilerExpanded ?? true)
  let profilerMode = $state<AnalysisMode>('profile')
  let analysisSectionOrder = $state<AnalysisSectionOrder>(
    normalizeAnalysisSectionOrder(restoredState?.analysisSectionOrder)
  )
  let offsetRadix = $state<'hex' | 'dec'>(
    normalizeOffsetRadix(restoredState?.offsetRadix)
  )
  let textEncoding = $state<TextEncoding>(
    normalizeTextEncoding(restoredState?.textEncoding)
  )
  let transformPlugins = $state<WebviewTransformPlugin[]>([])
  let transformPluginsLoaded = $state(false)
  let transformPluginsLoading = $state(false)
  let transformPluginError = $state('')
  let transformFeedback = $state('')
  let transformInFlight = $state(false)
  let transformCancelable = $state(false)
  let transformResult = $state<TransformResultState | undefined>(undefined)
  let transformResultHistory = $state<TransformResultState[]>([])
  let transformResultSequence = $state(0)
  let contentSources = $state<WebviewSessionContentInfo[]>([
    {
      content: 'computed',
      available: true,
      byteLength: initialFileSize,
      label: strings.transform.contentComputed,
    },
  ])
  let externalHighlights = $state<WebviewExternalHighlight[]>(
    restoredViewportSnapshot?.externalHighlights ?? []
  )
  let rangeMapTree = $state<WebviewRangeMapNode[]>(
    restoredViewportSnapshot?.rangeMapTree ?? []
  )
  let viewportSnapshot = $state<PersistedViewportSnapshot | undefined>(
    restoredViewportSnapshot
  )
  let preparingFile = $state(!restoredViewportSnapshot)
  let canUndo = $state(false)
  let canRedo = $state(false)
  let undoCount = $state(0)
  let redoCount = $state(0)
  let checkpointTimeline = $state<CheckpointTimelineMessage>({
    type: 'checkpointTimeline',
    visible: false,
    cursor: 0,
    checkpointCount: 0,
    originalByteLength: String(initialFileSize),
    savedChangeCount: 0,
    savedOffBranch: false,
    canRewind: false,
    canFastForward: false,
    navigating: false,
    checkpoints: [],
  })
  let actionJournalVisible = $state(false)
  let actionJournalLoading = $state(false)
  let actionJournalError = $state('')
  let actionJournalViewport = $state<
    WebviewActionJournalViewport | undefined
  >(undefined)
  let actionJournalKinds = $state<WebviewActionJournalKind[]>([
    ...WEBVIEW_ACTION_JOURNAL_KINDS,
  ])
  let actionJournalTransactionId = $state('')
  let latestDataProfile = $state<AnalysisProfileMessage | undefined>(undefined)
  let latestViewportProfile = $state<ProfilerViewportSnapshot | undefined>(
    undefined
  )
  let serverHealth = $state<ServerHealthMessage | undefined>(undefined)
  let renderSamples = $state<number[]>([])
  let pendingAnalysisProfileKey = $state('')
  let selectionAnchor = $state(restoredSelection?.anchor ?? -1)
  let selectedOffset = $state(restoredSelection?.offset ?? -1)
  let searchQuery = $state('')
  let replacementQuery = $state('')
  let searchHex = $state(false)
  let searchCaseInsensitive = $state(false)
  let searchReverse = $state(false)
  let searchMode = $state<'none' | 'bounded' | 'large'>('none')
  let searchMatches = $state<number[]>([])
  let searchMatchIndex = $state(-1)
  let searchCurrentOffset = $state(-1)
  let searchPatternLength = $state(0)
  let searchWindowLimit = $state(1000)
  let searchMessage = $state(strings.search.noSearch)
  let viewportSearchMatches = $state<Set<number>>(new Set())
  let replaceMessage = $state('')
  let replaceVisible = $state(restoredState?.replaceVisible ?? false)
  let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined
  let clipboardMessage = $state('')
  let lastPostedEditorStateKey = $state('')

  const selectionStart = $derived(
    selectionAnchor >= 0 && selectedOffset >= 0
      ? Math.min(selectionAnchor, selectedOffset)
      : -1
  )
  const selectionEnd = $derived(
    selectionAnchor >= 0 && selectedOffset >= 0
      ? Math.max(selectionAnchor, selectedOffset)
      : -1
  )
  const selectionLength = $derived(
    selectionStart >= 0 && selectionEnd >= selectionStart
      ? selectionEnd - selectionStart + 1
      : 0
  )
  const maxScrollableOffset = $derived(computeMaxVisibleOffset(
    fileSize,
    visibleRows,
    bytesPerRow
  ))
  const canScrollUp = $derived((pendingVisibleOffset ?? visibleOffset) > 0)
  const canScrollDown = $derived(
    (pendingVisibleOffset ?? visibleOffset) < maxScrollableOffset
  )
  const navigationOffset = $derived(pendingVisibleOffset ?? visibleOffset)
  const inspectorBytes = $derived(visibleBytesAt(
    selectedOffset,
    8,
    viewportData,
    viewportOffset,
    fileSize
  ))
  const normalizedSearchQuery = $derived(
    normalizeSearchQuery(searchQuery, searchHex)
  )
  const normalizedReplacementHex = $derived(normalizeReplacementHex(
    replacementQuery,
    searchHex
  ))
  const searchInputInvalid = $derived(
    searchQuery.trim().length > 0 && normalizedSearchQuery === undefined
  )
  const replacementInputInvalid = $derived(
    normalizedReplacementHex === undefined
  )
  const searchCanNavigate = $derived(
    searchQuery.trim().length > 0 && !searchInputInvalid
  )
  const hasActiveSearchResult = $derived(
    searchMode === 'large' ? searchCurrentOffset >= 0 : searchMatches.length > 0
  )
  const searchCanReplace = $derived(
    hasActiveSearchResult &&
    searchPatternLength > 0 &&
    !searchInputInvalid &&
    !replacementInputInvalid &&
    !transformInFlight
  )
  const searchResultSummary = $derived(searchInputInvalid
    ? searchHex
      ? strings.search.invalidHex
      : strings.search.invalidSearch
    : searchMode === 'large'
      ? searchCurrentOffset >= 0
        ? strings.search.largeMatchSummary(
            searchWindowLimit,
            formatSearchOffset(searchCurrentOffset)
          )
        : strings.search.noMatches
      : searchMatches.length > 0 && searchMatchIndex >= 0
        ? strings.search.boundedMatchSummary(
            searchMatchIndex,
            searchMatches.length,
            formatSearchOffset(searchMatches[searchMatchIndex])
          )
        : searchMessage
  )
  const currentSearchOffset = $derived(
    searchMode === 'large'
      ? searchCurrentOffset
      : searchMatches.length > 0 && searchMatchIndex >= 0
        ? searchMatches[searchMatchIndex]
        : -1
  )
  const allSearchMatches = $derived(
    searchMode === 'large'
      ? [...viewportSearchMatches]
      : searchMatches
  )
  const searchHighlightStart = $derived(
    currentSearchOffset >= 0 && searchPatternLength > 0 ? currentSearchOffset : -1
  )
  const searchHighlightEnd = $derived(
    searchHighlightStart >= 0
      ? Math.min(fileSize - 1, searchHighlightStart + searchPatternLength - 1)
      : -1
  )
  const data = $derived(visibleViewportData(
    viewportData,
    viewportOffset,
    visibleOffset,
    bytesPerRow,
    visibleRows
  ))
  const selectedVisibleBytes = $derived(
    selectionLength > 1
      ? visibleBytesAt(
          selectionStart,
          selectionLength,
          viewportData,
          viewportOffset,
          fileSize
        )
      : []
  )
  const profilerSelectedBytes = $derived(
    selectedVisibleBytes.length === selectionLength ? selectedVisibleBytes : []
  )
  const displayTransformResult = $derived(
    transformResult ? formatTransformResult(transformResult) : undefined
  )
  const displayTransformResultHistory = $derived(
    transformResultHistory.map(formatTransformResult)
  )

  let analysisProfileRequestTimer: ReturnType<typeof setTimeout> | undefined

  function visibleViewportData(
    source: number[],
    sourceOffset: number,
    displayOffset: number,
    rowWidth: BytesPerRow,
    rows: number
  ): number[] {
    const start = Math.max(0, displayOffset - sourceOffset)
    return source.slice(start, start + rowWidth * rows)
  }

  function applyBytesPerRow(
    bytes: BytesPerRow,
    options: { mode: BytesPerRowMode; persist: boolean }
  ): void {
    const normalizedBytes = normalizeBytesPerRow(bytes)
    bytesPerRowMode = options.mode
    bytesPerRow = normalizedBytes
    savePreviewState({
      bytesPerRow: normalizedBytes,
      bytesPerRowMode,
    })
    postToHost({
      type: 'setBytesPerRow',
      bytesPerRow: normalizedBytes,
      ...(options.persist ? {} : { persist: false }),
    })
  }

  function setBytesPerRow(bytes: BytesPerRow): void {
    applyBytesPerRow(bytes, { mode: 'fixed', persist: true })
  }

  function applyAutoFitBytesPerRow(bytes: BytesPerRow): void {
    void bytes
  }

  function toggleProfilerExpanded(): void {
    profilerExpanded = !profilerExpanded
    savePreviewState({ profilerExpanded })
    if (profilerExpanded && profilerMode === 'profile') {
      requestAnalysisProfile(true)
    }
  }

  function setProfilerMode(mode: AnalysisMode): void {
    profilerMode = mode
    if (mode === 'profile') {
      requestAnalysisProfile(true)
    }
  }

  function savePreviewState(
    overrides: Partial<{
      bytesPerRow: BytesPerRow
      bytesPerRowMode: BytesPerRowMode
      offsetRadix: 'hex' | 'dec'
      textEncoding: TextEncoding
      insertDirection: InsertDirection
      searchPanelVisible: boolean
      replaceVisible: boolean
      profilerExpanded: boolean
      analysisSectionOrder: AnalysisSectionOrder
      selectionAnchor: number
      selectedOffset: number
      viewportSnapshot: PersistedViewportSnapshot | undefined
    }> = {}
  ): void {
    setPreviewState({
      bytesPerRow,
      bytesPerRowMode,
      offsetRadix,
      textEncoding,
      insertDirection,
      searchPanelVisible,
      replaceVisible,
      profilerExpanded,
      analysisSectionOrder,
      selectionAnchor,
      selectedOffset,
      viewportSnapshot,
      ...overrides,
    })
  }

  function normalizePersistedSelection(
    rawState: unknown,
    totalSize: number
  ): { anchor: number; offset: number } | undefined {
    if (!rawState || typeof rawState !== 'object' || totalSize <= 0) {
      return undefined
    }

    const state = rawState as Record<string, unknown>
    const anchor = safeInteger(state.selectionAnchor)
    const offset = safeInteger(state.selectedOffset)
    if (
      anchor === undefined ||
      offset === undefined ||
      anchor >= totalSize ||
      offset >= totalSize
    ) {
      return undefined
    }

    return { anchor, offset }
  }

  function normalizeViewportSnapshot(
    rawSnapshot: unknown
  ): PersistedViewportSnapshot | undefined {
    if (!rawSnapshot || typeof rawSnapshot !== 'object') {
      return undefined
    }

    const snapshot = rawSnapshot as Record<string, unknown>
    const nextFileSize = safeInteger(snapshot.fileSize)
    const nextVisibleOffset = safeInteger(snapshot.visibleOffset)
    const nextViewportOffset = safeInteger(snapshot.viewportOffset)
    const nextViewportData = normalizeByteArray(snapshot.viewportData)

    if (
      nextFileSize === undefined ||
      nextVisibleOffset === undefined ||
      nextViewportOffset === undefined ||
      !nextViewportData
    ) {
      return undefined
    }

    return {
      fileSize: nextFileSize,
      visibleOffset: Math.min(nextVisibleOffset, Math.max(0, nextFileSize)),
      viewportOffset: Math.min(nextViewportOffset, Math.max(0, nextFileSize)),
      viewportData: nextViewportData,
      externalHighlights: normalizeExternalHighlights(
        snapshot.externalHighlights
      ),
      rangeMapTree: normalizeRangeMapTree(snapshot.rangeMapTree),
    }
  }

  function safeInteger(value: unknown): number | undefined {
    return typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0
      ? value
      : undefined
  }

  function normalizeByteArray(value: unknown): number[] | undefined {
    if (!Array.isArray(value)) {
      return undefined
    }

    const bytes: number[] = []
    for (const byte of value) {
      if (
        typeof byte !== 'number' ||
        !Number.isInteger(byte) ||
        byte < 0 ||
        byte > 0xff
      ) {
        return undefined
      }
      bytes.push(byte)
    }
    return bytes
  }

  function normalizeExternalHighlights(
    value: unknown
  ): WebviewExternalHighlight[] {
    if (!Array.isArray(value)) {
      return []
    }

    return value.filter(
      (highlight): highlight is WebviewExternalHighlight =>
        Boolean(highlight) && typeof highlight === 'object'
    ) as WebviewExternalHighlight[]
  }

  function normalizeRangeMapTree(
    value: unknown,
    depth = 0,
    budget = { remaining: MAX_PERSISTED_RANGE_MAP_NODES }
  ): WebviewRangeMapNode[] {
    if (!Array.isArray(value) || depth > MAX_PERSISTED_RANGE_MAP_DEPTH) {
      return []
    }

    const nodes: WebviewRangeMapNode[] = []
    for (const node of value) {
      if (budget.remaining <= 0) {
        break
      }
      const normalized = normalizeRangeMapNode(node, depth, budget)
      if (normalized) {
        nodes.push(normalized)
      }
    }
    return nodes
  }

  function normalizeRangeMapNode(
    value: unknown,
    depth: number,
    budget: { remaining: number }
  ): WebviewRangeMapNode | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined
    }

    const node = value as Record<string, unknown>
    const id = safeRequiredRangeMapText(node.id)
    const path = safeRequiredRangeMapText(node.path)
    const label = safeRequiredRangeMapText(node.label)
    const offset = safeInteger(node.offset)
    const length = safeInteger(node.length)
    const kind = safeExternalHighlightKind(node.kind)

    if (
      id === undefined ||
      path === undefined ||
      label === undefined ||
      offset === undefined ||
      length === undefined ||
      kind === undefined
    ) {
      return undefined
    }

    budget.remaining -= 1
    const source = safeOptionalRangeMapText(node.source)
    const type = safeOptionalRangeMapText(node.type)
    const valueText = safeOptionalRangeMapText(node.value)

    return {
      id,
      path,
      label,
      offset,
      length,
      kind,
      ...(source === undefined ? {} : { source }),
      ...(type === undefined ? {} : { type }),
      ...(valueText === undefined ? {} : { value: valueText }),
      ...(node.stale === true ? { stale: true } : {}),
      children: normalizeRangeMapTree(node.children, depth + 1, budget),
    }
  }

  function safeRequiredRangeMapText(value: unknown): string | undefined {
    const text = safeOptionalRangeMapText(value)
    return text && text.length > 0 ? text : undefined
  }

  function safeOptionalRangeMapText(value: unknown): string | undefined {
    return typeof value === 'string' &&
      value.length <= MAX_PERSISTED_RANGE_MAP_TEXT_LENGTH
      ? value
      : undefined
  }

  function safeExternalHighlightKind(
    value: unknown
  ): ExternalHighlightKind | undefined {
    return typeof value === 'string' &&
      EXTERNAL_HIGHLIGHT_KINDS.includes(value as ExternalHighlightKind)
      ? (value as ExternalHighlightKind)
      : undefined
  }

  function normalizeAnalysisSectionOrder(
    rawOrder: unknown
  ): AnalysisSectionOrder {
    const raw =
      rawOrder && typeof rawOrder === 'object'
        ? (rawOrder as Record<string, unknown>)
        : {}

    return {
      profile: normalizeAnalysisSectionIds(
        raw.profile,
        DEFAULT_ANALYSIS_SECTION_ORDER.profile
      ),
      structure: normalizeAnalysisSectionIds(
        raw.structure,
        DEFAULT_ANALYSIS_SECTION_ORDER.structure
      ),
    }
  }

  function normalizeAnalysisSectionIds(
    rawSectionIds: unknown,
    defaults: string[]
  ): string[] {
    const normalized: string[] = []
    const saved = Array.isArray(rawSectionIds) ? rawSectionIds : []

    for (const sectionId of saved) {
      if (
        typeof sectionId === 'string' &&
        defaults.includes(sectionId) &&
        !normalized.includes(sectionId)
      ) {
        normalized.push(sectionId)
      }
    }

    for (const sectionId of defaults) {
      if (!normalized.includes(sectionId)) {
        normalized.push(sectionId)
      }
    }

    return normalized
  }

  function normalizeOffsetRadix(rawRadix: unknown): 'hex' | 'dec' {
    return rawRadix === 'dec' ? 'dec' : 'hex'
  }

  function normalizeInsertDirection(rawDirection: unknown): InsertDirection {
    return rawDirection === 'backward' ? 'backward' : 'forward'
  }

  function updateAnalysisSectionOrder(
    mode: AnalysisMode,
    nextOrder: string[]
  ): void {
    analysisSectionOrder = {
      ...analysisSectionOrder,
      [mode]: normalizeAnalysisSectionIds(
        nextOrder,
        DEFAULT_ANALYSIS_SECTION_ORDER[mode]
      ),
    }
    savePreviewState({ analysisSectionOrder })
  }

  function moveAnalysisSectionByDelta(
    mode: AnalysisMode,
    sectionId: string,
    delta: number
  ): void {
    const order = analysisSectionOrder[mode].slice()
    const fromIndex = order.indexOf(sectionId)
    if (fromIndex < 0) {
      return
    }

    const toIndex = Math.max(
      0,
      Math.min(order.length - 1, fromIndex + delta)
    )
    if (toIndex === fromIndex) {
      return
    }

    order.splice(fromIndex, 1)
    order.splice(toIndex, 0, sectionId)
    updateAnalysisSectionOrder(mode, order)
  }

  function reorderAnalysisSection(
    mode: AnalysisMode,
    sectionId: string,
    targetId: string,
    placeAfter: boolean
  ): void {
    if (sectionId === targetId) {
      return
    }

    const order = analysisSectionOrder[mode].slice()
    const fromIndex = order.indexOf(sectionId)
    if (fromIndex < 0 || !order.includes(targetId)) {
      return
    }

    order.splice(fromIndex, 1)
    const targetIndex = order.indexOf(targetId)
    order.splice(targetIndex + (placeAfter ? 1 : 0), 0, sectionId)
    updateAnalysisSectionOrder(mode, order)
  }

  function clampOffset(offset: number): number {
    if (fileSize <= 0) {
      return -1
    }
    return Math.max(0, Math.min(offset, fileSize - 1))
  }

  function rowAlignOffset(offset: number): number {
    return Math.max(0, offset - (offset % bytesPerRow))
  }

  function visibleByteCapacity(): number {
    return bytesPerRow * Math.max(1, visibleRows)
  }

  function computeMaxVisibleOffset(
    totalSize: number,
    rows: number,
    rowWidth: number
  ): number {
    if (totalSize <= 0) {
      return 0
    }

    const lastRowOffset = Math.max(
      0,
      totalSize - 1 - ((totalSize - 1) % rowWidth)
    )
    return Math.max(
      0,
      lastRowOffset - (Math.max(1, rows) - 1) * rowWidth
    )
  }

  function clampViewportOffset(offset: number): number {
    if (fileSize <= 0) {
      return 0
    }
    return Math.max(0, Math.min(rowAlignOffset(offset), maxScrollableOffset))
  }

  function canRenderVisibleOffset(offset: number): boolean {
    const visibleByteCount = Math.min(
      visibleByteCapacity(),
      Math.max(0, fileSize - offset)
    )
    return (
      visibleByteCount > 0 &&
      offset >= viewportOffset &&
      offset + visibleByteCount <= viewportOffset + viewportData.length
    )
  }

  function visibleByteCount(): number {
    return Math.min(
      visibleByteCapacity(),
      Math.max(0, fileSize - visibleOffset)
    )
  }

  function currentEditorUiState(): WebviewEditorUiState {
    return {
      visibleOffset,
      visibleByteCount: visibleByteCount(),
      selectedOffset,
      selectionStart,
      selectionEnd,
      selectionLength,
      bytesPerRow,
      offsetRadix,
      textEncoding,
      activePane,
      editMode: inspectorEditMode,
      insertDirection,
    }
  }

  function postEditorStateChanged(): void {
    const state = currentEditorUiState()
    const stateKey = JSON.stringify(state)
    if (stateKey === lastPostedEditorStateKey) {
      return
    }

    lastPostedEditorStateKey = stateKey
    postToHost({ type: 'editorStateChanged', ...state })
  }

  function averageRenderDuration(): number | null {
    if (renderSamples.length === 0) {
      return null
    }
    return (
      renderSamples.reduce((sum, sample) => sum + sample, 0) /
      renderSamples.length
    )
  }

  function pushRenderSample(durationMs: number): void {
    renderSamples = [...renderSamples.slice(-19), durationMs]
  }

  function profilerScope():
    | {
        label: string
        offset: number
        length: number
        requestedLength: number
        isCapped: boolean
      }
    | undefined {
    if (fileSize <= 0) {
      return undefined
    }

    if (selectionLength > 1) {
      return {
        label: strings.profiler.selection,
        offset: selectionStart,
        length: Math.min(selectionLength, MAX_ANALYSIS_PROFILE_BYTES),
        requestedLength: selectionLength,
        isCapped: selectionLength > MAX_ANALYSIS_PROFILE_BYTES,
      }
    }

    const visibleLength = visibleByteCount()
    return {
      label: strings.profiler.visible,
      offset: visibleOffset,
      length: Math.min(visibleLength, MAX_ANALYSIS_PROFILE_BYTES),
      requestedLength: visibleLength,
      isCapped: visibleLength > MAX_ANALYSIS_PROFILE_BYTES,
    }
  }

  function requestAnalysisProfile(force = false): void {
    if (!profilerExpanded || profilerMode !== 'profile') {
      return
    }

    const scope = profilerScope()
    if (!scope || scope.length <= 0) {
      latestDataProfile = undefined
      return
    }

    const requestKey = [
      scope.offset,
      scope.length,
      scope.requestedLength,
      fileSize,
      latestViewportProfile?.changeCount ?? 0,
    ].join(':')

    if (!force && requestKey === pendingAnalysisProfileKey) {
      return
    }
    pendingAnalysisProfileKey = requestKey

    const message = {
      type: 'requestAnalysisProfile' as const,
      offset: scope.offset,
      length: scope.length,
      requestKey,
      scopeLabel: scope.label,
      requestedLength: scope.requestedLength,
      isCapped: scope.isCapped,
    }

    if (analysisProfileRequestTimer) {
      clearTimeout(analysisProfileRequestTimer)
      analysisProfileRequestTimer = undefined
    }

    if (force) {
      postToHost(message)
      return
    }

    analysisProfileRequestTimer = setTimeout(() => {
      analysisProfileRequestTimer = undefined
      postToHost(message)
    }, 120)
  }

  function updateProfilerViewportSnapshot(message: ViewportDataMessage): void {
    const messageAt = Date.now()
    const renderStarted = performance.now()
    const hostToWebviewMs = Math.max(0, messageAt - message.profile.sentAt)

    latestViewportProfile = {
      ...message.profile,
      hostToWebviewMs,
      renderDurationMs: latestViewportProfile?.renderDurationMs ?? 0,
      averageRenderMs: averageRenderDuration(),
      messageAt,
      renderAt: latestViewportProfile?.renderAt ?? messageAt,
      followingByteCount: message.followingByteCount,
    }

    requestAnimationFrame(() => {
      const renderDurationMs = performance.now() - renderStarted
      pushRenderSample(renderDurationMs)
      const renderAt = Date.now()
      latestViewportProfile = {
        ...message.profile,
        hostToWebviewMs,
        renderDurationMs,
        averageRenderMs: averageRenderDuration(),
        messageAt,
        renderAt,
        followingByteCount: message.followingByteCount,
      }
    })
  }

  function canScroll(direction: 'up' | 'down'): boolean {
    const currentTarget = pendingVisibleOffset ?? visibleOffset
    return direction === 'up'
      ? currentTarget > 0
      : currentTarget < maxScrollableOffset
  }

  function isVisibleRange(offset: number, length: number): boolean {
    const safeLength = Math.max(1, length)
    return (
      offset >= visibleOffset &&
      offset + safeLength <= visibleOffset + visibleByteCount() &&
      canRenderVisibleOffset(visibleOffset)
    )
  }

  function requestVisibleOffset(offset: number): void {
    const nextOffset = clampViewportOffset(offset)
    const currentTarget = pendingVisibleOffset ?? visibleOffset
    if (nextOffset === currentTarget && canRenderVisibleOffset(nextOffset)) {
      return
    }

    pendingVisibleOffset = nextOffset
    if (canRenderVisibleOffset(nextOffset)) {
      visibleOffset = nextOffset
    }
    postToHost({ type: 'scrollTo', offset: nextOffset })
  }

  function clearInspectorHighlight(): void {
    inspectorHighlightStart = -1
    inspectorHighlightEnd = -1
  }

  function saveSelectionState(): void {
    savePreviewState({ selectionAnchor, selectedOffset })
  }

  function selectOffset(offset: number, extend = false): void {
    if (offset >= fileSize) {
      if (fileSize === 0 || !extend) {
        selectionAnchor = -1
        selectedOffset = fileSize
        clipboardMessage = ''
        pendingHexNibble = undefined
        pendingHexLabel = ''
        clearInspectorHighlight()
        saveSelectionState()
        return
      }

      // When extending a selection, clamp to the last existing byte.
      offset = fileSize - 1
    }

    const nextOffset = clampOffset(offset)
    if (nextOffset < 0) {
      selectionAnchor = -1
      selectedOffset = -1
      clipboardMessage = ''
      saveSelectionState()
      return
    }

    if (!extend || selectionAnchor < 0) {
      selectionAnchor = nextOffset
    }
    selectedOffset = nextOffset
    clipboardMessage = ''
    pendingHexNibble = undefined
    pendingHexLabel = ''
    clearInspectorHighlight()
    syncSearchIndexToSelection(nextOffset)
    saveSelectionState()

    if (
      nextOffset < visibleOffset ||
      nextOffset >= visibleOffset + visibleByteCount()
    ) {
      requestVisibleOffset(rowAlignOffset(nextOffset))
    }
  }

  function selectRange(offset: number, length: number): void {
    const start = clampOffset(offset)
    if (start < 0) {
      selectionAnchor = -1
      selectedOffset = -1
      clipboardMessage = ''
      saveSelectionState()
      return
    }

    const end = clampOffset(start + Math.max(1, length) - 1)
    selectionAnchor = Math.max(start, end)
    selectedOffset = start
    clipboardMessage = ''
    pendingHexNibble = undefined
    pendingHexLabel = ''
    clearInspectorHighlight()
    saveSelectionState()

    if (
      start < visibleOffset ||
      start >= visibleOffset + visibleByteCount() ||
      selectionAnchor >= visibleOffset + visibleByteCount()
    ) {
      requestVisibleOffset(rowAlignOffset(start))
    }
  }

  function moveSelection(delta: number, extend: boolean): void {
    pendingHexNibble = undefined
    pendingHexLabel = ''
    const origin = selectedOffset >= 0 ? selectedOffset : visibleOffset
    selectOffset(origin + delta, extend)
  }

  function selectedEditOffset(): number {
    if (selectionStart >= 0) {
      return selectionStart
    }
    if (selectedOffset >= 0) {
      return Math.max(0, Math.min(selectedOffset, fileSize))
    }
    return fileSize > 0 ? clampOffset(visibleOffset) : 0
  }

  function blockMutationWhileTransform(): boolean {
    if (!transformInFlight) {
      return false
    }
    clipboardMessage = strings.transform.inFlight
    replaceMessage = strings.transform.inFlight
    return true
  }

  function postDeleteRange(offset: number, length: number): void {
    if (blockMutationWhileTransform()) {
      return
    }
    if (length <= 0 || fileSize <= 0 || offset < 0 || offset >= fileSize) {
      return
    }

    const safeLength = Math.min(length, fileSize - offset)
    postToHost({ type: 'delete', offset, length: safeLength })
    pendingHexNibble = undefined
    pendingHexLabel = ''
    clipboardMessage = strings.inspector.deletedBytes(safeLength)
    selectOffset(Math.min(offset, Math.max(0, fileSize - safeLength - 1)))
  }

  function deleteFromKeyboard(backward: boolean): boolean {
    if (blockMutationWhileTransform()) {
      return true
    }
    if (fileSize <= 0) {
      return false
    }

    if (selectionLength > 1) {
      postDeleteRange(selectionStart, selectionLength)
      return true
    }

    const offset = selectedEditOffset()
    if (backward) {
      if (offset <= 0) {
        return true
      }
      postDeleteRange(offset - 1, 1)
      return true
    }

    postDeleteRange(offset, 1)
    return true
  }

  function scrollPreview(direction: 'up' | 'down'): void {
    if (!canScroll(direction)) {
      return
    }

    const baseOffset = pendingVisibleOffset ?? visibleOffset
    const delta = (direction === 'up' ? -4 : 4) * bytesPerRow
    requestVisibleOffset(baseOffset + delta)
  }

  function jumpToBoundary(boundary: 'top' | 'bottom'): void {
    pendingHexNibble = undefined
    pendingHexLabel = ''
    requestVisibleOffset(boundary === 'top' ? 0 : maxScrollableOffset)
  }

  function goToOffset(offset: number): void {
    if (offset < 0 || offset >= fileSize) {
      return
    }
    pendingHexNibble = undefined
    pendingHexLabel = ''
    selectOffset(offset)
  }

  function setVisibleRows(rows: number): void {
    const nextRows = Math.max(DEFAULT_VISIBLE_ROWS, Math.floor(rows))
    if (nextRows === visibleRows) {
      return
    }

    visibleRows = nextRows
    postToHost({ type: 'setViewportMetrics', visibleRows: nextRows })
  }

  function activeClipboardFormat(): 'hex' | 'utf8' {
    return activePane === 'ascii' ? 'utf8' : 'hex'
  }

  function selectedClipboardRange():
    | { offset: number; length: number }
    | undefined {
    if (selectionStart >= 0 && selectionLength > 0) {
      return { offset: selectionStart, length: selectionLength }
    }
    if (selectedOffset >= 0 && selectedOffset < fileSize) {
      return { offset: selectedOffset, length: 1 }
    }
    return undefined
  }

  function bytesToHexText(bytes: number[]): string {
    return bytes.map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ')
  }

  function bytesToCompactHex(bytes: number[]): string {
    return bytes
      .map((byte) => byte.toString(16).toUpperCase().padStart(2, '0'))
      .join('')
  }

  function bytesToPrintableText(bytes: number[]): string | undefined {
    return decodeTextBytes(bytes, textEncoding)
  }

  function getVisibleRangeBytes(
    offset: number,
    length: number
  ): number[] | undefined {
    const bytes = visibleBytesAt(
      offset,
      length,
      viewportData,
      viewportOffset,
      fileSize
    )
    return bytes.length === length ? bytes : undefined
  }

  function postClipboardSelection(action: 'copy' | 'cut'): void {
    if (action === 'cut' && blockMutationWhileTransform()) {
      return
    }
    const range = selectedClipboardRange()
    if (!range) {
      return
    }

    clipboardMessage = strings.inspector.copying
    postToHost({
      type: action === 'cut' ? 'cutSelection' : 'copySelection',
      offset: range.offset,
      length: range.length,
      format: activeClipboardFormat(),
    })
  }

  function writeClipboardBytes(
    clipboardData: DataTransfer,
    bytes: number[]
  ): boolean {
    const compactHex = bytesToCompactHex(bytes)
    clipboardData.setData(INTERNAL_HEX_CLIPBOARD_FORMAT, compactHex)

    if (activePane === 'ascii') {
      const text = bytesToPrintableText(bytes)
      if (text === undefined) {
        return false
      }
      clipboardData.setData('text/plain', text)
      return true
    }

    clipboardData.setData('text/plain', bytesToHexText(bytes))
    return true
  }

  function handleClipboardCopy(event: ClipboardEvent, action: 'copy' | 'cut'): void {
    if (isEditableTarget(event.target)) {
      return
    }

    const range = selectedClipboardRange()
    if (!range) {
      return
    }
    if (action === 'cut' && blockMutationWhileTransform()) {
      return
    }

    const bytes = getVisibleRangeBytes(range.offset, range.length)
    if (event.clipboardData && bytes && writeClipboardBytes(event.clipboardData, bytes)) {
      event.preventDefault()
      clipboardMessage =
        action === 'cut'
          ? strings.inspector.cutSelection(range.length)
          : strings.inspector.copiedSelection(range.length, activeClipboardFormat())
      if (action === 'cut') {
        if (blockMutationWhileTransform()) {
          return
        }
        postToHost({ type: 'delete', offset: range.offset, length: range.length })
      }
      return
    }

    event.preventDefault()
    postClipboardSelection(action)
  }

  function normalizeClipboardHex(value: string): string | undefined {
    const compact = value.replace(/\s/g, '')
    if (compact.length === 0) {
      return undefined
    }
    return compact.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(compact)
      ? compact.toUpperCase()
      : undefined
  }

  function printableTextInputToHex(value: string): string | undefined {
    if (value.length === 0) {
      return undefined
    }
    return printableTextToHex(value, textEncoding)
  }

  function compactHexToBytes(value: string): number[] {
    return Array.from({ length: value.length / 2 }, (_, index) =>
      parseInt(value.slice(index * 2, index * 2 + 2), 16)
    )
  }

  function decodeClipboardPaste(clipboardData: DataTransfer): string | undefined {
    const internalHex = normalizeClipboardHex(
      clipboardData.getData(INTERNAL_HEX_CLIPBOARD_FORMAT)
    )
    if (internalHex) {
      return activePane === 'hex' ||
        bytesToPrintableText(compactHexToBytes(internalHex)) !== undefined
        ? internalHex
        : undefined
    }

    const text =
      clipboardData.getData('text/plain') || clipboardData.getData('text')
    if (activePane === 'hex') {
      return normalizeClipboardHex(text)
    }
    return printableTextInputToHex(text)
  }

  function pasteClipboardHex(data: string): void {
    if (blockMutationWhileTransform()) {
      return
    }
    const range = selectedClipboardRange()
    const offset = range?.offset ?? selectedEditOffset()
    if (offset < 0 || offset > fileSize) {
      return
    }

    const byteLength = data.length / 2
    postToHost({ type: 'insert', offset, data })
    fileSize += byteLength
    selectAfterInsertedBytes(offset, byteLength)
    clipboardMessage = strings.inspector.pastedBytes(byteLength)
  }

  function handleClipboardPaste(event: ClipboardEvent): void {
    if (isEditableTarget(event.target) || !event.clipboardData) {
      return
    }

    const data = decodeClipboardPaste(event.clipboardData)
    event.preventDefault()
    if (!data) {
      clipboardMessage =
        activePane === 'hex'
          ? strings.inspector.invalidHexPaste
          : strings.inspector.invalidTextPaste
      return
    }

    pasteClipboardHex(data)
  }

  function setInspectorEditMode(mode: InspectorEditMode): void {
    inspectorEditMode = mode
    pendingHexNibble = undefined
    pendingHexLabel = ''
  }

  function toggleInspectorEditMode(): void {
    postToHost({ type: 'toggleEditMode' })
  }

  function setInsertDirection(direction: InsertDirection): void {
    insertDirection = direction
    savePreviewState({ insertDirection: direction })
    postToHost({ type: 'setInsertDirection', insertDirection: direction })
  }

  function setActivePane(pane: GridEditPane): void {
    activePane = pane
    pendingHexNibble = undefined
    pendingHexLabel = ''
  }

  function visibleBytesAt(
    offset: number,
    length: number,
    source: number[],
    sourceOffset: number,
    totalSize: number
  ): number[] {
    if (offset < sourceOffset || length <= 0) {
      return []
    }

    const start = offset - sourceOffset
    return source.slice(
      start,
      Math.min(
        start + length,
        source.length,
        Math.max(0, totalSize - sourceOffset)
      )
    )
  }

  function setInsertionCaret(offset: number): void {
    const nextOffset = Math.max(0, Math.min(offset, fileSize))
    if (nextOffset >= fileSize) {
      selectionAnchor = -1
      selectedOffset = nextOffset
    } else {
      selectionAnchor = nextOffset
      selectedOffset = nextOffset
    }
  }

  function selectAfterInsertedBytes(offset: number, byteLength: number): void {
    if (insertDirection === 'backward') {
      selectionAnchor = Math.max(0, Math.min(offset, Math.max(0, fileSize - 1)))
      selectedOffset = selectionAnchor
      return
    }

    setInsertionCaret(offset + byteLength)
  }

  function commitByteEdit(offset: number, byte: number): void {
    if (blockMutationWhileTransform()) {
      return
    }
    if (offset < 0 || byte < 0 || byte > 0xff) {
      return
    }

    const data = byte.toString(16).toUpperCase().padStart(2, '0')
    const overwritingExistingByte =
      inspectorEditMode === 'overwrite' && offset < fileSize
    if (overwritingExistingByte) {
      postToHost({ type: 'overwrite', offset, data })
      clipboardMessage = strings.inspector.overwroteByte
    } else if (offset <= fileSize) {
      postToHost({ type: 'insert', offset, data })
      fileSize += 1
      selectAfterInsertedBytes(offset, 1)
      clipboardMessage = strings.inspector.insertedByte
    } else {
      return
    }

    pendingHexNibble = undefined
    pendingHexLabel = ''
    if (overwritingExistingByte) {
      selectionAnchor = offset
      selectedOffset = offset
    }
  }

  function handleGridType(pane: GridEditPane, key: string): boolean {
    if (transformInFlight) {
      return false
    }
    const offset = selectedEditOffset()
    if (offset < 0 || offset > fileSize) {
      return false
    }

    if (pane === 'ascii') {
      if (Array.from(key).length !== 1) {
        return false
      }

      const data = printableTextToHex(key, textEncoding)
      if (!data || data.length !== 2) {
        clipboardMessage = strings.inspector.invalidTextByte
        return true
      }

      commitByteEdit(offset, parseInt(data, 16))
      return true
    }

    const hexDigit = /^[0-9a-f]$/i.test(key) ? parseInt(key, 16) : undefined
    if (hexDigit === undefined) {
      return false
    }

    if (pendingHexNibble === undefined) {
      pendingHexNibble = hexDigit
      pendingHexLabel = `${key.toUpperCase()}_`
      clipboardMessage = strings.status.hexPending(pendingHexLabel)
      return true
    }

    commitByteEdit(offset, (pendingHexNibble << 4) | hexDigit)
    return true
  }

  function commitInspectorValue(
    offset: number,
    length: number,
    data: string
  ): void {
    if (blockMutationWhileTransform()) {
      return
    }
    if (offset < 0 || length <= 0 || offset + length > fileSize) {
      clipboardMessage = strings.inspector.cannotOverwrite
      return
    }

    postToHost({ type: 'overwrite', offset, data })
    clipboardMessage = strings.inspector.overwroteBytes(length)
    selectionAnchor = offset
    selectedOffset = offset
  }

  function toggleInspectorEndian(): void {
    inspectorLittleEndian = !inspectorLittleEndian
  }

  function toggleInspectorExpanded(): void {
    inspectorExpanded = !inspectorExpanded
  }

  function toggleSearchPanelVisible(): void {
    const visible = !searchPanelVisible
    if (visible && checkpointTimeline.visible) {
      checkpointTimeline = { ...checkpointTimeline, visible: false }
      postToHost({ type: 'hideCheckpointTimeline' })
    }
    if (visible && actionJournalVisible) {
      actionJournalVisible = false
      postToHost({ type: 'hideActionJournal' })
    }
    searchPanelVisible = visible
    savePreviewState({ searchPanelVisible })
  }

  function openSearchPanel(showReplace = false): void {
    if (checkpointTimeline.visible) {
      checkpointTimeline = { ...checkpointTimeline, visible: false }
      postToHost({ type: 'hideCheckpointTimeline' })
    }
    if (actionJournalVisible) {
      actionJournalVisible = false
      postToHost({ type: 'hideActionJournal' })
    }
    searchPanelVisible = true
    if (showReplace) {
      replaceVisible = true
    }
    savePreviewState({ searchPanelVisible: true, replaceVisible })
  }

  function requestActionJournal(
    kinds = actionJournalKinds,
    transactionId = actionJournalTransactionId,
    anchorSerial?: string,
    append = false
  ): void {
    actionJournalLoading = true
    actionJournalError = ''
    actionJournalKinds = kinds
    actionJournalTransactionId = transactionId
    postToHost({
      type: 'requestActionJournalViewport',
      capacity: 256,
      direction: 'older',
      kinds,
      transactionId,
      anchorSerial,
      append,
    })
  }

  function toggleActionJournal(): void {
    if (actionJournalVisible) {
      actionJournalVisible = false
      postToHost({ type: 'hideActionJournal' })
      return
    }
    if (checkpointTimeline.visible) {
      checkpointTimeline = { ...checkpointTimeline, visible: false }
      postToHost({ type: 'hideCheckpointTimeline' })
    }
    if (searchPanelVisible) {
      closeSearchPanel()
    }
    actionJournalVisible = true
    requestActionJournal()
  }

  function setOffsetRadix(radix: 'hex' | 'dec'): void {
    offsetRadix = radix
    savePreviewState({ offsetRadix: radix })
  }

  function setTextEncoding(encoding: TextEncoding): void {
    if (encoding === textEncoding) {
      return
    }

    textEncoding = encoding
    savePreviewState({ textEncoding })
    postToHost({ type: 'setTextEncoding', textEncoding })
    pendingAnalysisProfileKey = ''
    requestAnalysisProfile(true)

    if (!searchHex && searchQuery.trim().length > 0) {
      if (searchMode !== 'none') {
        runSearch(searchReverse ? 'backward' : 'forward')
      } else if (!normalizeSearchQuery(searchQuery, searchHex)) {
        clearSearchResults(strings.search.invalidSearch)
      } else {
        searchMessage = strings.search.ready
      }
    }
  }

  function computedContentInfo(size: number): WebviewSessionContentInfo {
    return {
      content: 'computed',
      available: true,
      byteLength: size,
      label: strings.transform.contentComputed,
    }
  }

  function updateComputedContentInfo(size: number): void {
    let found = false
    const nextSources = contentSources.map((entry) => {
      if (entry.content !== 'computed') {
        return entry
      }
      found = true
      return computedContentInfo(size)
    })
    contentSources = found
      ? nextSources
      : [computedContentInfo(size), ...nextSources]
  }

  function contentSourceFallbackLabel(
    contentSource: WebviewSessionContentSource
  ): string {
    switch (contentSource) {
      case 'original':
        return strings.transform.contentOriginal
      case 'latestCheckpoint':
        return strings.transform.contentLatestCheckpoint
      default:
        return strings.transform.contentComputed
    }
  }

  function transformResultContentSourceLabel(
    contentSource: WebviewSessionContentSource
  ): string {
    return (
      contentSources.find((entry) => entry.content === contentSource)?.label ||
      contentSourceFallbackLabel(contentSource)
    )
  }

  function formatSearchOffset(offset: number): string {
    return offsetRadix === 'dec'
      ? formatNumber(offset)
      : `0x${offset.toString(16).toUpperCase()}`
  }

  function requestTransformPlugins(): void {
    if (transformPluginsLoading) {
      return
    }
    transformPluginsLoading = true
    postToHost({ type: 'requestTransformPlugins' })
  }

  function loadRangeMap(): void {
    postToHost({ type: 'loadRangeMap' })
  }

  function unloadRangeMap(): void {
    postToHost({ type: 'unloadRangeMap' })
  }

  function applyTransform(
    pluginId: string,
    contentSource: WebviewSessionContentSource,
    offset: number,
    length: number,
    optionsJson?: string
  ): void {
    if (transformInFlight) {
      return
    }
    const contentByteLength =
      contentSources.find(
        (entry) => entry.content === contentSource && entry.available
      )?.byteLength ?? (contentSource === 'computed' ? fileSize : -1)
    if (
      contentByteLength <= 0 ||
      offset < 0 ||
      length <= 0 ||
      offset + length > contentByteLength
    ) {
      transformFeedback = strings.transform.selectRangeFirst
      return
    }

    const plugin = transformPlugins.find((entry) => entry.id === pluginId)
    transformInFlight = true
    transformCancelable = true
    transformFeedback = strings.transform.applying(plugin?.name || pluginId)
    transformResult = undefined
    postToHost({
      type: 'applyTransform',
      pluginId,
      contentSource,
      offset,
      length,
      optionsJson: optionsJson?.trim() || undefined,
    })
  }

  function cancelTransform(): void {
    if (!transformInFlight || !transformCancelable) {
      return
    }
    transformFeedback = strings.transform.cancelling
    postToHost({ type: 'cancelTransform' })
  }

  function exportRange(offset: number, length: number): void {
    if (transformInFlight) {
      return
    }
    if (
      fileSize <= 0 ||
      offset < 0 ||
      length <= 0 ||
      offset + length > fileSize
    ) {
      transformFeedback = strings.transform.selectRangeFirst
      return
    }

    transformInFlight = true
    transformCancelable = false
    transformFeedback = strings.transform.exportingRange
    postToHost({ type: 'exportRange', offset, length })
  }

  function insertFile(offset: number): void {
    if (transformInFlight) {
      return
    }
    if (offset < 0 || offset > fileSize) {
      transformFeedback = strings.transform.invalidInsertOffset
      return
    }

    transformInFlight = true
    transformCancelable = false
    transformFeedback = strings.transform.insertingFile
    postToHost({ type: 'insertFile', offset })
  }

  function replaceRangeWithFile(offset: number, length: number): void {
    if (transformInFlight) {
      return
    }
    if (
      fileSize <= 0 ||
      offset < 0 ||
      length <= 0 ||
      offset + length > fileSize
    ) {
      transformFeedback = strings.transform.selectRangeFirst
      return
    }

    transformInFlight = true
    transformCancelable = false
    transformFeedback = strings.transform.replacingWithFile
    postToHost({ type: 'replaceRangeWithFile', offset, length })
  }

  function createCheckpoint(): void {
    if (transformInFlight) {
      return
    }

    transformInFlight = true
    transformCancelable = false
    transformFeedback = strings.transform.creatingCheckpoint
    postToHost({ type: 'createCheckpoint' })
  }

  function rollbackCheckpoint(): void {
    if (transformInFlight) {
      return
    }

    transformInFlight = true
    transformCancelable = false
    transformFeedback = strings.transform.rollingBackCheckpoint
    postToHost({ type: 'rollbackCheckpoint' })
  }

  function restoreCheckpoint(): void {
    if (transformInFlight) {
      return
    }

    transformInFlight = true
    transformCancelable = false
    transformFeedback = strings.transform.restoringCheckpoint
    postToHost({ type: 'restoreCheckpoint' })
  }

  function exportChangeLog(): void {
    if (transformInFlight) {
      return
    }

    transformInFlight = true
    transformCancelable = false
    transformFeedback = strings.transform.exportingChangeLog
    postToHost({ type: 'exportChangeLog' })
  }

  function applyChangeLog(): void {
    if (transformInFlight) {
      return
    }

    transformInFlight = true
    transformCancelable = false
    transformFeedback = strings.transform.applyingChangeLog
    postToHost({ type: 'applyChangeLog' })
  }

  function describeTransformComplete(message: TransformCompleteMessage): string {
    if (message.resultText) {
      return strings.transform.resultAvailable(
        message.resultLabel || strings.transform.resultDefault
      )
    }
    if (message.contentChanged) {
      return strings.transform.transformed(
        message.length ?? 0,
        message.replacementLength ?? 0
      )
    }
    if (message.operation === 2) {
      return strings.transform.calculationCompleted
    }
    return strings.transform.noContentChange
  }

  function describeTransformStatus(message: TransformStatusMessage): string {
    if (!message.inFlight) {
      return message.message || strings.transform.completed
    }

    const prefix = message.message || message.phase || strings.transform.completed
    if (typeof message.processedBytes === 'number') {
      const processed = formatNumber(message.processedBytes)
      if (typeof message.totalBytes === 'number' && message.totalBytes > 0) {
        const total = formatNumber(message.totalBytes)
        const percent =
          typeof message.percent === 'number'
            ? ` (${message.percent.toFixed(1)}%)`
            : ''
        return `${prefix}: ${processed} / ${total} bytes${percent}`
      }
      return `${prefix}: ${processed} bytes`
    }

    if (typeof message.percent === 'number') {
      return `${prefix}: ${message.percent.toFixed(1)}%`
    }

    return prefix
  }

  function describeFileActionComplete(
    message: FileActionCompleteMessage
  ): string {
    if (message.message) {
      return message.message
    }
    if (message.cancelled) {
      return strings.transform.fileActionCancelled
    }

    switch (message.action) {
      case 'exportRange':
        return strings.transform.exportedRange(message.byteCount)
      case 'insertFile':
        return strings.transform.insertedFile(message.byteCount)
      case 'replaceRangeWithFile':
        return strings.transform.replacedRangeWithFile(
          message.length,
          message.byteCount
        )
    }
  }

  function transformPluginTitle(pluginId: string): string {
    const plugin = transformPlugins.find((entry) => entry.id === pluginId)
    return plugin?.name || plugin?.id || pluginId
  }

  function formatTransformResultTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  function createTransformResult(
    message: TransformCompleteMessage
  ): TransformResultState | undefined {
    if (!message.resultText) {
      return undefined
    }

    const contentSource = message.contentSource || 'computed'
    const displayLength = message.contentChanged
      ? message.replacementLength || message.length || 1
      : message.length || 1
    const rangeEnd = message.offset + displayLength - 1
    const timestamp = Date.now()
    const title = transformPluginTitle(message.pluginId)
    const label = message.resultLabel || strings.transform.resultDefault
    const createdAtLabel = formatTransformResultTime(timestamp)
    transformResultSequence += 1

    return {
      id: `${timestamp}-${transformResultSequence}-${message.pluginId}-${contentSource}-${message.offset}-${displayLength}`,
      title,
      summary: describeTransformComplete(message),
      label,
      contentSource,
      contentSourceLabel: transformResultContentSourceLabel(contentSource),
      value: message.resultText,
      mimeType: message.resultMimeType,
      offset: message.offset,
      rangeEndOffset: rangeEnd,
      byteLength: displayLength,
      createdAtLabel,
      historyLabel: '',
    }
  }

  function shouldSelectTransformResultRange(
    message: TransformCompleteMessage
  ): boolean {
    return (message.contentSource || 'computed') === 'computed'
  }

  function formatTransformResult(
    result: TransformResultState
  ): DisplayTransformResultState {
    const rangeStart = formatSearchOffset(result.offset)
    const rangeEnd = formatSearchOffset(result.rangeEndOffset)
    return {
      ...result,
      rangeStart,
      rangeEnd,
      length: strings.transform.bytes(result.byteLength),
      historyLabel: strings.transform.resultHistoryItem(
        result.label,
        rangeStart,
        rangeEnd,
        result.createdAtLabel
      ),
    }
  }

  function rememberTransformResult(
    result: TransformResultState | undefined
  ): void {
    if (!result) {
      transformResult = undefined
      return
    }

    transformResultHistory = [
      result,
      ...transformResultHistory.filter((entry) => entry.id !== result.id),
    ].slice(0, TRANSFORM_RESULT_HISTORY_LIMIT)
    transformResult = result
  }

  function openTransformResult(resultId: string): void {
    const result = transformResultHistory.find((entry) => entry.id === resultId)
    if (result) {
      transformResult = result
    }
  }

  function inspectRange(offset: number, length: number): void {
    if (offset < 0 || length <= 0) {
      clearInspectorHighlight()
      return
    }

    inspectorHighlightStart = offset
    inspectorHighlightEnd = Math.min(fileSize - 1, offset + length - 1)
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false
    }
    return (
      target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    )
  }

  function normalizeHexInput(
    value: string,
    allowEmpty: boolean
  ): string | undefined {
    const compact = value.replace(/\s/g, '')
    if (compact.length === 0) {
      return allowEmpty ? '' : undefined
    }
    return compact.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(compact)
      ? compact
      : undefined
  }

  function normalizeSearchQuery(query: string, isHex: boolean): string | undefined {
    const trimmed = query.trim()
    if (trimmed.length === 0) {
      return undefined
    }
    if (!isHex) {
      return encodeTextToHex(trimmed, textEncoding)
    }

    return normalizeHexInput(trimmed, false)
  }

  function normalizeReplacementHex(
    replacement: string,
    isHex: boolean
  ): string | undefined {
    return isHex
      ? normalizeHexInput(replacement, true)
      : encodeTextToHex(replacement, textEncoding)
  }

  function requestViewportSearchMatches(): void {
    if (searchMode !== 'large' && searchMode !== 'bounded') return
    const normalized = normalizeSearchQuery(searchQuery, searchHex)
    if (!normalized || searchPatternLength <= 0) return
    const vpOffset = viewportOffset
    const vpLength = Math.min(
      viewportData.length,
      Math.max(0, fileSize - vpOffset)
    )
    if (vpLength <= 0) return
    postToHost({
      type: 'searchViewportMatches',
      query: normalized,
      isHex: true,
      caseInsensitive: !searchHex && searchCaseInsensitive,
      ...(searchHex ? {} : { textEncoding }),
      viewportOffset: vpOffset,
      viewportLength: vpLength,
    })
  }

  function syncSearchIndexToSelection(offset: number): void {
    if (searchPatternLength <= 0) return
    if (searchMode === 'large') {
      const nearest = findNearestViewportMatch(offset)
      if (nearest >= 0) {
        searchCurrentOffset = nearest
      }
      return
    }
    if (searchMatches.length === 0) return
    const nearest = findNearestBoundedMatch(offset)
    if (nearest >= 0) {
      searchMatchIndex = nearest
    }
  }

  function findNearestBoundedMatch(offset: number): number {
    if (searchMatches.length === 0) return -1
    let best = -1
    let bestDist = Infinity
    for (let i = 0; i < searchMatches.length; i++) {
      const matchOffset = searchMatches[i]
      const dist = Math.abs(matchOffset - offset)
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    }
    return best
  }

  function findAdjacentBoundedMatchIndex(
    anchorOffset: number,
    direction: 'forward' | 'backward'
  ): number {
    if (searchMatches.length === 0) return -1
    if (direction === 'forward') {
      for (let i = 0; i < searchMatches.length; i++) {
        if (searchMatches[i] > anchorOffset) return i
      }
      return 0
    }
    for (let i = searchMatches.length - 1; i >= 0; i--) {
      if (searchMatches[i] < anchorOffset) return i
    }
    return searchMatches.length - 1
  }

  function findNearestViewportMatch(offset: number): number {
    if (viewportSearchMatches.size === 0) return -1
    let best = -1
    let bestDist = Infinity
    for (const matchOffset of viewportSearchMatches) {
      const dist = Math.abs(matchOffset - offset)
      if (dist < bestDist) {
        bestDist = dist
        best = matchOffset
      }
    }
    return best
  }

  function getSearchPatternByteLength(query: string): number {
    return query.length / 2
  }

  function clearSearchResults(message = strings.search.noSearch): void {
    pendingSearchReveal = undefined
    searchMode = 'none'
    searchMatches = []
    searchMatchIndex = -1
    searchCurrentOffset = -1
    searchPatternLength = 0
    viewportSearchMatches = new Set()
    searchMessage = message
  }

  function applyDocumentReverted(): void {
    pendingVisibleOffset = undefined
    pendingHexNibble = undefined
    pendingHexLabel = ''
    replaceMessage = ''
    clipboardMessage = ''
    clearInspectorHighlight()
    clearSearchResults()
    if (fileSize <= 0) {
      selectionAnchor = -1
      selectedOffset = -1
    } else {
      selectionAnchor = visibleOffset
      selectedOffset = visibleOffset
    }
  }

  function getCurrentSearchOffset(): number {
    if (searchMode === 'large') {
      return searchCurrentOffset
    }
    if (searchMatches.length === 0 || searchMatchIndex < 0) {
      return -1
    }
    return searchMatches[searchMatchIndex]
  }

  function hasSearchResults(): boolean {
    return searchMode === 'large'
      ? searchCurrentOffset >= 0
      : searchMatches.length > 0
  }

  function setSearchQuery(query: string): void {
    searchQuery = query
    replaceMessage = ''
    const normalized = normalizeSearchQuery(query, searchHex)
    if (query.trim().length === 0) {
      clearSearchResults()
    } else if (!normalized) {
      clearSearchResults(
        searchHex ? strings.search.invalidHex : strings.search.invalidSearch
      )
    } else if (searchMode !== 'none') {
      clearSearchResults(strings.search.ready)
    } else {
      searchMessage = strings.search.ready
    }
    if (searchDebounceTimer !== undefined) {
      clearTimeout(searchDebounceTimer)
    }
    if (normalized) {
      searchDebounceTimer = setTimeout(() => {
        searchDebounceTimer = undefined
        runSearch()
      }, 250)
    }
  }

  function setSearchHex(enabled: boolean): void {
    searchHex = enabled
    if (enabled) {
      searchCaseInsensitive = false
    }
    replaceMessage = ''
    clearSearchResults()
    if (searchDebounceTimer !== undefined) {
      clearTimeout(searchDebounceTimer)
      searchDebounceTimer = undefined
    }
  }

  function setSearchCaseSensitive(enabled: boolean): void {
    searchCaseInsensitive = !enabled
    replaceMessage = ''
    clearSearchResults(
      searchQuery.trim().length > 0
        ? strings.search.ready
        : strings.search.noSearch
    )
    if (searchDebounceTimer !== undefined) {
      clearTimeout(searchDebounceTimer)
      searchDebounceTimer = undefined
    }
  }

  function toggleReplaceVisible(): void {
    replaceVisible = !replaceVisible
    savePreviewState({ replaceVisible })
  }

  function closeSearchPanel(): void {
    searchPanelVisible = false
    replaceVisible = false
    savePreviewState({ searchPanelVisible: false, replaceVisible: false })
    if (searchDebounceTimer !== undefined) {
      clearTimeout(searchDebounceTimer)
      searchDebounceTimer = undefined
    }
    clearSearchResults()
  }

  function setReplacementQuery(replacement: string): void {
    replacementQuery = replacement
    replaceMessage =
      normalizeReplacementHex(replacement, searchHex) === undefined
        ? strings.search.invalidReplacementHex
        : ''
  }

  function runSearch(direction?: 'forward' | 'backward'): void {
    const normalized = normalizeSearchQuery(searchQuery, searchHex)
    if (!normalized) {
      clearSearchResults(
        searchQuery.trim().length > 0
          ? strings.search.invalidHex
          : strings.search.noSearch
      )
      return
    }

    const isReverse = direction ? direction === 'backward' : searchReverse
    searchReverse = isReverse
    searchPatternLength = getSearchPatternByteLength(normalized)
    searchMessage = strings.search.searching
    replaceMessage = ''
    postToHost({
      type: 'search',
      query: normalized,
      isHex: true,
      caseInsensitive: !searchHex && searchCaseInsensitive,
      isReverse,
      ...(searchHex ? {} : { textEncoding }),
    })
  }

  function selectSearchMatch(offset: number): void {
    if (offset >= 0) {
      selectRange(offset, searchPatternLength)
    }
  }

  function navigateSearch(direction: 'forward' | 'backward'): void {
    if (!hasSearchResults() || searchPatternLength <= 0) {
      runSearch(direction)
      return
    }

    const anchor = selectedOffset >= 0 ? selectedOffset : getCurrentSearchOffset()

    if (searchMode === 'large') {
      const normalized = normalizeSearchQuery(searchQuery, searchHex)
      if (!normalized) {
        clearSearchResults(
          searchHex ? strings.search.invalidHex : strings.search.invalidSearch
        )
        return
      }
      postToHost({
        type: 'findAdjacentMatch',
        query: normalized,
        isHex: true,
        caseInsensitive: !searchHex && searchCaseInsensitive,
        ...(searchHex ? {} : { textEncoding }),
        direction,
        offset: Math.max(0, anchor),
      })
      return
    }

    const nextIndex = findAdjacentBoundedMatchIndex(anchor, direction)
    if (nextIndex < 0) {
      searchMessage = strings.search.noMatch
      return
    }
    const matchOffset = searchMatches[nextIndex]
    if (!isVisibleRange(matchOffset, searchPatternLength)) {
      pendingSearchReveal = { kind: 'bounded', index: nextIndex }
      postToHost({ type: 'goToMatch', offset: matchOffset })
      return
    }

    searchMatchIndex = nextIndex
    selectSearchMatch(matchOffset)
    postToHost({ type: 'goToMatch', offset: matchOffset })
  }

  function replaceCurrentMatch(): void {
    if (blockMutationWhileTransform()) {
      return
    }
    const currentOffset = getCurrentSearchOffset()
    if (
      currentOffset < 0 ||
      searchPatternLength <= 0 ||
      normalizedReplacementHex === undefined
    ) {
      replaceMessage =
        normalizedReplacementHex === undefined
          ? strings.search.invalidReplacementHex
          : ''
      return
    }

    replaceMessage = ''
    postToHost({
      type: 'replace',
      offset: currentOffset,
      length: searchPatternLength,
      data: normalizedReplacementHex,
    })
  }

  function replaceAllMatches(): void {
    if (blockMutationWhileTransform()) {
      return
    }
    const normalizedQuery = normalizeSearchQuery(searchQuery, searchHex)
    if (
      !hasSearchResults() ||
      searchPatternLength <= 0 ||
      !normalizedQuery ||
      normalizedReplacementHex === undefined
    ) {
      replaceMessage =
        normalizedReplacementHex === undefined
          ? strings.search.invalidReplacementHex
          : ''
      return
    }

    replaceMessage = ''
    transformInFlight = true
    transformCancelable = false
    transformFeedback = strings.search.replacingAll
    postToHost({
      type: 'replaceAllMatches',
      query: normalizedQuery,
      isHex: true,
      caseInsensitive: !searchHex && searchCaseInsensitive,
      isReverse: searchReverse,
      ...(searchHex ? {} : { textEncoding }),
      length: searchPatternLength,
      data: normalizedReplacementHex,
    })
  }

  function applySingleReplaceToSearchMatches(
    replacedOffset: number,
    offsetDelta: number
  ): number {
    if (searchMatches.length === 0 || searchMatchIndex < 0) {
      clearSearchResults(strings.search.noMatches)
      return -1
    }

    searchMatches = searchMatches.filter(
      (_, index) => index !== searchMatchIndex
    )

    if (searchMatches.length === 0) {
      clearSearchResults(strings.search.noMatches)
      return -1
    }

    if (searchMatchIndex >= searchMatches.length) {
      searchMatchIndex = searchMatches.length - 1
    }

    if (offsetDelta !== 0) {
      searchMatches = searchMatches.map((matchOffset) =>
        matchOffset > replacedOffset ? matchOffset + offsetDelta : matchOffset
      )
    }

    const nextMatchOffset = searchMatches[searchMatchIndex]
    selectSearchMatch(nextMatchOffset)
    postToHost({ type: 'goToMatch', offset: nextMatchOffset })
    return nextMatchOffset
  }

  function searchResultsOffset(message: SearchResultsMessage): number {
    return message.mode === 'large'
      ? message.currentOffset
      : (message.matches[0] ?? -1)
  }

  function applySearchResults(message: SearchResultsMessage): void {
    searchPatternLength = message.patternLength || searchPatternLength
    searchWindowLimit = message.windowLimit || searchWindowLimit
    if (message.mode === 'large') {
      searchMode = 'large'
      searchMatches = []
      viewportSearchMatches = new Set()
      searchMatchIndex = -1
      searchCurrentOffset = message.currentOffset
      searchMessage =
        message.currentOffset >= 0
          ? strings.search.largeSearch
          : strings.search.noMatches
      selectSearchMatch(message.currentOffset)
      return
    }

    searchMode = 'bounded'
    searchMatches = message.matches
    searchCurrentOffset = -1
    searchMatchIndex = message.matches.length > 0 ? 0 : -1
    searchMessage =
      message.matches.length > 0
        ? strings.search.searchComplete
        : strings.search.noMatches
    if (message.matches.length > 0) {
      selectSearchMatch(message.matches[0])
    }
  }

  function handleSearchResults(message: SearchResultsMessage): void {
    const resultOffset = searchResultsOffset(message)
    const resultLength = message.patternLength || searchPatternLength
    if (resultOffset >= 0 && !isVisibleRange(resultOffset, resultLength)) {
      pendingSearchReveal = { kind: 'results', message }
      return
    }

    applySearchResults(message)
  }

  function applySearchNavigationResult(
    message: SearchNavigationResultMessage
  ): void {
    searchMode = 'large'
    searchCurrentOffset = message.offset
    searchPatternLength = message.patternLength || searchPatternLength
    if (message.viewportMatches && message.viewportMatches.length > 0) {
      const next = new Set(viewportSearchMatches)
      for (const offset of message.viewportMatches) {
        next.add(offset)
      }
      viewportSearchMatches = next
    }
    searchMatches = []
    searchMatchIndex = -1
    selectSearchMatch(message.offset)
  }

  function handleSearchNavigationResult(
    message: SearchNavigationResultMessage
  ): void {
    if (message.offset < 0) {
      searchMessage = strings.search.noMatch
      return
    }

    const resultLength = message.patternLength || searchPatternLength
    if (!isVisibleRange(message.offset, resultLength)) {
      pendingSearchReveal = { kind: 'navigation', message }
      return
    }

    applySearchNavigationResult(message)
  }

  function applyPendingSearchReveal(): void {
    if (!pendingSearchReveal) {
      return
    }

    const pending = pendingSearchReveal
    if (pending.kind === 'results') {
      const resultOffset = searchResultsOffset(pending.message)
      const resultLength = pending.message.patternLength || searchPatternLength
      if (resultOffset < 0 || isVisibleRange(resultOffset, resultLength)) {
        pendingSearchReveal = undefined
        applySearchResults(pending.message)
      }
      return
    }

    if (pending.kind === 'navigation') {
      const resultLength = pending.message.patternLength || searchPatternLength
      if (isVisibleRange(pending.message.offset, resultLength)) {
        pendingSearchReveal = undefined
        applySearchNavigationResult(pending.message)
      }
      return
    }

    const matchOffset = searchMatches[pending.index]
    if (
      matchOffset !== undefined &&
      isVisibleRange(matchOffset, searchPatternLength)
    ) {
      pendingSearchReveal = undefined
      searchMatchIndex = pending.index
      selectSearchMatch(matchOffset)
    }
  }

  function handleHostMessage(message: HostToWebviewMessage): void {
    switch (message.type) {
      case 'viewportData': {
        const requestedOffset = pendingVisibleOffset

        updateProfilerViewportSnapshot(message)
        preparingFile = false
        fileSize = message.fileSize
        updateComputedContentInfo(message.fileSize)
        viewportOffset = message.offset
        viewportData = message.data
        externalHighlights = message.externalHighlights
        rangeMapTree = message.rangeMapTree

        if (
          requestedOffset !== undefined &&
          message.visibleOffset !== requestedOffset
        ) {
          if (canRenderVisibleOffset(requestedOffset)) {
            visibleOffset = requestedOffset
          }
        } else {
          visibleOffset = message.visibleOffset
          pendingVisibleOffset = undefined
        }

        if (message.fileSize <= 0) {
          selectionAnchor = -1
          selectedOffset = -1
        } else if (selectedOffset < 0) {
          selectionAnchor = message.visibleOffset
          selectedOffset = message.visibleOffset
        } else if (selectedOffset > message.fileSize) {
          const nextOffset = message.fileSize
          selectionAnchor = -1
          selectedOffset = nextOffset
        }
        viewportSnapshot = {
          fileSize: message.fileSize,
          visibleOffset,
          viewportOffset: message.offset,
          viewportData: message.data,
          externalHighlights: message.externalHighlights,
          rangeMapTree: message.rangeMapTree,
        }
        savePreviewState()
        applyPendingSearchReveal()
        requestViewportSearchMatches()
        break
      }
      case 'fileSizeChanged':
        fileSize = message.fileSize
        updateComputedContentInfo(message.fileSize)
        latestDataProfile = undefined
        pendingAnalysisProfileKey = ''
        if (message.fileSize <= 0) {
          selectionAnchor = -1
          selectedOffset = -1
          clearSearchResults()
        } else if (selectedOffset > message.fileSize) {
          const nextOffset = message.fileSize
          selectionAnchor = -1
          selectedOffset = nextOffset
        }
        break
      case 'sessionContentInfo':
        contentSources = message.contentSources
        break
      case 'documentReverted':
        latestDataProfile = undefined
        pendingAnalysisProfileKey = ''
        applyDocumentReverted()
        break
      case 'editState':
        canUndo = message.canUndo
        canRedo = message.canRedo
        undoCount = message.undoCount
        redoCount = message.redoCount
        break
      case 'transformPlugins':
        transformPlugins = message.plugins
        transformPluginsLoaded = true
        transformPluginsLoading = false
        transformPluginError = message.error ?? ''
        break
      case 'transformStatus':
        transformInFlight = message.inFlight
        if (!message.inFlight) {
          transformCancelable = false
        }
        if (
          message.inFlight ||
          message.message ||
          typeof message.processedBytes === 'number' ||
          typeof message.percent === 'number'
        ) {
          transformFeedback = describeTransformStatus(message)
        }
        break
      case 'serverHealth':
        serverHealth = message
        break
      case 'clipboardComplete':
        clipboardMessage = strings.inspector.clipboardComplete(
          message.action,
          message.byteCount,
          message.format
        )
        break
      case 'searchStateCleared':
        clearSearchResults()
        break
      case 'searchResults':
        handleSearchResults(message)
        break
      case 'searchNavigationResult':
        handleSearchNavigationResult(message)
        break
      case 'searchViewportMatchesResult': {
        if (searchMode === 'large' && message.patternLength > 0) {
          searchPatternLength = message.patternLength
          const next = new Set(viewportSearchMatches)
          for (const offset of message.matches) {
            next.add(offset)
          }
          viewportSearchMatches = next
        }
        break
      }
      case 'searchNavigationCommand':
        navigateSearch(message.direction)
        break
      case 'replaceComplete': {
        transformInFlight = false
        transformCancelable = false
        transformFeedback = ''
        const replacedCount = message.replacedCount ?? 0
        replaceMessage = strings.search.replaceSummary(replacedCount)
        let nextMatchOffset = -1

        if (
          message.scope === 'single' &&
          replacedCount > 0 &&
          typeof message.replacedOffset === 'number'
        ) {
          if (searchMode === 'large') {
            searchCurrentOffset =
              typeof message.selectionOffset === 'number'
                ? message.selectionOffset
                : -1
            navigateSearch(searchReverse ? 'backward' : 'forward')
          } else {
            nextMatchOffset = applySingleReplaceToSearchMatches(
              message.replacedOffset,
              message.offsetDelta ?? 0
            )
          }
        } else if (message.scope === 'all') {
          clearSearchResults(strings.search.replaceSummary(replacedCount))
        }

        if (
          nextMatchOffset < 0 &&
          typeof message.selectionOffset === 'number' &&
          message.selectionOffset >= 0
        ) {
          selectOffset(message.selectionOffset)
        }
        break
      }
      case 'transformComplete':
        transformInFlight = false
        transformCancelable = false
        if (message.contentChanged) {
          clearSearchResults()
        }
        const shouldSelectRange = shouldSelectTransformResultRange(message)
        if (shouldSelectRange && message.offset >= 0) {
          const transformedLength = message.contentChanged
            ? message.replacementLength || message.length || 1
            : message.length || 1
          selectRange(message.offset, transformedLength)
        }
        transformFeedback = describeTransformComplete(message)
        rememberTransformResult(createTransformResult(message))
        if (shouldSelectRange || message.contentChanged) {
          pendingAnalysisProfileKey = ''
          requestAnalysisProfile(true)
        }
        break
      case 'fileActionComplete':
        transformInFlight = false
        transformCancelable = false
        transformFeedback = message.cancelled
          ? ''
          : describeFileActionComplete(message)
        if (!message.cancelled) {
          if (message.action === 'insertFile' && message.byteCount > 0) {
            clearSearchResults()
            selectRange(message.offset, message.byteCount)
            pendingAnalysisProfileKey = ''
            requestAnalysisProfile(true)
          } else if (message.action === 'replaceRangeWithFile') {
            clearSearchResults()
            if (message.byteCount > 0) {
              selectRange(message.offset, message.byteCount)
            } else {
              selectOffset(message.offset)
            }
            pendingAnalysisProfileKey = ''
            requestAnalysisProfile(true)
          }
        }
        break
      case 'sessionActionComplete':
        transformInFlight = false
        transformCancelable = false
        transformFeedback = ''
        if (
          !message.cancelled &&
          (message.action === 'rollbackCheckpoint' ||
            message.action === 'restoreCheckpoint' ||
            message.action === 'applyChangeLog')
        ) {
          clearSearchResults()
          pendingAnalysisProfileKey = ''
          requestAnalysisProfile(true)
        }
        break
      case 'checkpointTimeline':
        if (message.visible && searchPanelVisible) {
          closeSearchPanel()
        }
        if (message.visible && actionJournalVisible) {
          actionJournalVisible = false
          postToHost({ type: 'hideActionJournal' })
        }
        checkpointTimeline = message
        break
      case 'actionJournalViewport': {
        if (message.visible && searchPanelVisible) {
          closeSearchPanel()
        }
        actionJournalVisible = message.visible
        actionJournalLoading = false
        actionJournalError = ''
        if (message.append && actionJournalViewport) {
          const seen = new Set(
            actionJournalViewport.entries.map(
              (entry) => `${entry.firstSerial}:${entry.lastSerial}`
            )
          )
          actionJournalViewport = {
            ...message.viewport,
            entries: [
              ...actionJournalViewport.entries,
              ...message.viewport.entries.filter(
                (entry) => !seen.has(`${entry.firstSerial}:${entry.lastSerial}`)
              ),
            ],
          }
        } else {
          actionJournalViewport = message.viewport
        }
        break
      }
      case 'actionJournalError':
        actionJournalVisible = message.visible
        actionJournalLoading = false
        actionJournalError = message.message
        break
      case 'actionJournalHidden':
        actionJournalVisible = false
        actionJournalLoading = false
        actionJournalError = ''
        actionJournalViewport = undefined
        break
      case 'analysisProfile':
        latestDataProfile = message
        break
      case 'externalHighlights':
        externalHighlights = message.highlights
        if (viewportSnapshot) {
          viewportSnapshot = {
            ...viewportSnapshot,
            externalHighlights: message.highlights,
          }
          savePreviewState()
        }
        break
      case 'rangeMapTree':
        rangeMapTree = message.tree
        if (viewportSnapshot) {
          viewportSnapshot = {
            ...viewportSnapshot,
            rangeMapTree: message.tree,
          }
          savePreviewState()
        }
        break
      case 'bytesPerRow':
        bytesPerRowMode = 'fixed'
        bytesPerRow = normalizeBytesPerRow(message.bytesPerRow)
        savePreviewState({ bytesPerRow, bytesPerRowMode })
        break
      case 'textEncoding':
        setTextEncoding(message.textEncoding)
        break
      case 'editMode':
        setInspectorEditMode(message.editMode)
        break
      case 'insertDirection':
        insertDirection = message.insertDirection
        savePreviewState({ insertDirection })
        break
      case 'cutComplete':
        break
    }
  }

  function dismissTransformResult(): void {
    transformResult = undefined
  }

  $effect(() => {
    requestAnalysisProfile()
  })

  $effect(() => {
    postEditorStateChanged()
  })

  onMount(() => {
    const messageListener = (event: MessageEvent<HostToWebviewMessage>) => {
      handleHostMessage(event.data)
    }
    const keyListener = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return
      }
      if (event.key === 'Insert') {
        if (transformInFlight || isEditableTarget(event.target)) {
          return
        }
        event.preventDefault()
        toggleInspectorEditMode()
        return
      }
      if (event.key !== 'Insert') {
        const modifier = event.ctrlKey || event.metaKey
        const key = event.key.toLowerCase()
        if (event.key === 'F3' && !isEditableTarget(event.target)) {
          event.preventDefault()
          if (searchCanNavigate) {
            navigateSearch(event.shiftKey ? 'backward' : 'forward')
          }
          return
        }
        if (modifier && key === 'f') {
          event.preventDefault()
          openSearchPanel()
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLInputElement>('#searchQueryInput')
              ?.focus()
          )
          return
        }
        if (modifier && key === 'h') {
          event.preventDefault()
          openSearchPanel(true)
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLInputElement>('#searchReplacementInput')
              ?.focus()
          )
          return
        }
        if (modifier && (key === 'g' || key === 'l')) {
          event.preventDefault()
          document.querySelector<HTMLInputElement>('#offsetJumpInput')?.focus()
        }
      }
    }
    const copyListener = (event: ClipboardEvent) => {
      handleClipboardCopy(event, 'copy')
    }
    const cutListener = (event: ClipboardEvent) => {
      handleClipboardCopy(event, 'cut')
    }
    const pasteListener = (event: ClipboardEvent) => {
      handleClipboardPaste(event)
    }
    window.addEventListener('message', messageListener)
    window.addEventListener('keydown', keyListener)
    document.addEventListener('copy', copyListener)
    document.addEventListener('cut', cutListener)
    document.addEventListener('paste', pasteListener)
    postToHost({ type: 'setViewportMetrics', visibleRows })
    requestTransformPlugins()
    return () => {
      if (analysisProfileRequestTimer) {
        clearTimeout(analysisProfileRequestTimer)
      }
      window.removeEventListener('message', messageListener)
      window.removeEventListener('keydown', keyListener)
      document.removeEventListener('copy', copyListener)
      document.removeEventListener('cut', cutListener)
      document.removeEventListener('paste', pasteListener)
    }
  })
</script>

<main class="app-shell">
  <Toolbar
    {bytesPerRow}
    {offsetRadix}
    {textEncoding}
    {insertDirection}
    {fileSize}
    {contentSources}
    {transformPlugins}
    {transformPluginsLoaded}
    {transformPluginsLoading}
    {transformInFlight}
    {transformCancelable}
    {transformPluginError}
    {transformFeedback}
    transformResults={displayTransformResultHistory}
    activeTransformResultId={displayTransformResult?.id}
    {searchPanelVisible}
    {actionJournalVisible}
    {selectedOffset}
    {selectionStart}
    {selectionEnd}
    {selectionLength}
    onBytesPerRow={setBytesPerRow}
    onOffsetRadix={setOffsetRadix}
    onTextEncoding={setTextEncoding}
    onInsertDirection={setInsertDirection}
    onGoToOffset={goToOffset}
    onRequestTransforms={requestTransformPlugins}
    onCancelTransform={cancelTransform}
    onApplyTransform={applyTransform}
    onExportRange={exportRange}
    onInsertFile={insertFile}
    onReplaceRangeWithFile={replaceRangeWithFile}
    onOpenTransformResult={openTransformResult}
    onToggleSearchPanel={toggleSearchPanelVisible}
    onToggleActionJournal={toggleActionJournal}
    onCreateCheckpoint={createCheckpoint}
    onRollbackCheckpoint={rollbackCheckpoint}
    onRestoreCheckpoint={restoreCheckpoint}
    onExportChangeLog={exportChangeLog}
    onApplyChangeLog={applyChangeLog}
  />

  <div class="top-panels">
    {#if checkpointTimeline.visible}
      <CheckpointTimeline
        cursor={checkpointTimeline.cursor}
        checkpointCount={checkpointTimeline.checkpointCount}
        originalByteLength={checkpointTimeline.originalByteLength}
        savedChangeCount={checkpointTimeline.savedChangeCount}
        savedCheckpoint={checkpointTimeline.savedCheckpoint}
        savedOffBranch={checkpointTimeline.savedOffBranch}
        canRewind={checkpointTimeline.canRewind}
        canFastForward={checkpointTimeline.canFastForward}
        checkpoints={checkpointTimeline.checkpoints}
        navigating={checkpointTimeline.navigating}
        onNavigate={(checkpoint) =>
          postToHost({ type: 'navigateCheckpointTimeline', checkpoint })}
        onClose={() => postToHost({ type: 'hideCheckpointTimeline' })}
      />
    {/if}

    {#if searchPanelVisible && !checkpointTimeline.visible}
      <SearchPanel
        query={searchQuery}
        replacement={replacementQuery}
        isHex={searchHex}
        caseSensitive={!searchCaseInsensitive}
        invalid={searchInputInvalid}
        replacementInvalid={replacementInputInvalid}
        canNavigate={searchCanNavigate}
        canReplace={searchCanReplace}
        replaceVisible={replaceVisible}
        summary={searchResultSummary}
        replaceSummary={replaceMessage}
        onQueryChange={setSearchQuery}
        onReplacementChange={setReplacementQuery}
        onHexChange={setSearchHex}
        onCaseSensitiveChange={setSearchCaseSensitive}
        onToggleReplace={toggleReplaceVisible}
        onClose={closeSearchPanel}
        onNavigate={navigateSearch}
        onReplace={replaceCurrentMatch}
        onReplaceAll={replaceAllMatches}
      />
    {/if}

    {#if displayTransformResult}
      <TransformResultPanel
        title={displayTransformResult.title}
        summary={displayTransformResult.summary}
        label={displayTransformResult.label}
        value={displayTransformResult.value}
        mimeType={displayTransformResult.mimeType}
        contentSourceLabel={displayTransformResult.contentSourceLabel}
        rangeStart={displayTransformResult.rangeStart}
        rangeEnd={displayTransformResult.rangeEnd}
        length={displayTransformResult.length}
        onDismiss={dismissTransformResult}
      />
    {/if}
  </div>

  <div class="editor-content-shell">
    <div class="editor-workspace-shell">
      <EditorWorkspace
    {data}
    {visibleOffset}
    scrollOffset={navigationOffset}
    {bytesPerRow}
    autoFitBytesPerRow={false}
    maxBytesPerRow={MAX_BYTES_PER_ROW}
    {offsetRadix}
    {textEncoding}
    {selectedOffset}
    {selectionStart}
    {selectionEnd}
    searchStart={searchHighlightStart}
    searchEnd={searchHighlightEnd}
    searchMatches={allSearchMatches}
    searchLength={searchPatternLength}
    searchCurrentOffset={currentSearchOffset}
    inspectorStart={inspectorHighlightStart}
    inspectorEnd={inspectorHighlightEnd}
    {externalHighlights}
    {rangeMapTree}
    preparing={preparingFile}
    {activePane}
    editMode={inspectorEditMode}
    {pendingHexLabel}
    {canScrollUp}
    {canScrollDown}
    profilerExpanded={profilerExpanded}
    profilerMode={profilerMode}
    {analysisSectionOrder}
    {fileSize}
    visibleByteCount={visibleByteCount()}
    viewportLength={viewportData.length}
    {visibleRows}
    visibleBytes={data}
    selectedBytes={profilerSelectedBytes}
    {selectionLength}
    dataProfile={latestDataProfile}
    viewportProfile={latestViewportProfile}
    {serverHealth}
    {canUndo}
    {canRedo}
    {undoCount}
    {redoCount}
    onSelect={selectOffset}
    onSelectRangeMapNode={(node) => selectRange(node.offset, node.length)}
    onLoadRangeMap={loadRangeMap}
    onUnloadRangeMap={unloadRangeMap}
    onActivePaneChange={setActivePane}
    onMoveSelection={moveSelection}
    onJumpToBoundary={jumpToBoundary}
    onScrollTo={requestVisibleOffset}
    onScroll={scrollPreview}
    onToggleEditMode={toggleInspectorEditMode}
    onTypeByte={handleGridType}
    onDeleteByte={deleteFromKeyboard}
    editDisabled={transformInFlight}
    readOnlyLabel={strings.grid.readOnly}
    readOnlyTitle={transformFeedback || strings.transform.inFlight}
    navigating={checkpointTimeline.navigating}
    onVisibleRowsChange={setVisibleRows}
    onAutoFitBytesPerRow={applyAutoFitBytesPerRow}
    onToggleProfilerExpanded={toggleProfilerExpanded}
    onProfilerModeChange={setProfilerMode}
    onMoveAnalysisSection={moveAnalysisSectionByDelta}
    onReorderAnalysisSection={reorderAnalysisSection}
      />
    </div>

    {#if actionJournalVisible}
      <ActionJournal
        viewport={actionJournalViewport}
        selectedKinds={actionJournalKinds}
        transactionId={actionJournalTransactionId}
        loading={actionJournalLoading}
        error={actionJournalError}
        onFilter={(kinds, transactionId) =>
          requestActionJournal(kinds, transactionId)}
        onLoadOlder={(anchorSerial) =>
          requestActionJournal(
            actionJournalKinds,
            actionJournalTransactionId,
            anchorSerial,
            true
          )}
        onReveal={(offset) =>
          postToHost({ type: 'revealActionJournalEntry', offset })}
        onCopy={(firstSerial, lastSerial, format) =>
          postToHost({
            type: 'copyActionJournalEntry',
            firstSerial,
            lastSerial,
            format,
          })}
        onClose={toggleActionJournal}
        onRetry={() => requestActionJournal()}
      />
    {/if}
  </div>

  <ByteInspector
    {selectedOffset}
    bytes={inspectorBytes}
    {offsetRadix}
    {textEncoding}
    {selectionStart}
    {selectionEnd}
    {clipboardMessage}
    littleEndian={inspectorLittleEndian}
    expanded={inspectorExpanded}
    disabled={transformInFlight}
    onToggleExpanded={toggleInspectorExpanded}
    onInspectRange={inspectRange}
    onToggleEndian={toggleInspectorEndian}
    onCommitValue={commitInspectorValue}
  />
</main>
