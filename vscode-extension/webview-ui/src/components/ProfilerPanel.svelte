<script lang="ts">
  import { formatNumber, strings } from '../i18n'
  import type {
    HostToWebviewMessage,
    ServerHealthMessage,
    ServerHealthMetricId,
    WebviewRangeMapNode,
  } from '../protocol'

  type AnalysisProfileMessage = Extract<
    HostToWebviewMessage,
    { type: 'analysisProfile' }
  >
  type AnalysisMode = 'profile' | 'structure'
  type AnalysisSectionOrder = Record<AnalysisMode, string[]>

  const DEFAULT_ANALYSIS_SECTION_ORDER: AnalysisSectionOrder = {
    profile: ['viewport', 'classes', 'data', 'frequency'],
    structure: ['rangeMap', 'visible', 'history', 'timing', 'server'],
  }
  // Must match the number of data-external-color selectors (0..N-1) defined in styles.css
  const EXTERNAL_HIGHLIGHT_COLOR_COUNT = 12

  interface ViewportProfilerSnapshot {
    fetchDurationMs: number
    hostToWebviewMs: number
    renderDurationMs: number
    averageRenderMs: number | null
    sentAt: number
    messageAt: number
    renderAt: number
    payloadBytes: number
    capacity: number
    visibleRows: number
    changeCount: number
    sessionSyncVersion: number
    followingByteCount: number
  }

  interface MetricRow {
    label: string
    value: string
    kind?: 'heading'
    severity?: ServerHealthMessage['severity'] | 'pending'
  }

  interface RangeMapTreeRow {
    node: WebviewRangeMapNode
    depth: number
  }

  const SERVER_LIVE_STATUS_METRIC_IDS: readonly ServerHealthMetricId[] = [
    'latency',
  ]
  const SERVER_CURRENT_INSTANCE_METRIC_IDS: readonly ServerHealthMetricId[] = [
    'pid',
    'sessions',
    'uptime',
    'loadAverage',
    'residentMemory',
    'virtualMemory',
    'peakResidentMemory',
  ]
  const SERVER_HOST_BUILD_METRIC_IDS: readonly ServerHealthMetricId[] = [
    'host',
    'platform',
    'logicalCpus',
    'runtime',
    'version',
    'client',
    'compiler',
    'build',
    'cppStandard',
  ]

  interface BarRow {
    label: string
    percent: number
    value: string
    colorClass?: string
  }

  interface ByteAnalysis {
    count: number
    unique: number
    entropy: number
    frequencySpread: number
    modeByte: { byte: number; count: number } | null
    classes: Record<ByteClass, number>
    longestRunByte: number | null
    longestRunLength: number
  }

  type ByteClass = 'Printable' | 'Control' | 'High-bit' | 'Null' | 'FF'

  interface Props {
    expanded?: boolean
    mode?: AnalysisMode
    sectionOrder?: AnalysisSectionOrder
    fileSize?: number
    visibleOffset?: number
    visibleByteCount?: number
    viewportLength?: number
    visibleRows?: number
    offsetRadix?: 'hex' | 'dec'
    visibleBytes?: number[]
    selectedBytes?: number[]
    selectionLength?: number
    selectionStart?: number
    selectionEnd?: number
    rangeMapTree?: WebviewRangeMapNode[]
    hoveredExternalHighlightId?: string
    dataProfile?: AnalysisProfileMessage
    viewportProfile?: ViewportProfilerSnapshot
    serverHealth?: ServerHealthMessage
    canUndo?: boolean
    canRedo?: boolean
    undoCount?: number
    redoCount?: number
    onToggleExpanded: () => void
    onModeChange: (mode: AnalysisMode) => void
    onSelectRangeMapNode: (node: WebviewRangeMapNode) => void
    onRangeMapNodeHover: (id: string | undefined) => void
    onLoadRangeMap: () => void
    onUnloadRangeMap: () => void
    onMoveSection: (
      mode: AnalysisMode,
      sectionId: string,
      delta: number
    ) => void
    onReorderSection: (
      mode: AnalysisMode,
      sectionId: string,
      targetId: string,
      placeAfter: boolean
    ) => void
  }

  let {
    expanded = true,
    mode = 'profile',
    sectionOrder = DEFAULT_ANALYSIS_SECTION_ORDER,
    fileSize = 0,
    visibleOffset = 0,
    visibleByteCount = 0,
    viewportLength = 0,
    visibleRows = 0,
    offsetRadix = 'hex',
    visibleBytes = [],
    selectedBytes = [],
    selectionLength = 0,
    selectionStart = -1,
    selectionEnd = -1,
    rangeMapTree = [],
    hoveredExternalHighlightId,
    dataProfile,
    viewportProfile,
    serverHealth,
    canUndo = false,
    canRedo = false,
    undoCount = 0,
    redoCount = 0,
    onToggleExpanded,
    onModeChange,
    onSelectRangeMapNode,
    onRangeMapNodeHover,
    onLoadRangeMap,
    onUnloadRangeMap,
    onMoveSection,
    onReorderSection,
  }: Props = $props()

  let frequencyScale = $state<'linear' | 'log'>('linear')
  let hoveredFrequencyByte = $state<number | undefined>(undefined)
  let tooltipHorizontal = $state<'left' | 'center' | 'right'>('right')
  let tooltipVertical = $state<'top' | 'bottom'>('bottom')
  let draggingSection = $state<
    | {
        mode: AnalysisMode
        sectionId: string
        pointerId: number
      }
    | undefined
  >(undefined)
  let collapsedSections = $state<Record<string, boolean>>({})
  let collapsedRangeMapNodes = $state<Record<string, boolean>>({})

  const analysisBytes = $derived(
    selectedBytes.length > 1 ? selectedBytes : visibleBytes
  )
  const profileSectionOrder = $derived(
    normalizeSectionOrder(
      sectionOrder.profile,
      DEFAULT_ANALYSIS_SECTION_ORDER.profile
    )
  )
  const structureSectionOrder = $derived(
    normalizeSectionOrder(
      sectionOrder.structure,
      DEFAULT_ANALYSIS_SECTION_ORDER.structure
    )
  )
  const structureScopeLabel = $derived(
    selectedBytes.length > 1
      ? strings.profiler.selection
      : strings.profiler.visibleBytes
  )
  const byteCounts = $derived(dataProfile?.byteProfile.slice(0, 256) ?? [])
  const byteTotal = $derived(
    byteCounts.reduce((sum, value) => sum + value, 0)
  )
  const topProfileBytes = $derived(topBytes(byteCounts, 5))
  const topProfileMaxCount = $derived(
    Math.max(1, ...topProfileBytes.map((entry) => entry.count))
  )
  const structureAnalysis = $derived(analyzeBytes(analysisBytes))
  const profileViewportRows = $derived(buildViewportRows())
  const profileTimingRows = $derived(buildTimingRows())
  const profileDataRows = $derived(buildDataRows())
  const profileClassRows = $derived(
    classRowsFromCounts(byteCounts, byteTotal)
  )
  const profileByteRows = $derived(
    topProfileBytes.map((entry) => ({
      label: formatByteLabel(entry.byte),
      percent: (entry.count / topProfileMaxCount) * 100,
      value: `${formatNumber(entry.count)} | ${formatPercent(
        byteTotal > 0 ? (entry.count / byteTotal) * 100 : 0
      )}`,
      colorClass: frequencyBarClass(entry.byte, entry.count).trim(),
    }))
  )
  const structureRows = $derived(buildStructureRows())
  const rangeMapRows = $derived(flattenRangeMapTree(rangeMapTree))
  const hasRangeMap = $derived(rangeMapTree.length > 0)
  const rangeMapHasExpandableNodes = $derived(
    rangeMapTreeHasExpandableNodes(rangeMapTree)
  )
  const rangeMapHasCollapsedNodes = $derived(
    rangeMapTreeHasCollapsedNodes(rangeMapTree)
  )
  const rangeMapAllExpandableNodesCollapsed = $derived(
    rangeMapHasExpandableNodes &&
      rangeMapTreeAllExpandableNodesCollapsed(rangeMapTree)
  )
  const historyRows = $derived([
    { label: strings.profiler.undo, value: formatNumber(undoCount) },
    { label: strings.profiler.redo, value: formatNumber(redoCount) },
    { label: strings.profiler.canUndo, value: yesNo(canUndo) },
    { label: strings.profiler.canRedo, value: yesNo(canRedo) },
  ])
  const serverRows = $derived(buildServerRows())
  const profileLimitNote = $derived(
    dataProfile?.isCapped
      ? strings.profiler.profileCapped(
          formatByteSize(dataProfile.length),
          formatByteSize(dataProfile.requestedLength)
        )
      : ''
  )
  const hoveredFrequency = $derived(
    hoveredFrequencyByte === undefined
      ? undefined
      : {
          byte: hoveredFrequencyByte,
          count: byteCounts[hoveredFrequencyByte] ?? 0,
          percent: formatPercent(
            byteTotal > 0
              ? ((byteCounts[hoveredFrequencyByte] ?? 0) / byteTotal) * 100
              : 0
          ),
        }
  )

  function normalizeSectionOrder(
    rawOrder: string[] | undefined,
    defaults: string[]
  ): string[] {
    const normalized: string[] = []
    const saved = Array.isArray(rawOrder) ? rawOrder : []

    for (const sectionId of saved) {
      if (defaults.includes(sectionId) && !normalized.includes(sectionId)) {
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

  function isDraggingSection(
    sectionMode: AnalysisMode,
    sectionId: string
  ): boolean {
    return (
      draggingSection?.mode === sectionMode &&
      draggingSection.sectionId === sectionId
    )
  }

  function sectionTitle(sectionId: string): string {
    switch (sectionId) {
      case 'viewport':
        return strings.profiler.viewport
      case 'classes':
        return strings.profiler.byteClasses
      case 'data':
        return strings.profiler.dataProfile
      case 'frequency':
        return strings.profiler.frequency
      case 'visible':
        return structureScopeLabel
      case 'rangeMap':
        return strings.profiler.rangeMap
      case 'history':
        return strings.profiler.history
      case 'timing':
        return strings.profiler.timing
      case 'server':
        return strings.profiler.server
      default:
        return sectionId
    }
  }

  function isSectionCollapsed(sectionId: string): boolean {
    return collapsedSections[sectionId] === true
  }

  function toggleSectionCollapsed(sectionId: string): void {
    collapsedSections = {
      ...collapsedSections,
      [sectionId]: !isSectionCollapsed(sectionId),
    }
  }

  function sectionCollapseLabel(sectionId: string): string {
    const title = sectionTitle(sectionId)
    return isSectionCollapsed(sectionId)
      ? strings.profiler.expandSection(title)
      : strings.profiler.collapseSection(title)
  }

  function sectionCollapseGlyph(sectionId: string): string {
    return isSectionCollapsed(sectionId) ? '+' : '-'
  }

  function handleDragPointerDown(
    event: PointerEvent,
    sectionMode: AnalysisMode,
    sectionId: string
  ): void {
    if (event.button !== 0) {
      return
    }

    const handle = event.currentTarget
    if (!(handle instanceof HTMLElement)) {
      return
    }

    event.preventDefault()
    draggingSection = {
      mode: sectionMode,
      sectionId,
      pointerId: event.pointerId,
    }
    handle.setPointerCapture(event.pointerId)
  }

  function scrollAnalysisPaneDuringDrag(event: PointerEvent): void {
    const handle = event.currentTarget
    if (!(handle instanceof HTMLElement)) {
      return
    }

    const body = handle.closest('.analysis-body')
    if (!(body instanceof HTMLElement)) {
      return
    }

    const rect = body.getBoundingClientRect()
    const edgeSize = 28
    if (event.clientY < rect.top + edgeSize) {
      body.scrollTop -= 14
    } else if (event.clientY > rect.bottom - edgeSize) {
      body.scrollTop += 14
    }
  }

  function handleDragPointerMove(event: PointerEvent): void {
    if (
      !draggingSection ||
      draggingSection.pointerId !== event.pointerId
    ) {
      return
    }

    event.preventDefault()
    scrollAnalysisPaneDuringDrag(event)

    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest('[data-analysis-section]')
    if (!(target instanceof HTMLElement)) {
      return
    }

    const targetMode = target
      .closest('[data-analysis-panel]')
      ?.getAttribute('data-analysis-panel')
    const targetId = target.dataset.analysisSection
    if (
      targetMode !== draggingSection.mode ||
      !targetId ||
      targetId === draggingSection.sectionId
    ) {
      return
    }

    const rect = target.getBoundingClientRect()
    onReorderSection(
      draggingSection.mode,
      draggingSection.sectionId,
      targetId,
      event.clientY > rect.top + rect.height / 2
    )
  }

  function stopAnalysisDrag(event: PointerEvent): void {
    const currentDrag = draggingSection
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) {
      return
    }

    const handle = event.currentTarget
    if (
      handle instanceof HTMLElement &&
      handle.hasPointerCapture(event.pointerId)
    ) {
      handle.releasePointerCapture(event.pointerId)
    }
    draggingSection = undefined
  }

  function clearAnalysisDrag(): void {
    draggingSection = undefined
  }

  function handleDragKeydown(
    event: KeyboardEvent,
    sectionMode: AnalysisMode,
    sectionId: string
  ): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return
    }

    event.preventDefault()
    onMoveSection(sectionMode, sectionId, event.key === 'ArrowUp' ? -1 : 1)
  }

  function yesNo(value: boolean): string {
    return value ? strings.profiler.yes : strings.profiler.no
  }

  function clamp(min: number, value: number, max: number): number {
    return Math.max(min, Math.min(value, max))
  }

  function formatDuration(value: number | null | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return '-'
    }
    if (value < 1) {
      return `${value.toFixed(2)} ms`
    }
    if (value < 100) {
      return `${value.toFixed(1)} ms`
    }
    return `${formatNumber(Math.round(value))} ms`
  }

  function formatByteSize(value: number): string {
    if (!Number.isFinite(value) || value <= 0) {
      return '0 B'
    }
    const units = ['B', 'KiB', 'MiB', 'GiB']
    let size = value
    let unit = 0
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024
      unit += 1
    }
    const decimals = unit === 0 || size >= 100 ? 0 : 1
    return `${size.toFixed(decimals)} ${units[unit]}`
  }

  function formatPercent(value: number): string {
    if (!Number.isFinite(value)) {
      return '0.0%'
    }
    return `${value.toFixed(value >= 10 ? 1 : 2)}%`
  }

  function formatOffset(offset: number): string {
    return offsetRadix === 'dec'
      ? formatNumber(offset)
      : `0x${offset.toString(16).toUpperCase()}`
  }

  function flattenRangeMapTree(
    nodes: WebviewRangeMapNode[],
    depth = 0
  ): RangeMapTreeRow[] {
    const rows: RangeMapTreeRow[] = []
    for (const node of nodes) {
      rows.push({ node, depth })
      if (!collapsedRangeMapNodes[node.id]) {
        rows.push(...flattenRangeMapTree(node.children, depth + 1))
      }
    }
    return rows
  }

  function rangeMapNodeLength(node: WebviewRangeMapNode): string {
    return formatByteSize(node.length)
  }

  function rangeMapDepthClass(depth: number): string {
    return `depth-${clamp(0, depth, 12)}`
  }

  function rangeMapNodeValue(node: WebviewRangeMapNode): string {
    const suffixes = [node.type, node.value].filter(
      (value): value is string => Boolean(value)
    )
    return suffixes.length > 0 ? suffixes.join(' | ') : ''
  }

  function hashRangeMapNodeId(id: string): number {
    let hash = 0
    for (let index = 0; index < id.length; index += 1) {
      hash = (hash * 31 + id.charCodeAt(index)) >>> 0
    }
    return hash
  }

  function rangeMapNodeColorSlot(node: WebviewRangeMapNode): string {
    return String(hashRangeMapNodeId(node.id) % EXTERNAL_HIGHLIGHT_COLOR_COUNT)
  }

  function rangeMapNodeTitle(node: WebviewRangeMapNode): string {
    return strings.profiler.rangeMapNodeTitle(
      node.label,
      formatOffset(node.offset),
      rangeMapNodeLength(node)
    )
  }

  function rangeMapNodeSelected(node: WebviewRangeMapNode): boolean {
    if (selectionStart < 0 || selectionEnd < selectionStart) {
      return false
    }
    return (
      selectionStart === node.offset &&
      selectionEnd === node.offset + node.length - 1
    )
  }

  function rangeMapNodeHovered(node: WebviewRangeMapNode): boolean {
    return hoveredExternalHighlightId === node.id
  }

  function rangeMapNodeHasChildren(node: WebviewRangeMapNode): boolean {
    return node.children.length > 0
  }

  function rangeMapNodeExpanded(node: WebviewRangeMapNode): boolean {
    return !collapsedRangeMapNodes[node.id]
  }

  function rangeMapNodeToggleLabel(node: WebviewRangeMapNode): string {
    return rangeMapNodeExpanded(node)
      ? strings.profiler.collapseRangeMapNode(node.label)
      : strings.profiler.expandRangeMapNode(node.label)
  }

  function toggleRangeMapNode(node: WebviewRangeMapNode): void {
    collapsedRangeMapNodes = {
      ...collapsedRangeMapNodes,
      [node.id]: !collapsedRangeMapNodes[node.id],
    }
  }

  function rangeMapTreeHasExpandableNodes(
    nodes: WebviewRangeMapNode[]
  ): boolean {
    for (const node of nodes) {
      if (
        rangeMapNodeHasChildren(node) ||
        rangeMapTreeHasExpandableNodes(node.children)
      ) {
        return true
      }
    }
    return false
  }

  function rangeMapTreeHasCollapsedNodes(
    nodes: WebviewRangeMapNode[]
  ): boolean {
    for (const node of nodes) {
      if (
        collapsedRangeMapNodes[node.id] ||
        rangeMapTreeHasCollapsedNodes(node.children)
      ) {
        return true
      }
    }
    return false
  }

  function rangeMapTreeAllExpandableNodesCollapsed(
    nodes: WebviewRangeMapNode[]
  ): boolean {
    for (const node of nodes) {
      if (rangeMapNodeHasChildren(node)) {
        if (
          !collapsedRangeMapNodes[node.id] ||
          !rangeMapTreeAllExpandableNodesCollapsed(node.children)
        ) {
          return false
        }
      }
    }
    return true
  }

  function collectCollapsedRangeMapNodes(
    nodes: WebviewRangeMapNode[],
    collapsed: Record<string, boolean>
  ): void {
    for (const node of nodes) {
      if (rangeMapNodeHasChildren(node)) {
        collapsed[node.id] = true
        collectCollapsedRangeMapNodes(node.children, collapsed)
      }
    }
  }

  function expandAllRangeMapNodes(): void {
    collapsedRangeMapNodes = {}
  }

  function collapseAllRangeMapNodes(): void {
    const collapsed: Record<string, boolean> = {}
    collectCollapsedRangeMapNodes(rangeMapTree, collapsed)
    collapsedRangeMapNodes = collapsed
  }

  function toHex2(byte: number): string {
    return byte.toString(16).toUpperCase().padStart(2, '0')
  }

  function isPrintable(byte: number): boolean {
    return byte >= 0x20 && byte <= 0x7e
  }

  function formatByteLabel(byte: number): string {
    if (!isPrintable(byte)) {
      return `0x${toHex2(byte)}`
    }
    if (byte === 0x20) {
      return '0x20 SP'
    }
    return `0x${toHex2(byte)} '${String.fromCharCode(byte)}'`
  }

  function formatModeByte(
    entry: { byte: number; count: number } | null,
    total: number
  ): string {
    if (!entry || total <= 0) {
      return '-'
    }
    return `${formatByteLabel(entry.byte)} x ${formatNumber(entry.count)} (${formatPercent(
      (entry.count / total) * 100
    )})`
  }

  function byteClass(byte: number): ByteClass {
    if (byte === 0x00) {
      return 'Null'
    }
    if (byte === 0xff) {
      return 'FF'
    }
    if (byte >= 0x20 && byte <= 0x7e) {
      return 'Printable'
    }
    if (byte < 0x20 || byte === 0x7f) {
      return 'Control'
    }
    return 'High-bit'
  }

  function frequencyBarClass(byte: number, count: number): string {
    if (count === 0) {
      return ' zero'
    }
    switch (byteClass(byte)) {
      case 'Control':
      case 'Null':
        return ' control'
      case 'Printable':
        return ' printable'
      case 'High-bit':
      case 'FF':
        return ' high-bit'
    }
  }

  function classColorClass(label: ByteClass): string {
    switch (label) {
      case 'Printable':
        return 'printable'
      case 'Control':
      case 'Null':
        return 'control'
      case 'High-bit':
      case 'FF':
        return 'high-bit'
    }
  }

  function topBytes(
    counts: number[],
    limit: number
  ): Array<{ byte: number; count: number }> {
    return counts
      .map((count, byte) => ({ byte, count }))
      .filter((entry) => entry.count > 0)
      .sort((left, right) => right.count - left.count || left.byte - right.byte)
      .slice(0, limit)
  }

  function classRowsFromCounts(counts: number[], total: number): BarRow[] {
    if (total <= 0) {
      return []
    }

    const classes: Record<ByteClass, number> = {
      Printable: 0,
      Control: 0,
      'High-bit': 0,
      Null: 0,
      FF: 0,
    }

    counts.slice(0, 256).forEach((count, byte) => {
      classes[byteClass(byte)] += count
    })

    return (Object.entries(classes) as Array<[ByteClass, number]>).map(
      ([label, count]) => ({
        label,
        percent: (count / total) * 100,
        value: `${formatNumber(count)} | ${formatPercent(
          (count / total) * 100
        )}`,
        colorClass: classColorClass(label),
      })
    )
  }

  function computeFrequencySpread(counts: number[], total: number): number {
    if (total <= 0) {
      return 0
    }
    const expected = 1 / 256
    const variance =
      counts.reduce((sum, count) => {
        const probability = count / total
        const delta = probability - expected
        return sum + delta * delta
      }, 0) / 256
    return Math.sqrt(variance) * 100
  }

  function formatFrequencySpread(value: number, total: number): string {
    if (total <= 0) {
      return '-'
    }
    return `${value.toFixed(value >= 10 ? 1 : 2)} pp`
  }

  function analyzeBytes(bytes: number[]): ByteAnalysis {
    const counts = new Array<number>(256).fill(0)
    const classes: Record<ByteClass, number> = {
      Printable: 0,
      Control: 0,
      'High-bit': 0,
      Null: 0,
      FF: 0,
    }
    let longestRunByte: number | null = null
    let longestRunLength = 0
    let currentRunByte: number | null = null
    let currentRunLength = 0

    for (const byte of bytes) {
      counts[byte] += 1
      classes[byteClass(byte)] += 1

      if (byte === currentRunByte) {
        currentRunLength += 1
      } else {
        currentRunByte = byte
        currentRunLength = 1
      }

      if (currentRunLength > longestRunLength) {
        longestRunLength = currentRunLength
        longestRunByte = byte
      }
    }

    let entropy = 0
    for (const count of counts) {
      if (count === 0) {
        continue
      }
      const probability = count / Math.max(1, bytes.length)
      entropy -= probability * Math.log2(probability)
    }

    const modeByte =
      counts
        .map((count, byte) => ({ byte, count }))
        .filter((entry) => entry.count > 0)
        .sort((left, right) => right.count - left.count || left.byte - right.byte)[0] ??
      null

    return {
      count: bytes.length,
      unique: counts.filter((count) => count > 0).length,
      entropy,
      frequencySpread: computeFrequencySpread(counts, bytes.length),
      modeByte,
      classes,
      longestRunByte,
      longestRunLength,
    }
  }

  function buildViewportRows(): MetricRow[] {
    const bufferCoverage = fileSize > 0 ? (viewportLength / fileSize) * 100 : 0
    const visibleCoverage = fileSize > 0 ? (visibleByteCount / fileSize) * 100 : 0
    return [
      { label: strings.profiler.offset, value: formatOffset(visibleOffset) },
      { label: strings.profiler.buffered, value: formatByteSize(viewportLength) },
      { label: strings.profiler.visible, value: formatByteSize(visibleByteCount) },
      { label: strings.profiler.rows, value: formatNumber(visibleRows) },
      {
        label: strings.profiler.capacity,
        value: formatByteSize(viewportProfile?.capacity ?? 0),
      },
      {
        label: strings.profiler.coverage,
        value: strings.profiler.coverageValue(
          formatPercent(bufferCoverage),
          formatPercent(visibleCoverage)
        ),
      },
      {
        label: strings.profiler.following,
        value: formatByteSize(viewportProfile?.followingByteCount ?? 0),
      },
      {
        label: strings.profiler.changes,
        value: formatNumber(viewportProfile?.changeCount ?? 0),
      },
      {
        label: strings.profiler.sync,
        value: `${viewportProfile?.sessionSyncVersion ?? '-'}`,
      },
    ]
  }

  function buildTimingRows(): MetricRow[] {
    return [
      {
        label: strings.profiler.fetch,
        value: formatDuration(viewportProfile?.fetchDurationMs),
      },
      {
        label: strings.profiler.bridge,
        value: formatDuration(viewportProfile?.hostToWebviewMs),
      },
      {
        label: strings.profiler.render,
        value: formatDuration(viewportProfile?.renderDurationMs),
      },
      {
        label: strings.profiler.avgRender,
        value: formatDuration(viewportProfile?.averageRenderMs),
      },
      {
        label: strings.profiler.updated,
        value: viewportProfile?.renderAt
          ? new Date(viewportProfile.renderAt).toLocaleTimeString()
          : '-',
      },
      {
        label: strings.profiler.message,
        value: viewportProfile?.messageAt
          ? new Date(viewportProfile.messageAt).toLocaleTimeString()
          : '-',
      },
    ]
  }

  function buildDataRows(): MetricRow[] {
    if (!dataProfile) {
      return [
        { label: strings.profiler.scope, value: '-' },
        { label: strings.profiler.bytes, value: '-' },
        { label: strings.profiler.dosEol, value: '-' },
        { label: strings.profiler.modeByte, value: '-' },
        { label: strings.profiler.ascii, value: '-' },
        { label: strings.profiler.content, value: '-' },
        { label: strings.profiler.language, value: '-' },
        { label: strings.profiler.bom, value: '-' },
        { label: strings.profiler.bomBytes, value: '-' },
        { label: strings.profiler.oneByteChars, value: '-' },
        { label: strings.profiler.twoByteChars, value: '-' },
        { label: strings.profiler.threeByteChars, value: '-' },
        { label: strings.profiler.fourByteChars, value: '-' },
        { label: strings.profiler.invalid, value: '-' },
        { label: strings.profiler.profile, value: '-' },
      ]
    }

    const asciiPercent =
      byteTotal > 0 ? (dataProfile.numAscii / byteTotal) * 100 : 0
    const characterCount = dataProfile.characterCount
    const modeByte = topProfileBytes[0] ?? null

    return [
      { label: strings.profiler.scope, value: dataProfile.scopeLabel },
      { label: strings.profiler.bytes, value: formatNumber(byteTotal) },
      {
        label: strings.profiler.dosEol,
        value: formatNumber(dataProfile.byteProfile[256] ?? 0),
      },
      { label: strings.profiler.modeByte, value: formatModeByte(modeByte, byteTotal) },
      {
        label: strings.profiler.ascii,
        value: `${formatNumber(dataProfile.numAscii)} / ${formatPercent(
          asciiPercent
        )}`,
      },
      { label: strings.profiler.content, value: dataProfile.contentType || '-' },
      { label: strings.profiler.language, value: dataProfile.language || '-' },
      { label: strings.profiler.bom, value: characterCount.byteOrderMark || '-' },
      {
        label: strings.profiler.bomBytes,
        value: formatNumber(characterCount.byteOrderMarkBytes),
      },
      {
        label: strings.profiler.oneByteChars,
        value: formatNumber(characterCount.singleByteCount),
      },
      {
        label: strings.profiler.twoByteChars,
        value: formatNumber(characterCount.doubleByteCount),
      },
      {
        label: strings.profiler.threeByteChars,
        value: formatNumber(characterCount.tripleByteCount),
      },
      {
        label: strings.profiler.fourByteChars,
        value: formatNumber(characterCount.quadByteCount),
      },
      {
        label: strings.profiler.invalid,
        value: formatNumber(characterCount.invalidBytes),
      },
      { label: strings.profiler.profile, value: formatDuration(dataProfile.durationMs) },
    ]
  }

  function buildStructureRows(): MetricRow[] {
    const printablePercent =
      structureAnalysis.count > 0
        ? (structureAnalysis.classes.Printable / structureAnalysis.count) * 100
        : 0
    const density =
      structureAnalysis.count > 0 ? (structureAnalysis.unique / 256) * 100 : 0
    return [
      {
        label: strings.profiler.bytes,
        value: formatNumber(structureAnalysis.count),
      },
      {
        label: strings.profiler.unique,
        value: `${formatNumber(structureAnalysis.unique)} / 256`,
      },
      { label: strings.profiler.density, value: formatPercent(density) },
      {
        label: strings.profiler.entropy,
        value:
          structureAnalysis.count === 0
            ? '-'
            : `${structureAnalysis.entropy.toFixed(2)} bits`,
      },
      {
        label: strings.profiler.modeByte,
        value: formatModeByte(structureAnalysis.modeByte, structureAnalysis.count),
      },
      {
        label: strings.profiler.freqSpread,
        value: formatFrequencySpread(
          structureAnalysis.frequencySpread,
          structureAnalysis.count
        ),
      },
      {
        label: strings.profiler.printable,
        value: formatPercent(printablePercent),
      },
      {
        label: strings.profiler.longestRun,
        value:
          structureAnalysis.longestRunByte === null
            ? '-'
            : `0x${toHex2(
                structureAnalysis.longestRunByte
              )} x ${formatNumber(structureAnalysis.longestRunLength)}`,
      },
    ]
  }

  function formatServerSeverity(
    severity: ServerHealthMessage['severity'] | 'pending'
  ): string {
    switch (severity) {
      case 'ok':
        return strings.profiler.ok
      case 'warn':
        return strings.profiler.warn
      case 'error':
        return strings.profiler.error
      case 'down':
        return strings.profiler.down
      case 'pending':
        return strings.profiler.pending
    }
  }

  function mapServerMetrics(
    metrics: ServerHealthMessage['metrics']
  ): Map<ServerHealthMetricId, MetricRow> {
    const metricById = new Map<ServerHealthMetricId, MetricRow>()

    for (const metric of metrics) {
      const label = metric.label.trim()
      const value = metric.value.trim()
      if (!label || !value || metricById.has(metric.id)) {
        continue
      }
      metricById.set(metric.id, { label, value })
    }

    return metricById
  }

  function collectServerMetrics(
    metricById: Map<ServerHealthMetricId, MetricRow>,
    ids: readonly ServerHealthMetricId[],
    seenIds: Set<ServerHealthMetricId>
  ): MetricRow[] {
    const rows: MetricRow[] = []

    for (const id of ids) {
      const row = metricById.get(id)
      if (!row || seenIds.has(id)) {
        continue
      }
      seenIds.add(id)
      rows.push(row)
    }

    return rows
  }

  function collectRemainingServerMetrics(
    metricById: Map<ServerHealthMetricId, MetricRow>,
    seenIds: Set<ServerHealthMetricId>
  ): MetricRow[] {
    const rows: MetricRow[] = []

    for (const [id, row] of metricById) {
      if (seenIds.has(id)) {
        continue
      }
      seenIds.add(id)
      rows.push(row)
    }

    return rows
  }

  function appendServerMetricSection(
    rows: MetricRow[],
    label: string,
    metrics: MetricRow[]
  ): void {
    if (metrics.length === 0) {
      return
    }

    rows.push({ label, value: '', kind: 'heading' }, ...metrics)
  }

  function buildServerRows(): MetricRow[] {
    const rows: MetricRow[] = []

    if (!serverHealth) {
      appendServerMetricSection(rows, strings.profiler.liveStatus, [
        {
          label: strings.profiler.status,
          value: strings.profiler.pending,
          severity: 'pending',
        },
      ])
      return rows
    }

    const metricById = mapServerMetrics(serverHealth.metrics)
    const seenIds = new Set<ServerHealthMetricId>()

    appendServerMetricSection(rows, strings.profiler.liveStatus, [
      {
        label: strings.profiler.status,
        value: formatServerSeverity(serverHealth.severity),
        severity: serverHealth.severity,
      },
      ...collectServerMetrics(
        metricById,
        SERVER_LIVE_STATUS_METRIC_IDS,
        seenIds
      ),
    ])
    appendServerMetricSection(
      rows,
      strings.profiler.currentInstance,
      collectServerMetrics(
        metricById,
        SERVER_CURRENT_INSTANCE_METRIC_IDS,
        seenIds
      )
    )
    appendServerMetricSection(
      rows,
      strings.profiler.hostAndBuild,
      collectServerMetrics(metricById, SERVER_HOST_BUILD_METRIC_IDS, seenIds)
    )
    appendServerMetricSection(
      rows,
      strings.profiler.details,
      collectRemainingServerMetrics(metricById, seenIds)
    )

    return rows
  }

  function barWidth(percent: number): number {
    return clamp(0, percent, 100)
  }

  function frequencyBarHeight(count: number): number {
    const maxCount = Math.max(0, ...byteCounts)
    if (byteTotal <= 0 || maxCount <= 0 || count <= 0) {
      return 1
    }
    const maxLog = Math.log2(maxCount + 1)
    const ratio =
      frequencyScale === 'log'
        ? Math.log2(count + 1) / Math.max(1, maxLog)
        : count / maxCount
    return clamp(2, ratio * 100, 100)
  }

  function updateFrequencyTooltip(event: PointerEvent): void {
    const chart = event.currentTarget
    if (!(chart instanceof HTMLElement)) {
      return
    }
    const rect = chart.getBoundingClientRect()
    const innerWidth = rect.width - 8
    if (innerWidth <= 0) {
      return
    }
    const x = clamp(0, event.clientX - rect.left - 4, innerWidth)
    const byte = clamp(0, Math.floor((x / innerWidth) * 256), 255)
    hoveredFrequencyByte = byte
    tooltipHorizontal = byte > 170 ? 'left' : byte < 85 ? 'right' : 'center'
    tooltipVertical =
      event.clientY - rect.top > rect.height / 2 ? 'top' : 'bottom'
  }
