<script lang="ts">
  import {
    FIXED_BYTES_PER_ROW_OPTIONS,
    MAX_BYTES_PER_ROW,
    MIN_BYTES_PER_ROW,
    normalizeBytesPerRow,
    type BytesPerRow,
    type BytesPerRowMode,
    type InsertDirection,
    type WebviewSessionContentInfo,
    type WebviewSessionContentSource,
    type WebviewTransformPlugin,
  } from '../protocol'
  import { strings } from '../i18n'
  import OffsetJump from './OffsetJump.svelte'
  import TransformPanel from './TransformPanel.svelte'

  interface TransformResultHistoryItem {
    id: string
    title: string
    summary: string
    label: string
    rangeStart: string
    rangeEnd: string
    historyLabel: string
  }

  interface Props {
    bytesPerRow: BytesPerRow
    bytesPerRowMode: BytesPerRowMode
    offsetRadix?: 'hex' | 'dec'
    insertDirection?: InsertDirection
    fileSize?: number
    contentSources?: WebviewSessionContentInfo[]
    transformPlugins?: WebviewTransformPlugin[]
    transformPluginsLoaded?: boolean
    transformPluginsLoading?: boolean
    transformInFlight?: boolean
    transformPluginError?: string
    transformFeedback?: string
    transformResults?: TransformResultHistoryItem[]
    activeTransformResultId?: string
    searchPanelVisible?: boolean
    selectedOffset?: number
    selectionStart?: number
    selectionEnd?: number
    selectionLength?: number
    onBytesPerRow: (bytesPerRow: BytesPerRow) => void
    onBytesPerRowMode: (mode: BytesPerRowMode) => void
    onOffsetRadix: (radix: 'hex' | 'dec') => void
    onInsertDirection: (direction: InsertDirection) => void
    onGoToOffset: (offset: number) => void
    onRequestTransforms: () => void
    onApplyTransform: (
      pluginId: string,
      contentSource: WebviewSessionContentSource,
      offset: number,
      length: number,
      optionsJson?: string
    ) => void
    onExportRange: (offset: number, length: number) => void
    onInsertFile: (offset: number) => void
    onReplaceRangeWithFile: (offset: number, length: number) => void
    onOpenTransformResult: (resultId: string) => void
    onToggleSearchPanel: () => void
    onCreateCheckpoint: () => void
    onRollbackCheckpoint: () => void
    onRestoreCheckpoint: () => void
    onExportChangeLog: () => void
    onApplyChangeLog: () => void
  }

  let {
    bytesPerRow,
    bytesPerRowMode,
    offsetRadix = 'hex',
    insertDirection = 'forward',
    fileSize = 0,
    contentSources = [],
    transformPlugins = [],
    transformPluginsLoaded = false,
    transformPluginsLoading = false,
    transformInFlight = false,
    transformPluginError = '',
    transformFeedback = '',
    transformResults = [],
    activeTransformResultId = '',
    searchPanelVisible = true,
    selectedOffset = -1,
    selectionStart = -1,
    selectionEnd = -1,
    selectionLength = 0,
    onBytesPerRow,
    onBytesPerRowMode,
    onOffsetRadix,
    onInsertDirection,
    onGoToOffset,
    onRequestTransforms,
    onApplyTransform,
    onExportRange,
    onInsertFile,
    onReplaceRangeWithFile,
    onOpenTransformResult,
    onToggleSearchPanel,
    onCreateCheckpoint,
    onRollbackCheckpoint,
    onRestoreCheckpoint,
    onExportChangeLog,
    onApplyChangeLog,
  }: Props = $props()

  const rowOptions: BytesPerRow[] = [...FIXED_BYTES_PER_ROW_OPTIONS]
  let customBytesPerRowValue = $state('')

  function clampBytesPerRow(value: number): BytesPerRow {
    if (!Number.isFinite(value)) {
      return bytesPerRow
    }
    return normalizeBytesPerRow(
      Math.max(MIN_BYTES_PER_ROW, Math.min(MAX_BYTES_PER_ROW, Math.floor(value)))
    )
  }

  function handleCustomBytesInput(event: Event): void {
    customBytesPerRowValue = (event.currentTarget as HTMLInputElement).value
  }

  function commitCustomBytesPerRow(force = false): void {
    const nextBytesPerRow = clampBytesPerRow(
      Number.parseInt(customBytesPerRowValue, 10)
    )
    customBytesPerRowValue = String(nextBytesPerRow)
    if (
      !force &&
      bytesPerRowMode === 'auto' &&
      nextBytesPerRow === bytesPerRow
    ) {
      return
    }
    onBytesPerRow(nextBytesPerRow)
  }

  function handleCustomBytesKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitCustomBytesPerRow(true)
    }
  }

  function handleCustomBytesBlur(): void {
    commitCustomBytesPerRow()
  }

  $effect(() => {
    customBytesPerRowValue = String(bytesPerRow)
  })
