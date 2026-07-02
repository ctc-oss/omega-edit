<script lang="ts">
  import { tick } from 'svelte'
  import type {
    BytesPerRow,
    HostToWebviewMessage,
    ServerHealthMessage,
    WebviewExternalHighlight,
    WebviewRangeMapNode,
  } from '../protocol'
  import { strings } from '../i18n'
  import FileScrollbar from './FileScrollbar.svelte'
  import PreviewGrid from './PreviewGrid.svelte'
  import ProfilerPanel from './ProfilerPanel.svelte'

  type AnalysisMode = 'profile' | 'structure'
  type GridEditPane = 'hex' | 'ascii'
  type InspectorEditMode = 'insert' | 'overwrite'
  type OffsetRadix = 'hex' | 'dec'
  type AnalysisSectionOrder = Record<AnalysisMode, string[]>

  type AnalysisProfileMessage = Extract<
    HostToWebviewMessage,
    { type: 'analysisProfile' }
  >
  type ViewportDataMessage = Extract<
    HostToWebviewMessage,
    { type: 'viewportData' }
  >

  type ProfilerViewportSnapshot = ViewportDataMessage['profile'] & {
    hostToWebviewMs: number
    renderDurationMs: number
    averageRenderMs: number | null
    messageAt: number
    renderAt: number
    followingByteCount: number
  }

  interface Props {
    data?: number[]
    visibleOffset?: number
    scrollOffset?: number
    bytesPerRow?: BytesPerRow
    offsetRadix?: OffsetRadix
    selectedOffset?: number
    selectionStart?: number
    selectionEnd?: number
    searchStart?: number
    searchEnd?: number
    inspectorStart?: number
    inspectorEnd?: number
    externalHighlights?: WebviewExternalHighlight[]
    rangeMapTree?: WebviewRangeMapNode[]
    preparing?: boolean
    activePane?: GridEditPane
    editMode?: InspectorEditMode
    pendingHexLabel?: string
    canScrollUp?: boolean
    canScrollDown?: boolean
    profilerExpanded?: boolean
    profilerMode?: AnalysisMode
    analysisSectionOrder?: AnalysisSectionOrder
    fileSize?: number
    visibleByteCount?: number
    viewportLength?: number
    visibleRows?: number
    visibleBytes?: number[]
    selectedBytes?: number[]
    selectionLength?: number
    dataProfile?: AnalysisProfileMessage
    viewportProfile?: ProfilerViewportSnapshot
    serverHealth?: ServerHealthMessage
    canUndo?: boolean
    canRedo?: boolean
    undoCount?: number
    redoCount?: number
    autoFitBytesPerRow?: boolean
    maxBytesPerRow?: number
    editDisabled?: boolean
    readOnlyLabel?: string
    readOnlyTitle?: string
    onSelect: (offset: number, extend: boolean) => void
    onSelectRangeMapNode: (node: WebviewRangeMapNode) => void
    onLoadRangeMap: () => void
    onUnloadRangeMap: () => void
    onActivePaneChange: (pane: GridEditPane) => void
    onMoveSelection: (delta: number, extend: boolean) => void
    onJumpToBoundary: (boundary: 'top' | 'bottom') => void
    onScrollTo: (offset: number) => void
    onScroll: (direction: 'up' | 'down') => void
    onToggleEditMode: () => void
    onTypeByte: (pane: GridEditPane, key: string) => boolean
    onDeleteByte: (backward: boolean) => boolean
    onVisibleRowsChange: (visibleRows: number) => void
    onAutoFitBytesPerRow: (bytesPerRow: BytesPerRow) => void
    onToggleProfilerExpanded: () => void
    onProfilerModeChange: (mode: AnalysisMode) => void
    onMoveAnalysisSection: (
      mode: AnalysisMode,
      sectionId: string,
      delta: number
    ) => void
    onReorderAnalysisSection: (
      mode: AnalysisMode,
      sectionId: string,
      targetId: string,
      placeAfter: boolean
    ) => void
  }

  let {
    data = [],
    visibleOffset = 0,
    scrollOffset = visibleOffset,
    bytesPerRow = 16,
    offsetRadix = 'hex',
    selectedOffset = -1,
    selectionStart = -1,
    selectionEnd = -1,
    searchStart = -1,
    searchEnd = -1,
    inspectorStart = -1,
    inspectorEnd = -1,
    externalHighlights = [],
    rangeMapTree = [],
    preparing = false,
    activePane = 'hex',
    editMode = 'insert',
    pendingHexLabel = '',
    canScrollUp = false,
    canScrollDown = false,
    profilerExpanded = true,
    profilerMode = 'profile',
    analysisSectionOrder,
    fileSize = 0,
    visibleByteCount = 0,
    viewportLength = 0,
    visibleRows = 0,
    visibleBytes = [],
    selectedBytes = [],
    selectionLength = 0,
    dataProfile,
    viewportProfile,
    serverHealth,
    canUndo = false,
    canRedo = false,
    undoCount = 0,
    redoCount = 0,
    autoFitBytesPerRow = false,
    maxBytesPerRow = 64,
    editDisabled = false,
    readOnlyLabel = strings.grid.readOnly,
    readOnlyTitle = readOnlyLabel,
    onSelect,
    onSelectRangeMapNode,
    onLoadRangeMap,
    onUnloadRangeMap,
    onActivePaneChange,
    onMoveSelection,
    onJumpToBoundary,
    onScrollTo,
    onScroll,
    onToggleEditMode,
    onTypeByte,
    onDeleteByte,
    onVisibleRowsChange,
    onAutoFitBytesPerRow,
    onToggleProfilerExpanded,
    onProfilerModeChange,
    onMoveAnalysisSection,
    onReorderAnalysisSection,
  }: Props = $props()

  let gridScrollerElement = $state<HTMLDivElement>()
  let autoFitFrame = $state<number | undefined>(undefined)
  let autoFitOverflowCap = $state<
    { width: number; bytesPerRow: BytesPerRow } | undefined
  >(undefined)
  const AUTO_FIT_WIDTH_GUARD_PX = 24

  function measureAutoFitBytesPerRow(): BytesPerRow | undefined {
    if (!gridScrollerElement || !autoFitBytesPerRow || preparing) {
      return undefined
    }

    const grid = gridScrollerElement.querySelector('.preview-grid')
    const header = gridScrollerElement.querySelector('.grid-header')
    const row = gridScrollerElement.querySelector('.grid-row') || header
    const hexCells = row?.querySelector('.hex-cells, .hex-heading')
    const asciiCells = row?.querySelector('.ascii')
    const offsetCell = row?.querySelector('.offset, .offset-heading')
    if (!grid || !row || !hexCells || !offsetCell) {
      return undefined
    }

    const gridStyle = getComputedStyle(grid)
    const rowStyle = getComputedStyle(row)
    const horizontalPadding =
      (Number.parseFloat(gridStyle.paddingLeft) || 0) +
      (Number.parseFloat(gridStyle.paddingRight) || 0)
    const gapFromStyle = Number.parseFloat(rowStyle.columnGap)
    const hexWidth = hexCells.getBoundingClientRect().width
    const asciiWidth =
      asciiCells?.getBoundingClientRect().width ||
      Math.max(1, hexWidth / Math.max(1, bytesPerRow) / 3) * bytesPerRow
    const measuredRowWidth = row.getBoundingClientRect().width
    const measuredGap = Math.max(
      0,
      (measuredRowWidth -
        offsetCell.getBoundingClientRect().width -
        hexWidth -
        asciiWidth) /
        2
    )
    const gap = Number.isFinite(gapFromStyle) ? gapFromStyle : measuredGap
    const hexByteWidth =
      row.querySelector('.byte, .hex-heading span')?.getBoundingClientRect()
        .width || hexWidth / Math.max(1, bytesPerRow)
    const asciiByteWidth =
      row.querySelector('.text-byte')?.getBoundingClientRect().width ||
      asciiWidth / Math.max(1, bytesPerRow)
    const perByteWidth = Math.max(
      1,
      hexByteWidth + asciiByteWidth
    )
    const fixedWidth =
      Math.max(
        offsetCell.getBoundingClientRect().width,
        header
          ?.querySelector('.offset-heading')
          ?.getBoundingClientRect().width ?? 0
      ) +
      gap * 2 +
      horizontalPadding +
      AUTO_FIT_WIDTH_GUARD_PX
    const availableWidth = Math.max(0, gridScrollerElement.clientWidth)
    const overflowWidth = Math.max(
      0,
      gridScrollerElement.scrollWidth - availableWidth
    )
    if (overflowWidth > 1) {
      const overflowBytes = Math.ceil(overflowWidth / perByteWidth)
      const cappedBytesPerRow = Math.max(
        8,
        Math.min(maxBytesPerRow, bytesPerRow - overflowBytes)
      )
      autoFitOverflowCap = {
        width: availableWidth,
        bytesPerRow: cappedBytesPerRow,
      }
      return cappedBytesPerRow
    }

    const rawFit = Math.floor((availableWidth - fixedWidth) / perByteWidth)
    if (
      autoFitOverflowCap &&
      Math.abs(availableWidth - autoFitOverflowCap.width) <= perByteWidth
    ) {
      return Math.max(
        8,
        Math.min(maxBytesPerRow, rawFit, autoFitOverflowCap.bytesPerRow)
      )
    }

    autoFitOverflowCap = undefined
    return Math.max(8, Math.min(maxBytesPerRow, rawFit))
  }

  async function reportAutoFitBytesPerRow(): Promise<void> {
    await tick()
    const nextBytesPerRow = measureAutoFitBytesPerRow()
    if (nextBytesPerRow !== undefined) {
      onAutoFitBytesPerRow(nextBytesPerRow)
    }
  }

  function queueAutoFitBytesPerRow(): void {
    if (!autoFitBytesPerRow || !gridScrollerElement || preparing) {
      return
    }
    if (autoFitFrame !== undefined) {
      cancelAnimationFrame(autoFitFrame)
    }
    autoFitFrame = requestAnimationFrame(() => {
      autoFitFrame = undefined
      void reportAutoFitBytesPerRow()
    })
  }

  $effect(() => {
    if (
      gridScrollerElement &&
      autoFitBytesPerRow &&
      !preparing &&
      profilerExpanded !== undefined
    ) {
      queueAutoFitBytesPerRow()
    }
  })

  $effect(() => {
    if (!gridScrollerElement) {
      return
    }

    const observer = new ResizeObserver(() => {
      queueAutoFitBytesPerRow()
    })
    observer.observe(gridScrollerElement)
    queueAutoFitBytesPerRow()
    return () => {
      if (autoFitFrame !== undefined) {
        cancelAnimationFrame(autoFitFrame)
      }
      observer.disconnect()
    }
  })