</script>

<svelte:window
  onblur={clearAnalysisDrag}
  onpointercancel={stopAnalysisDrag}
  onpointerup={stopAnalysisDrag}
/>

<aside
  class="profiler-panel"
  class:collapsed={!expanded}
  aria-label={strings.profiler.label}
>
  <div class="profiler-header">
    {#if !expanded}
      <button
        type="button"
        class="profiler-toggle profiler-collapsed-toggle"
        aria-expanded={expanded}
        aria-label={strings.profiler.expand}
        title={strings.profiler.expand}
        onclick={onToggleExpanded}
      >
        <span>{strings.profiler.show}</span>
        <span class="profiler-collapsed-label">{strings.profiler.title}</span>
      </button>
    {:else}
      <button
        type="button"
        class="profiler-toggle"
        aria-expanded={expanded}
        aria-label={strings.profiler.collapse}
        title={strings.profiler.collapse}
        onclick={onToggleExpanded}
      >
        {strings.profiler.collapseSymbol}
      </button>
      <span class="analysis-title">{strings.profiler.title}</span>
      <span class="analysis-tabs" role="tablist" aria-label={strings.profiler.views}>
        <button
          class="analysis-tab"
          class:active={mode === 'profile'}
          role="tab"
          aria-selected={mode === 'profile'}
          type="button"
          onclick={() => onModeChange('profile')}
        >
          {strings.profiler.profile}
        </button>
        <button
          class="analysis-tab"
          class:active={mode === 'structure'}
          role="tab"
          aria-selected={mode === 'structure'}
          type="button"
          onclick={() => onModeChange('structure')}
        >
          {strings.profiler.structure}
        </button>
      </span>
    {/if}
  </div>

  {#if expanded}
    <div class="analysis-body">
      {#if mode === 'profile'}
        <section class="analysis-panel active" data-analysis-panel="profile">
          {#each profileSectionOrder as sectionId (sectionId)}
            {#if sectionId === 'viewport'}
              <div
                class="analysis-section"
                class:dragging={isDraggingSection('profile', sectionId)}
                data-analysis-section={sectionId}
              >
                <div class="analysis-section-heading">
                  <div class="analysis-section-title">{sectionTitle(sectionId)}</div>
                  <div class="analysis-section-actions">
                    <button
                      type="button"
                      class="analysis-collapse-button"
                      aria-expanded={!isSectionCollapsed(sectionId)}
                      aria-label={sectionCollapseLabel(sectionId)}
                      title={sectionCollapseLabel(sectionId)}
                      onclick={() => toggleSectionCollapsed(sectionId)}
                    >
                      {sectionCollapseGlyph(sectionId)}
                    </button>
                    <button
                      type="button"
                      class="analysis-drag-handle"
                      class:dragging={isDraggingSection('profile', sectionId)}
                      data-analysis-drag="true"
                      aria-label={strings.profiler.moveSection(sectionTitle(sectionId))}
                      title={strings.profiler.moveSectionTitle}
                      onpointerdown={(event) =>
                        handleDragPointerDown(event, 'profile', sectionId)}
                      onpointermove={handleDragPointerMove}
                      onpointerup={stopAnalysisDrag}
                      onpointercancel={stopAnalysisDrag}
                      onlostpointercapture={stopAnalysisDrag}
                      onkeydown={(event) =>
                        handleDragKeydown(event, 'profile', sectionId)}
                    ></button>
                  </div>
                </div>
                {#if !isSectionCollapsed(sectionId)}
                  <div class="analysis-metrics">
                    {#each profileViewportRows as row}
                      <span class="analysis-label">{row.label}</span>
                      <span class="analysis-value">{row.value}</span>
                    {/each}
                  </div>
                {/if}
              </div>
            {:else if sectionId === 'classes'}
              <div
                class="analysis-section"
                class:dragging={isDraggingSection('profile', sectionId)}
                data-analysis-section={sectionId}
              >
                <div class="analysis-section-heading">
                  <div class="analysis-section-title">{sectionTitle(sectionId)}</div>
                  <div class="analysis-section-actions">
                    <button
                      type="button"
                      class="analysis-collapse-button"
                      aria-expanded={!isSectionCollapsed(sectionId)}
                      aria-label={sectionCollapseLabel(sectionId)}
                      title={sectionCollapseLabel(sectionId)}
                      onclick={() => toggleSectionCollapsed(sectionId)}
                    >
                      {sectionCollapseGlyph(sectionId)}
                    </button>
                    <button
                      type="button"
                      class="analysis-drag-handle"
                      class:dragging={isDraggingSection('profile', sectionId)}
                      data-analysis-drag="true"
                      aria-label={strings.profiler.moveSection(sectionTitle(sectionId))}
                      title={strings.profiler.moveSectionTitle}
                      onpointerdown={(event) =>
                        handleDragPointerDown(event, 'profile', sectionId)}
                      onpointermove={handleDragPointerMove}
                      onpointerup={stopAnalysisDrag}
                      onpointercancel={stopAnalysisDrag}
                      onlostpointercapture={stopAnalysisDrag}
                      onkeydown={(event) =>
                        handleDragKeydown(event, 'profile', sectionId)}
                    ></button>
                  </div>
                </div>
                {#if !isSectionCollapsed(sectionId)}
                  <div class="analysis-bars">
                    {#if profileClassRows.length === 0}
                      <div class="analysis-note">{strings.profiler.noBytes}</div>
                    {:else}
                      {#each profileClassRows as row}
                        <div class="analysis-bar-row">
                          <span class="analysis-label">{row.label}</span>
                          <span class="analysis-bar-track">
                            <svg
                              class="analysis-bar-svg"
                              viewBox="0 0 100 1"
                              preserveAspectRatio="none"
                              aria-hidden="true"
                            >
                              <rect
                                class={`analysis-bar-fill ${row.colorClass ?? ''}`}
                                x="0"
                                y="0"
                                width={barWidth(row.percent)}
                                height="1"
                                rx="0.5"
                              ></rect>
                            </svg>
                          </span>
                          <span class="analysis-value">{row.value}</span>
                        </div>
                      {/each}
                    {/if}
                  </div>
                {/if}
              </div>
            {:else if sectionId === 'data'}
              <div
                class="analysis-section"
                class:dragging={isDraggingSection('profile', sectionId)}
                data-analysis-section={sectionId}
              >
                <div class="analysis-section-heading">
                  <div class="analysis-section-title">{sectionTitle(sectionId)}</div>
                  <div class="analysis-section-actions">
                    <button
                      type="button"
                      class="analysis-collapse-button"
                      aria-expanded={!isSectionCollapsed(sectionId)}
                      aria-label={sectionCollapseLabel(sectionId)}
                      title={sectionCollapseLabel(sectionId)}
                      onclick={() => toggleSectionCollapsed(sectionId)}
                    >
                      {sectionCollapseGlyph(sectionId)}
                    </button>
                    <button
                      type="button"
                      class="analysis-drag-handle"
                      class:dragging={isDraggingSection('profile', sectionId)}
                      data-analysis-drag="true"
                      aria-label={strings.profiler.moveSection(sectionTitle(sectionId))}
                      title={strings.profiler.moveSectionTitle}
                      onpointerdown={(event) =>
                        handleDragPointerDown(event, 'profile', sectionId)}
                      onpointermove={handleDragPointerMove}
                      onpointerup={stopAnalysisDrag}
                      onpointercancel={stopAnalysisDrag}
                      onlostpointercapture={stopAnalysisDrag}
                      onkeydown={(event) =>
                        handleDragKeydown(event, 'profile', sectionId)}
                    ></button>
                  </div>
                </div>
                {#if !isSectionCollapsed(sectionId)}
                  <div class="analysis-metrics">
                    {#each profileDataRows as row}
                      <span class="analysis-label">{row.label}</span>
                      <span class="analysis-value">{row.value}</span>
                    {/each}
                  </div>
                {/if}
              </div>
            {:else if sectionId === 'frequency'}
              <div
                class="analysis-section"
                class:dragging={isDraggingSection('profile', sectionId)}
                data-analysis-section={sectionId}
              >
                <div class="analysis-section-heading">
                  <div class="analysis-section-title">{sectionTitle(sectionId)}</div>
                  <div class="analysis-section-actions">
                    <button
                      type="button"
                      class="analysis-mini-button"
                      title={
                        frequencyScale === 'log'
                          ? strings.profiler.switchLinear
                          : strings.profiler.switchLog
                      }
                      onclick={() =>
                        (frequencyScale =
                          frequencyScale === 'log' ? 'linear' : 'log')}
                    >
                      {frequencyScale === 'log'
                        ? strings.profiler.log
                        : strings.profiler.linear}
                    </button>
                    <button
                      type="button"
                      class="analysis-collapse-button"
                      aria-expanded={!isSectionCollapsed(sectionId)}
                      aria-label={sectionCollapseLabel(sectionId)}
                      title={sectionCollapseLabel(sectionId)}
                      onclick={() => toggleSectionCollapsed(sectionId)}
                    >
                      {sectionCollapseGlyph(sectionId)}
                    </button>
                    <button
                      type="button"
                      class="analysis-drag-handle"
                      class:dragging={isDraggingSection('profile', sectionId)}
                      data-analysis-drag="true"
                      aria-label={strings.profiler.moveSection(sectionTitle(sectionId))}
                      title={strings.profiler.moveSectionTitle}
                      onpointerdown={(event) =>
                        handleDragPointerDown(event, 'profile', sectionId)}
                      onpointermove={handleDragPointerMove}
                      onpointerup={stopAnalysisDrag}
                      onpointercancel={stopAnalysisDrag}
                      onlostpointercapture={stopAnalysisDrag}
                      onkeydown={(event) =>
                        handleDragKeydown(event, 'profile', sectionId)}
                    ></button>
                  </div>
                </div>
                {#if !isSectionCollapsed(sectionId)}
                  <div
                    class="frequency-chart"
                    role="img"
                    aria-label={strings.profiler.frequency}
                    onpointermove={updateFrequencyTooltip}
                    onpointerleave={() => (hoveredFrequencyByte = undefined)}
                  >
                    {#if byteTotal <= 0}
                      <div class="analysis-note">
                        {strings.profiler.noProfileData}
                      </div>
                    {:else}
                      <svg
                        class="frequency-bars"
                        viewBox="0 0 256 100"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        {#each Array.from({ length: 256 }, (_, byte) => byte) as byte}
                          {@const height = frequencyBarHeight(byteCounts[byte] ?? 0)}
                          <rect
                            class={`frequency-bar${frequencyBarClass(byte, byteCounts[byte] ?? 0)}`}
                            class:hovered={hoveredFrequencyByte === byte}
                            x={byte}
                            y={100 - height}
                            width="1"
                            height={height}
                          ></rect>
                        {/each}
                      </svg>
                    {/if}
                    {#if hoveredFrequency}
                      <div
                        class={`frequency-tooltip active ${tooltipHorizontal} ${tooltipVertical}`}
                      >
                        <div>{formatByteLabel(hoveredFrequency.byte)}</div>
                        <div>
                          {strings.profiler.count}
                          {formatNumber(hoveredFrequency.count)} |
                          {hoveredFrequency.percent}
                        </div>
                      </div>
                    {/if}
                  </div>
                  {#if profileLimitNote}
                    <div class="analysis-note">{profileLimitNote}</div>
                  {/if}
                  <div class="analysis-bars">
                    {#if profileByteRows.length === 0}
                      <div class="analysis-note">{strings.profiler.noBytes}</div>
                    {:else}
                      {#each profileByteRows as row}
                        <div class="analysis-bar-row">
                          <span class="analysis-label">{row.label}</span>
                          <span class="analysis-bar-track">
                            <svg
                              class="analysis-bar-svg"
                              viewBox="0 0 100 1"
                              preserveAspectRatio="none"
                              aria-hidden="true"
                            >
                              <rect
                                class={`analysis-bar-fill ${row.colorClass ?? ''}`}
                                x="0"
                                y="0"
                                width={barWidth(row.percent)}
                                height="1"
                                rx="0.5"
                              ></rect>
                            </svg>
                          </span>
                          <span class="analysis-value">{row.value}</span>
                        </div>
                      {/each}
                    {/if}
                  </div>
                {/if}
              </div>
            {/if}
          {/each}
        </section>
      {:else}
        <section class="analysis-panel active" data-analysis-panel="structure">
          {#each structureSectionOrder as sectionId (sectionId)}
            {#if sectionId === 'rangeMap'}
              <div
                class="analysis-section"
                class:dragging={isDraggingSection('structure', sectionId)}
                data-analysis-section={sectionId}
              >
                <div class="analysis-section-heading">
                  <div class="analysis-section-title">{sectionTitle(sectionId)}</div>
                  <div class="analysis-section-actions">
                    <button
                      type="button"
                      class="analysis-mini-button"
                      aria-label={hasRangeMap
                        ? strings.profiler.unloadRangeMapTitle
                        : strings.profiler.loadRangeMapTitle}
                      title={hasRangeMap
                        ? strings.profiler.unloadRangeMapTitle
                        : strings.profiler.loadRangeMapTitle}
                      onclick={hasRangeMap ? onUnloadRangeMap : onLoadRangeMap}
                    >
                      {hasRangeMap
                        ? strings.profiler.unloadRangeMap
                        : strings.profiler.loadRangeMap}
                    </button>
                    <button
                      type="button"
                      class="analysis-icon-button"
                      aria-label={strings.profiler.expandRangeMapAllTitle}
                      title={strings.profiler.expandRangeMapAllTitle}
                      disabled={!rangeMapHasCollapsedNodes}
                      onclick={expandAllRangeMapNodes}
                    >
                      ++
                    </button>
                    <button
                      type="button"
                      class="analysis-icon-button"
                      aria-label={strings.profiler.collapseRangeMapAllTitle}
                      title={strings.profiler.collapseRangeMapAllTitle}
                      disabled={
                        !rangeMapHasExpandableNodes ||
                        rangeMapAllExpandableNodesCollapsed
                      }
                      onclick={collapseAllRangeMapNodes}
                    >
                      --
                    </button>
                    <button
                      type="button"
                      class="analysis-collapse-button"
                      aria-expanded={!isSectionCollapsed(sectionId)}
                      aria-label={sectionCollapseLabel(sectionId)}
                      title={sectionCollapseLabel(sectionId)}
                      onclick={() => toggleSectionCollapsed(sectionId)}
                    >
                      {sectionCollapseGlyph(sectionId)}
                    </button>
                    <button
                      type="button"
                      class="analysis-drag-handle"
                      class:dragging={isDraggingSection('structure', sectionId)}
                      data-analysis-drag="true"
                      aria-label={strings.profiler.moveSection(sectionTitle(sectionId))}
                      title={strings.profiler.moveSectionTitle}
                      onpointerdown={(event) =>
                        handleDragPointerDown(event, 'structure', sectionId)}
                      onpointermove={handleDragPointerMove}
                      onpointerup={stopAnalysisDrag}
                      onpointercancel={stopAnalysisDrag}
                      onlostpointercapture={stopAnalysisDrag}
                      onkeydown={(event) =>
                        handleDragKeydown(event, 'structure', sectionId)}
                    ></button>
                  </div>
                </div>
                {#if !isSectionCollapsed(sectionId)}
                  {#if rangeMapRows.length === 0}
                    <div class="analysis-note">{strings.profiler.noRangeMap}</div>
                  {:else}
                    <div class="range-map-tree" role="tree">
                      {#each rangeMapRows as row (row.node.id)}
                        {@const nodeValue = rangeMapNodeValue(row.node)}
                        {@const hasChildren = rangeMapNodeHasChildren(row.node)}
                        {@const toggleLabel = rangeMapNodeToggleLabel(row.node)}
                        <div
                          class={`range-map-node-row ${rangeMapDepthClass(row.depth)}`}
                          class:active={rangeMapNodeSelected(row.node)}
                          class:hovered={rangeMapNodeHovered(row.node)}
                          class:stale={row.node.stale === true}
                          role="treeitem"
                          tabindex="-1"
                          aria-level={row.depth + 1}
                          aria-selected={rangeMapNodeSelected(row.node)}
                          aria-expanded={hasChildren
                            ? rangeMapNodeExpanded(row.node)
                            : undefined}
                          onpointerenter={() => onRangeMapNodeHover(row.node.id)}
                          onpointerleave={() => onRangeMapNodeHover(undefined)}
                        >
                          {#if hasChildren}
                            <button
                              type="button"
                              class="range-map-node-toggle"
                              aria-label={toggleLabel}
                              title={toggleLabel}
                              onclick={() => toggleRangeMapNode(row.node)}
                            >
                              {rangeMapNodeExpanded(row.node) ? '-' : '+'}
                            </button>
                          {:else}
                            <span
                              class="range-map-node-toggle-spacer"
                              aria-hidden="true"
                            ></span>
                          {/if}
                          <button
                            type="button"
                            class="range-map-node"
                            data-external-color={rangeMapNodeColorSlot(row.node)}
                            title={rangeMapNodeTitle(row.node)}
                            onclick={() => onSelectRangeMapNode(row.node)}
                          >
                            <span class="range-map-node-label">{row.node.label}</span>
                            {#if nodeValue}
                              <span class="range-map-node-value">{nodeValue}</span>
                            {/if}
                            <span class="range-map-node-meta">
                              {formatOffset(row.node.offset)} | {rangeMapNodeLength(row.node)}
                            </span>
                          </button>
                        </div>
                      {/each}
                    </div>
                  {/if}
                {/if}
              </div>
            {:else if sectionId === 'visible'}
              <div
                class="analysis-section"
                class:dragging={isDraggingSection('structure', sectionId)}
                data-analysis-section={sectionId}
              >
                <div class="analysis-section-heading">
                  <div class="analysis-section-title">{sectionTitle(sectionId)}</div>
                  <div class="analysis-section-actions">
                    <button
                      type="button"
                      class="analysis-collapse-button"
                      aria-expanded={!isSectionCollapsed(sectionId)}
                      aria-label={sectionCollapseLabel(sectionId)}
                      title={sectionCollapseLabel(sectionId)}
                      onclick={() => toggleSectionCollapsed(sectionId)}
                    >
                      {sectionCollapseGlyph(sectionId)}
                    </button>
                    <button
                      type="button"
                      class="analysis-drag-handle"
                      class:dragging={isDraggingSection('structure', sectionId)}
                      data-analysis-drag="true"
                      aria-label={strings.profiler.moveSection(sectionTitle(sectionId))}
                      title={strings.profiler.moveSectionTitle}
                      onpointerdown={(event) =>
                        handleDragPointerDown(event, 'structure', sectionId)}
                      onpointermove={handleDragPointerMove}
                      onpointerup={stopAnalysisDrag}
                      onpointercancel={stopAnalysisDrag}
                      onlostpointercapture={stopAnalysisDrag}
                      onkeydown={(event) =>
                        handleDragKeydown(event, 'structure', sectionId)}
                    ></button>
                  </div>
                </div>
                {#if !isSectionCollapsed(sectionId)}
                  <div class="analysis-metrics">
                    {#each structureRows as row}
                      <span class="analysis-label">{row.label}</span>
                      <span class="analysis-value">{row.value}</span>
                    {/each}
                  </div>
                {/if}
              </div>
            {:else if sectionId === 'history'}
              <div
                class="analysis-section"
                class:dragging={isDraggingSection('structure', sectionId)}
                data-analysis-section={sectionId}
              >
                <div class="analysis-section-heading">
                  <div class="analysis-section-title">{sectionTitle(sectionId)}</div>
                  <div class="analysis-section-actions">
                    <button
                      type="button"
                      class="analysis-collapse-button"
                      aria-expanded={!isSectionCollapsed(sectionId)}
                      aria-label={sectionCollapseLabel(sectionId)}
                      title={sectionCollapseLabel(sectionId)}
                      onclick={() => toggleSectionCollapsed(sectionId)}
                    >
                      {sectionCollapseGlyph(sectionId)}
                    </button>
                    <button
                      type="button"
                      class="analysis-drag-handle"
                      class:dragging={isDraggingSection('structure', sectionId)}
                      data-analysis-drag="true"
                      aria-label={strings.profiler.moveSection(sectionTitle(sectionId))}
                      title={strings.profiler.moveSectionTitle}
                      onpointerdown={(event) =>
                        handleDragPointerDown(event, 'structure', sectionId)}
                      onpointermove={handleDragPointerMove}
                      onpointerup={stopAnalysisDrag}
                      onpointercancel={stopAnalysisDrag}
                      onlostpointercapture={stopAnalysisDrag}
                      onkeydown={(event) =>
                        handleDragKeydown(event, 'structure', sectionId)}
                    ></button>
                  </div>
                </div>
                {#if !isSectionCollapsed(sectionId)}
                  <div class="analysis-metrics">
                    {#each historyRows as row}
                      <span class="analysis-label">{row.label}</span>
                      <span class="analysis-value">{row.value}</span>
                    {/each}
                  </div>
                {/if}
              </div>
            {:else if sectionId === 'timing'}
              <div
                class="analysis-section"
                class:dragging={isDraggingSection('structure', sectionId)}
                data-analysis-section={sectionId}
              >
                <div class="analysis-section-heading">
                  <div class="analysis-section-title">{sectionTitle(sectionId)}</div>
                  <div class="analysis-section-actions">
                    <button
                      type="button"
                      class="analysis-collapse-button"
                      aria-expanded={!isSectionCollapsed(sectionId)}
                      aria-label={sectionCollapseLabel(sectionId)}
                      title={sectionCollapseLabel(sectionId)}
                      onclick={() => toggleSectionCollapsed(sectionId)}
                    >
                      {sectionCollapseGlyph(sectionId)}
                    </button>
                    <button
                      type="button"
                      class="analysis-drag-handle"
                      class:dragging={isDraggingSection('structure', sectionId)}
                      data-analysis-drag="true"
                      aria-label={strings.profiler.moveSection(sectionTitle(sectionId))}
                      title={strings.profiler.moveSectionTitle}
                      onpointerdown={(event) =>
                        handleDragPointerDown(event, 'structure', sectionId)}
                      onpointermove={handleDragPointerMove}
                      onpointerup={stopAnalysisDrag}
                      onpointercancel={stopAnalysisDrag}
                      onlostpointercapture={stopAnalysisDrag}
                      onkeydown={(event) =>
                        handleDragKeydown(event, 'structure', sectionId)}
                    ></button>
                  </div>
                </div>
                {#if !isSectionCollapsed(sectionId)}
                  <div class="analysis-metrics">
                    {#each profileTimingRows as row}
                      <span class="analysis-label">{row.label}</span>
                      <span class="analysis-value">{row.value}</span>
                    {/each}
                  </div>
                {/if}
              </div>
            {:else if sectionId === 'server'}
              <div
                class="analysis-section"
                class:dragging={isDraggingSection('structure', sectionId)}
                data-analysis-section={sectionId}
              >
                <div class="analysis-section-heading">
                  <div class="analysis-section-title">{sectionTitle(sectionId)}</div>
                  <div class="analysis-section-actions">
                    <button
                      type="button"
                      class="analysis-collapse-button"
                      aria-expanded={!isSectionCollapsed(sectionId)}
                      aria-label={sectionCollapseLabel(sectionId)}
                      title={sectionCollapseLabel(sectionId)}
                      onclick={() => toggleSectionCollapsed(sectionId)}
                    >
                      {sectionCollapseGlyph(sectionId)}
                    </button>
                    <button
                      type="button"
                      class="analysis-drag-handle"
                      class:dragging={isDraggingSection('structure', sectionId)}
                      data-analysis-drag="true"
                      aria-label={strings.profiler.moveSection(sectionTitle(sectionId))}
                      title={strings.profiler.moveSectionTitle}
                      onpointerdown={(event) =>
                        handleDragPointerDown(event, 'structure', sectionId)}
                      onpointermove={handleDragPointerMove}
                      onpointerup={stopAnalysisDrag}
                      onpointercancel={stopAnalysisDrag}
                      onlostpointercapture={stopAnalysisDrag}
                      onkeydown={(event) =>
                        handleDragKeydown(event, 'structure', sectionId)}
                    ></button>
                  </div>
                </div>
                {#if !isSectionCollapsed(sectionId)}
                  <div class="analysis-metrics server-health-metrics">
                    {#each serverRows as row}
                      {#if row.kind === 'heading'}
                        <span class="server-health-section">{row.label}</span>
                      {:else}
                        <span class="analysis-label">{row.label}</span>
                        <span
                          class={`analysis-value ${
                            row.severity
                              ? `server-health-value ${row.severity}`
                              : ''
                          }`}
                        >
                          {row.value}
                        </span>
                      {/if}
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          {/each}
        </section>
      {/if}
    </div>
  {/if}
</aside>
