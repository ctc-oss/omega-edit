<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import ByteInspector from './components/ByteInspector.svelte'
  import EditorWorkspace from './components/EditorWorkspace.svelte'
  import SearchPanel from './components/SearchPanel.svelte'
  import Toolbar from './components/Toolbar.svelte'
  import TransformResultPanel from './components/TransformResultPanel.svelte'
  import { strings } from './i18n'
  import {
    MAX_ANALYSIS_PROFILE_BYTES,
    normalizeBytesPerRow,
    type BytesPerRow,
    type HostToWebviewMessage,
    type InsertDirection,
    type ServerHealthMessage,
    type WebviewEditorUiState,
    type WebviewExternalHighlight,
    type WebviewTransformPlugin,
  } from './protocol'
  import { getPreviewState, postToHost, setPreviewState } from './vscodeApi'

  const DEFAULT_VISIBLE_ROWS = 16
  const INTERNAL_HEX_CLIPBOARD_FORMAT = 'application/x-omega-edit-hex'
  const TRANSFORM_RESULT_HISTORY_LIMIT = 8

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
    value: string
    mimeType: string
    rangeStart: string
    rangeEnd: string
    length: string
    createdAtLabel: string
    historyLabel: string
  }

  const DEFAULT_ANALYSIS_SECTION_ORDER: AnalysisSectionOrder = {
    profile: ['viewport', 'classes', 'data', 'frequency'],
    structure: ['visible', 'history', 'timing', 'server'],
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
  }

  let { initialBytesPerRow = 16 }: Props = $props()

  const restoredState = getPreviewState()

  let bytesPerRow = $state<BytesPerRow>(
    normalizeBytesPerRow(
      restoredState?.bytesPerRow ?? untrack(() => initialBytesPerRow)
    )
  )
  let fileSize = $state(0)
  let visibleOffset = $state(0)
  let viewportOffset = $state(0)
  let viewportData = $state<number[]>([])
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
  let profilerExpanded = $state(restoredState?.profilerExpanded ?? true)
  let profilerMode = $state<AnalysisMode>('profile')
  let analysisSectionOrder = $state<AnalysisSectionOrder>(
    normalizeAnalysisSectionOrder(restoredState?.analysisSectionOrder)
  )
  let offsetRadix = $state<'hex' | 'dec'>(
    normalizeOffsetRadix(restoredState?.offsetRadix)
  )
  let transformPlugins = $state<WebviewTransformPlugin[]>([])
  let transformPluginsLoaded = $state(false)
  let transformPluginsLoading = $state(false)
  let transformPluginError = $state('')
  let transformFeedback = $state('')
  let transformResult = $state<TransformResultState | undefined>(undefined)
  let transformResultHistory = $state<TransformResultState[]>([])
  let transformResultSequence = $state(0)
  let externalHighlights = $state<WebviewExternalHighlight[]>([])
  let canUndo = $state(false)
  let canRedo = $state(false)
  let undoCount = $state(0)
  let redoCount = $state(0)
  let latestDataProfile = $state<AnalysisProfileMessage | undefined>(undefined)
  let latestViewportProfile = $state<ProfilerViewportSnapshot | undefined>(
    undefined
  )
  let serverHealth = $state<ServerHealthMessage | undefined>(undefined)
  let renderSamples = $state<number[]>([])
  let pendingAnalysisProfileKey = $state('')
  let selectionAnchor = $state(-1)
  let selectedOffset = $state(-1)
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
  let replaceMessage = $state('')
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
    !replacementInputInvalid
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

  function setBytesPerRow(bytes: BytesPerRow): void {
    bytesPerRow = bytes
    savePreviewState({ bytesPerRow: bytes })
    postToHost({ type: 'setBytesPerRow', bytesPerRow: bytes })
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
      offsetRadix: 'hex' | 'dec'
      insertDirection: InsertDirection
      profilerExpanded: boolean
      analysisSectionOrder: AnalysisSectionOrder
    }> = {}
  ): void {
    setPreviewState({
      bytesPerRow,
      offsetRadix,
      insertDirection,
      profilerExpanded,
      analysisSectionOrder,
      ...overrides,
    })
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

  function selectOffset(offset: number, extend = false): void {
    const nextOffset = clampOffset(offset)
    if (nextOffset < 0) {
      selectionAnchor = -1
      selectedOffset = -1
      clipboardMessage = ''
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
      return
    }

    const end = clampOffset(start + Math.max(1, length) - 1)
    selectionAnchor = Math.max(start, end)
    selectedOffset = start
    clipboardMessage = ''
    pendingHexNibble = undefined
    pendingHexLabel = ''
    clearInspectorHighlight()

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

  function postDeleteRange(offset: number, length: number): void {
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

  function bytesToPrintableAscii(bytes: number[]): string | undefined {
    if (bytes.some((byte) => byte < 0x20 || byte > 0x7e)) {
      return undefined
    }
    return String.fromCharCode(...bytes)
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
      const text = bytesToPrintableAscii(bytes)
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

    const bytes = getVisibleRangeBytes(range.offset, range.length)
    if (event.clipboardData && bytes && writeClipboardBytes(event.clipboardData, bytes)) {
      event.preventDefault()
      clipboardMessage =
        action === 'cut'
          ? strings.inspector.cutSelection(range.length)
          : strings.inspector.copiedSelection(range.length, activeClipboardFormat())
      if (action === 'cut') {
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

  function printableAsciiToHex(value: string): string | undefined {
    if (value.length === 0) {
      return undefined
    }
    const bytes = Array.from(value, (char) => char.charCodeAt(0))
    if (bytes.some((byte) => byte < 0x20 || byte > 0x7e)) {
      return undefined
    }
    return bytes.map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join('')
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
        bytesToPrintableAscii(compactHexToBytes(internalHex)) !== undefined
        ? internalHex
        : undefined
    }

    const text =
      clipboardData.getData('text/plain') || clipboardData.getData('text')
    if (activePane === 'hex') {
      return normalizeClipboardHex(text)
    }
    return printableAsciiToHex(text)
  }

  function pasteClipboardHex(data: string): void {
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
          : strings.inspector.invalidAsciiPaste
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
    if (offset < 0 || byte < 0 || byte > 0xff) {
      return
    }

    const data = byte.toString(16).toUpperCase().padStart(2, '0')
    if (inspectorEditMode === 'overwrite' && offset < fileSize) {
      postToHost({ type: 'overwrite', offset, data })
      clipboardMessage = strings.inspector.overwroteByte
    } else if (inspectorEditMode === 'overwrite') {
      clipboardMessage = strings.inspector.cannotOverwrite
      return
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
    if (inspectorEditMode === 'overwrite') {
      selectionAnchor = offset
      selectedOffset = offset
    }
  }

  function handleGridType(pane: GridEditPane, key: string): boolean {
    const offset = selectedEditOffset()
    if (offset < 0 || offset > fileSize) {
      return false
    }

    if (pane === 'ascii') {
      if (key.length !== 1) {
        return false
      }

      const byte = key.charCodeAt(0)
      if (byte < 0x20 || byte > 0x7e) {
        clipboardMessage = strings.inspector.invalidAsciiByte
        return true
      }

      commitByteEdit(offset, byte)
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

  function setOffsetRadix(radix: 'hex' | 'dec'): void {
    offsetRadix = radix
    savePreviewState({ offsetRadix: radix })
  }

  function formatSearchOffset(offset: number): string {
    return offsetRadix === 'dec'
      ? offset.toLocaleString()
      : `0x${offset.toString(16).toUpperCase()}`
  }

  function requestTransformPlugins(): void {
    if (transformPluginsLoading) {
      return
    }
    transformPluginsLoading = true
    postToHost({ type: 'requestTransformPlugins' })
  }

  function applyTransform(
    pluginId: string,
    offset: number,
    length: number,
    optionsJson?: string
  ): void {
    if (
      fileSize <= 0 ||
      offset < 0 ||
      length <= 0 ||
      offset + length > fileSize
    ) {
      transformFeedback = strings.transform.selectRangeFirst
      return
    }

    const plugin = transformPlugins.find((entry) => entry.id === pluginId)
    transformFeedback = strings.transform.applying(plugin?.name || pluginId)
    transformResult = undefined
    postToHost({
      type: 'applyTransform',
      pluginId,
      offset,
      length,
      optionsJson,
    })
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
    return strings.transform.completed
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

    const displayLength = message.contentChanged
      ? message.replacementLength || message.length || 1
      : message.length || 1
    const rangeEnd = Math.min(
      Math.max(0, fileSize - 1),
      message.offset + displayLength - 1
    )
    const timestamp = Date.now()
    const title = transformPluginTitle(message.pluginId)
    const label = message.resultLabel || strings.transform.resultDefault
    const rangeStart = formatSearchOffset(message.offset)
    const rangeEndLabel = formatSearchOffset(rangeEnd)
    const createdAtLabel = formatTransformResultTime(timestamp)
    transformResultSequence += 1

    return {
      id: `${timestamp}-${transformResultSequence}-${message.pluginId}-${message.offset}-${displayLength}`,
      title,
      summary: describeTransformComplete(message),
      label,
      value: message.resultText,
      mimeType: message.resultMimeType,
      rangeStart,
      rangeEnd: rangeEndLabel,
      length: strings.transform.bytes(displayLength),
      createdAtLabel,
      historyLabel: strings.transform.resultHistoryItem(
        label,
        rangeStart,
        rangeEndLabel,
        createdAtLabel
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

  function utf8ToHex(value: string): string {
    return Array.from(new TextEncoder().encode(value), (byte) =>
      byte.toString(16).toUpperCase().padStart(2, '0')
    ).join('')
  }

  function normalizeSearchQuery(query: string, isHex: boolean): string | undefined {
    const trimmed = query.trim()
    if (trimmed.length === 0) {
      return undefined
    }
    if (!isHex) {
      return trimmed
    }

    return normalizeHexInput(trimmed, false)
  }

  function normalizeReplacementHex(
    replacement: string,
    isHex: boolean
  ): string | undefined {
    return isHex ? normalizeHexInput(replacement, true) : utf8ToHex(replacement)
  }

  function getSearchPatternByteLength(query: string, isHex: boolean): number {
    return isHex ? query.length / 2 : new TextEncoder().encode(query).length
  }

  function clearSearchResults(message = strings.search.noSearch): void {
    pendingSearchReveal = undefined
    searchMode = 'none'
    searchMatches = []
    searchMatchIndex = -1
    searchCurrentOffset = -1
    searchPatternLength = 0
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
  }

  function setSearchHex(enabled: boolean): void {
    searchHex = enabled
    if (enabled) {
      searchCaseInsensitive = false
    }
    replaceMessage = ''
    clearSearchResults()
  }

  function setSearchCaseInsensitive(enabled: boolean): void {
    searchCaseInsensitive = enabled
    replaceMessage = ''
    clearSearchResults(
      searchQuery.trim().length > 0
        ? strings.search.ready
        : strings.search.noSearch
    )
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
    searchPatternLength = getSearchPatternByteLength(normalized, searchHex)
    searchMessage = strings.search.searching
    replaceMessage = ''
    postToHost({
      type: 'search',
      query: normalized,
      isHex: searchHex,
      caseInsensitive: !searchHex && searchCaseInsensitive,
      isReverse,
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
        isHex: searchHex,
        caseInsensitive: !searchHex && searchCaseInsensitive,
        direction,
        offset: Math.max(0, getCurrentSearchOffset()),
      })
      return
    }

    const nextIndex =
      direction === 'forward'
        ? (searchMatchIndex + 1) % searchMatches.length
        : (searchMatchIndex - 1 + searchMatches.length) % searchMatches.length
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
    postToHost({
      type: 'replaceAllMatches',
      query: normalizedQuery,
      isHex: searchHex,
      caseInsensitive: !searchHex && searchCaseInsensitive,
      isReverse: searchReverse,
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
      case 'viewportData':
        {
          const requestedOffset = pendingVisibleOffset

        updateProfilerViewportSnapshot(message)
        fileSize = message.fileSize
        viewportOffset = message.offset
        viewportData = message.data
        externalHighlights = message.externalHighlights

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
          applyPendingSearchReveal()
        break
        }
      case 'fileSizeChanged':
        fileSize = message.fileSize
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
      case 'searchNavigationCommand':
        navigateSearch(message.direction)
        break
      case 'replaceComplete': {
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
        if (message.contentChanged) {
          clearSearchResults()
        }
        if (message.offset >= 0) {
          const transformedLength = message.contentChanged
            ? message.replacementLength || message.length || 1
            : message.length || 1
          selectRange(message.offset, transformedLength)
        }
        transformFeedback = describeTransformComplete(message)
        rememberTransformResult(createTransformResult(message))
        pendingAnalysisProfileKey = ''
        requestAnalysisProfile(true)
        break
      case 'analysisProfile':
        latestDataProfile = message
        break
      case 'externalHighlights':
        externalHighlights = message.highlights
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
      if (
        event.defaultPrevented ||
        event.key !== 'Insert' ||
        isEditableTarget(event.target)
      ) {
        return
      }
      event.preventDefault()
      toggleInspectorEditMode()
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
    {insertDirection}
    {fileSize}
    {transformPlugins}
    {transformPluginsLoaded}
    {transformPluginsLoading}
    {transformPluginError}
    {transformFeedback}
    transformResults={transformResultHistory}
    activeTransformResultId={transformResult?.id}
    {selectionStart}
    {selectionEnd}
    {selectionLength}
    onBytesPerRow={setBytesPerRow}
    onOffsetRadix={setOffsetRadix}
    onInsertDirection={setInsertDirection}
    onGoToOffset={goToOffset}
    onRequestTransforms={requestTransformPlugins}
    onApplyTransform={applyTransform}
    onOpenTransformResult={openTransformResult}
  />

  <div class="top-panels">
    <SearchPanel
      query={searchQuery}
      replacement={replacementQuery}
      isHex={searchHex}
      caseInsensitive={searchCaseInsensitive}
      isReverse={searchReverse}
      invalid={searchInputInvalid}
      replacementInvalid={replacementInputInvalid}
      canNavigate={searchCanNavigate}
      canReplace={searchCanReplace}
      summary={searchResultSummary}
      replaceSummary={replaceMessage}
      onQueryChange={setSearchQuery}
      onReplacementChange={setReplacementQuery}
      onHexChange={setSearchHex}
      onCaseInsensitiveChange={setSearchCaseInsensitive}
      onReverseChange={(enabled) => (searchReverse = enabled)}
      onSearch={runSearch}
      onNavigate={navigateSearch}
      onReplace={replaceCurrentMatch}
      onReplaceAll={replaceAllMatches}
    />

    {#if transformResult}
      <TransformResultPanel
        title={transformResult.title}
        summary={transformResult.summary}
        label={transformResult.label}
        value={transformResult.value}
        mimeType={transformResult.mimeType}
        rangeStart={transformResult.rangeStart}
        rangeEnd={transformResult.rangeEnd}
        length={transformResult.length}
        onDismiss={dismissTransformResult}
      />
    {/if}
  </div>

  <EditorWorkspace
    {data}
    {visibleOffset}
    scrollOffset={navigationOffset}
    {bytesPerRow}
    {offsetRadix}
    {selectedOffset}
    {selectionStart}
    {selectionEnd}
    searchStart={searchHighlightStart}
    searchEnd={searchHighlightEnd}
    inspectorStart={inspectorHighlightStart}
    inspectorEnd={inspectorHighlightEnd}
    {externalHighlights}
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
    onActivePaneChange={setActivePane}
    onMoveSelection={moveSelection}
    onJumpToBoundary={jumpToBoundary}
    onScrollTo={requestVisibleOffset}
    onScroll={scrollPreview}
    onToggleEditMode={toggleInspectorEditMode}
    onTypeByte={handleGridType}
    onDeleteByte={deleteFromKeyboard}
    onVisibleRowsChange={setVisibleRows}
    onToggleProfilerExpanded={toggleProfilerExpanded}
    onProfilerModeChange={setProfilerMode}
    onMoveAnalysisSection={moveAnalysisSectionByDelta}
    onReorderAnalysisSection={reorderAnalysisSection}
  />

  <ByteInspector
    {selectedOffset}
    bytes={inspectorBytes}
    {offsetRadix}
    {selectionStart}
    {selectionEnd}
    {clipboardMessage}
    littleEndian={inspectorLittleEndian}
    expanded={inspectorExpanded}
    onToggleExpanded={toggleInspectorExpanded}
    onInspectRange={inspectRange}
    onToggleEndian={toggleInspectorEndian}
    onCommitValue={commitInspectorValue}
  />
</main>
