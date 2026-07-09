<script lang="ts">
  import {
    FIXED_BYTES_PER_ROW_OPTIONS,
    MAX_BYTES_PER_ROW,
    MIN_BYTES_PER_ROW,
    TEXT_ENCODING_OPTIONS,
    normalizeBytesPerRow,
    type BytesPerRow,
    type InsertDirection,
    type TextEncoding,
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
    offsetRadix?: 'hex' | 'dec'
    textEncoding?: TextEncoding
    insertDirection?: InsertDirection
    fileSize?: number
    contentSources?: WebviewSessionContentInfo[]
    transformPlugins?: WebviewTransformPlugin[]
    transformPluginsLoaded?: boolean
    transformPluginsLoading?: boolean
    transformInFlight?: boolean
    transformCancelable?: boolean
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
    onOffsetRadix: (radix: 'hex' | 'dec') => void
    onTextEncoding: (encoding: TextEncoding) => void
    onInsertDirection: (direction: InsertDirection) => void
    onGoToOffset: (offset: number) => void
    onRequestTransforms: () => void
    onCancelTransform: () => void
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
    offsetRadix = 'hex',
    textEncoding = 'ascii',
    insertDirection = 'forward',
    fileSize = 0,
    contentSources = [],
    transformPlugins = [],
    transformPluginsLoaded = false,
    transformPluginsLoading = false,
    transformInFlight = false,
    transformCancelable = false,
    transformPluginError = '',
    transformFeedback = '',
    transformResults = [],
    activeTransformResultId = '',
    searchPanelVisible = false,
    selectedOffset = -1,
    selectionStart = -1,
    selectionEnd = -1,
    selectionLength = 0,
    onBytesPerRow,
    onOffsetRadix,
    onTextEncoding,
    onInsertDirection,
    onGoToOffset,
    onRequestTransforms,
    onCancelTransform,
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
  const bytesPerRowSelectValue = $derived(
    rowOptions.includes(bytesPerRow as (typeof rowOptions)[number])
      ? String(bytesPerRow)
      : 'custom'
  )

  function textEncodingLabel(encoding: TextEncoding): string {
    switch (encoding) {
      case 'ascii':
        return strings.encoding.ascii
      case 'windows-1252':
        return strings.encoding.windows1252
      case 'cp437':
        return strings.encoding.cp437
      case 'ebcdic-037':
        return strings.encoding.ebcdic037
      case 'macroman':
        return strings.encoding.macRoman
    }
  }

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

  function handleBytesPerRowSelect(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value
    if (value === 'custom') {
      return
    }
    onBytesPerRow(clampBytesPerRow(Number.parseInt(value, 10)))
  }

  function handleOffsetRadixSelect(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value
    onOffsetRadix(value === 'dec' ? 'dec' : 'hex')
  }

  function handleTextEncodingSelect(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value
    if (TEXT_ENCODING_OPTIONS.includes(value as TextEncoding)) {
      onTextEncoding(value as TextEncoding)
    }
  }

  function commitCustomBytesPerRow(force = false): void {
    const nextBytesPerRow = clampBytesPerRow(
      Number.parseInt(customBytesPerRowValue, 10)
    )
    customBytesPerRowValue = String(nextBytesPerRow)
    if (!force && nextBytesPerRow === bytesPerRow) {
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
    <label class="toolbar-select-control">
      <span>{strings.toolbar.bytesPerRowSelect}</span>
      <select
        class="toolbar-select bytes-per-row-select"
        value={bytesPerRowSelectValue}
        aria-label={strings.toolbar.bytesPerRow}
        title={strings.toolbar.bytesPerRowTitle(bytesPerRow)}
        onchange={handleBytesPerRowSelect}
      >
        {#each rowOptions as option}
          <option value={option}>{option}</option>
        {/each}
        <option value="custom">{strings.toolbar.customBytesPerRowOption}</option>
      </select>
    </label>
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

  <label class="toolbar-select-control">
    <span>{strings.toolbar.offsetRadix}</span>
    <select
      class="toolbar-select offset-radix-select"
      value={offsetRadix}
      aria-label={strings.toolbar.offsetRadix}
      title={strings.toolbar.offsetRadixTitle(
        offsetRadix === 'hex'
          ? strings.toolbar.hexOffsets
          : strings.toolbar.decOffsets
      )}
      onchange={handleOffsetRadixSelect}
    >
      <option value="hex">{strings.toolbar.hexOffsets}</option>
      <option value="dec">{strings.toolbar.decOffsets}</option>
    </select>
  </label>

  <label class="toolbar-select-control">
    <span>{strings.toolbar.textEncoding}</span>
    <select
      class="toolbar-select text-encoding-select"
      value={textEncoding}
      aria-label={strings.toolbar.textEncoding}
      title={strings.toolbar.textEncodingTitle(textEncodingLabel(textEncoding))}
      onchange={handleTextEncodingSelect}
    >
      {#each TEXT_ENCODING_OPTIONS as encoding}
        <option value={encoding}>{textEncodingLabel(encoding)}</option>
      {/each}
    </select>
  </label>

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
      cancelable={transformCancelable}
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
      {onCancelTransform}
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
