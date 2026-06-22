<script lang="ts">
  import type {
    BytesPerRow,
    HostToWebviewMessage,
    ServerHealthMessage,
    WebviewExternalHighlight,
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
    editDisabled?: boolean
    readOnlyLabel?: string
    readOnlyTitle?: string
    onSelect: (offset: number, extend: boolean) => void
    onActivePaneChange: (pane: GridEditPane) => void
    onMoveSelection: (delta: number, extend: boolean) => void
    onJumpToBoundary: (boundary: 'top' | 'bottom') => void
    onScrollTo: (offset: number) => void
    onScroll: (direction: 'up' | 'down') => void
    onToggleEditMode: () => void
    onTypeByte: (pane: GridEditPane, key: string) => boolean
    onDeleteByte: (backward: boolean) => boolean
    onVisibleRowsChange: (visibleRows: number) => void
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
    editDisabled = false,
    readOnlyLabel = strings.grid.readOnly,
    readOnlyTitle = readOnlyLabel,
    onSelect,
    onActivePaneChange,
    onMoveSelection,
    onJumpToBoundary,
    onScrollTo,
    onScroll,
    onToggleEditMode,
    onTypeByte,
    onDeleteByte,
    onVisibleRowsChange,
    onToggleProfilerExpanded,
    onProfilerModeChange,
    onMoveAnalysisSection,
    onReorderAnalysisSection,
  }: Props = $props()
</script>

<div class="editor-main">
  <div class="editor-grid-shell" class:preparing>
    {#if preparing}
      <div class="preparing-file" role="status" aria-live="polite">
        <span class="preparing-spinner" aria-hidden="true"></span>
        <span>{strings.grid.preparingFile}</span>
      </div>
    {:else}
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
    {dataProfile}
    {viewportProfile}
    {serverHealth}
    {canUndo}
    {canRedo}
    {undoCount}
    {redoCount}
    onToggleExpanded={onToggleProfilerExpanded}
    onModeChange={onProfilerModeChange}
    onMoveSection={onMoveAnalysisSection}
    onReorderSection={onReorderAnalysisSection}
  />
</div>