</script>

<div class="editor-main">
  <div class="editor-grid-shell" class:preparing>
    {#if preparing}
      <div class="preparing-file" role="status" aria-live="polite">
        <span class="preparing-spinner" aria-hidden="true"></span>
        <span>{strings.grid.preparingFile}</span>
      </div>
    {:else}
      <div class="editor-grid-scroller" bind:this={gridScrollerElement}>
        <PreviewGrid
          {data}
          offset={visibleOffset}
          {bytesPerRow}
          {offsetRadix}
          {selectedOffset}
          {selectionStart}
          {selectionEnd}
          {activePane}
          searchStart={searchStart}
          searchEnd={searchEnd}
          inspectorStart={inspectorStart}
          inspectorEnd={inspectorEnd}
          {externalHighlights}
          {pendingHexLabel}
          {canScrollUp}
          {canScrollDown}
          onSelect={onSelect}
          onActivePaneChange={onActivePaneChange}
          onMoveSelection={onMoveSelection}
          onJumpToBoundary={onJumpToBoundary}
          onScroll={onScroll}
          onToggleEditMode={onToggleEditMode}
          onTypeByte={onTypeByte}
          onDeleteByte={onDeleteByte}
          readOnly={editDisabled}
          onVisibleRowsChange={onVisibleRowsChange}
          editMode={editMode}
        />
      </div>
      <FileScrollbar
        {fileSize}
        visibleOffset={scrollOffset}
        {bytesPerRow}
        {visibleRows}
        {visibleByteCount}
        {offsetRadix}
        onScrollTo={onScrollTo}
      />
      {#if editDisabled}
        <div
          class="editor-readonly-badge"
          role="status"
          aria-live="polite"
          title={readOnlyTitle}
        >
          <span class="editor-readonly-dot" aria-hidden="true"></span>
          <span>{readOnlyLabel}</span>
        </div>
      {/if}
    {/if}
  </div>

  <ProfilerPanel
    expanded={profilerExpanded}
    mode={profilerMode}
    sectionOrder={analysisSectionOrder}
    {fileSize}
    {visibleOffset}
    {visibleByteCount}
    {viewportLength}
    {visibleRows}
    {offsetRadix}
    {visibleBytes}
    {selectedBytes}
    {selectionLength}
    {selectionStart}
    {selectionEnd}
    {dataProfile}
    {viewportProfile}
    {serverHealth}
    {canUndo}
    {canRedo}
    {undoCount}
    {redoCount}
    {rangeMapTree}
    onToggleExpanded={onToggleProfilerExpanded}
    onModeChange={onProfilerModeChange}
    onSelectRangeMapNode={onSelectRangeMapNode}
    onLoadRangeMap={onLoadRangeMap}
    onUnloadRangeMap={onUnloadRangeMap}
    onMoveSection={onMoveAnalysisSection}
    onReorderSection={onReorderAnalysisSection}
  />
</div>