</script>

<div class="toolbar" role="toolbar" aria-label={strings.toolbar.label}>
  <div class="bytes-per-row-control">
    <div class="segmented" aria-label={strings.toolbar.bytesPerRow}>
      <button
        type="button"
        class:active={bytesPerRowMode === 'auto'}
        aria-pressed={bytesPerRowMode === 'auto'}
        title={strings.toolbar.autoBytesPerRowTitle}
        onclick={() => onBytesPerRowMode('auto')}
      >
        {strings.toolbar.autoBytesPerRow}
      </button>
      {#each rowOptions as option}
        <button
          type="button"
          class:active={bytesPerRowMode === 'fixed' && option === bytesPerRow}
          aria-pressed={bytesPerRowMode === 'fixed' && option === bytesPerRow}
          title={strings.toolbar.bytesPerRowTitle(option)}
          onclick={() => onBytesPerRow(option)}
        >
          {option}
        </button>
      {/each}
    </div>
    <input
      class="bytes-per-row-input"
      type="number"
      min={MIN_BYTES_PER_ROW}
      max={MAX_BYTES_PER_ROW}
      value={customBytesPerRowValue}
      aria-label={strings.toolbar.customBytesPerRow}
      title={strings.toolbar.customBytesPerRowTitle(
        MIN_BYTES_PER_ROW,
        MAX_BYTES_PER_ROW
      )}
      oninput={handleCustomBytesInput}
      onblur={handleCustomBytesBlur}
      onkeydown={handleCustomBytesKeydown}
    />
  </div>

  <div class="segmented" aria-label={strings.toolbar.offsetRadix}>
    <button
      type="button"
      class:active={offsetRadix === 'hex'}
      aria-pressed={offsetRadix === 'hex'}
      title={strings.toolbar.hexOffsetsTitle}
      onclick={() => onOffsetRadix('hex')}
    >
      {strings.toolbar.hexOffsets}
    </button>
    <button
      type="button"
      class:active={offsetRadix === 'dec'}
      aria-pressed={offsetRadix === 'dec'}
      title={strings.toolbar.decOffsetsTitle}
      onclick={() => onOffsetRadix('dec')}
    >
      {strings.toolbar.decOffsets}
    </button>
  </div>

  <button
    type="button"
    class="direction-toggle"
    class:backward={insertDirection === 'backward'}
    aria-label={
      insertDirection === 'forward'
        ? strings.toolbar.forwardInsertTitle
        : strings.toolbar.backwardInsertTitle
    }
    aria-pressed={insertDirection === 'backward'}
    title={
      insertDirection === 'forward'
        ? strings.toolbar.forwardInsertTitle
        : strings.toolbar.backwardInsertTitle
    }
    onclick={() =>
      onInsertDirection(insertDirection === 'forward' ? 'backward' : 'forward')}
  >
    {#if insertDirection === 'forward'}
      &rarr;
    {:else}
      &larr;
    {/if}
  </button>

  <button
    type="button"
    class="toolbar-toggle"
    class:active={searchPanelVisible}
    aria-pressed={searchPanelVisible}
    title={
      searchPanelVisible
        ? strings.toolbar.hideSearchPanelTitle
        : strings.toolbar.showSearchPanelTitle
    }
    onclick={onToggleSearchPanel}
  >
    {strings.toolbar.searchPanel}
  </button>

  <OffsetJump {fileSize} {offsetRadix} {onGoToOffset} />

  <div class="toolbar-group">
    <TransformPanel
      plugins={transformPlugins}
      {contentSources}
      pluginsLoaded={transformPluginsLoaded}
      pluginsLoading={transformPluginsLoading}
      busy={transformInFlight}
      error={transformPluginError}
      {fileSize}
      {selectedOffset}
      {selectionStart}
      {selectionEnd}
      {selectionLength}
      {offsetRadix}
      feedback={transformFeedback}
      results={transformResults}
      {activeTransformResultId}
      {onRequestTransforms}
      {onApplyTransform}
      {onExportRange}
      {onInsertFile}
      {onReplaceRangeWithFile}
      {onOpenTransformResult}
      {onCreateCheckpoint}
      {onRollbackCheckpoint}
      {onRestoreCheckpoint}
      {onExportChangeLog}
      {onApplyChangeLog}
    />
  </div>
</div>
