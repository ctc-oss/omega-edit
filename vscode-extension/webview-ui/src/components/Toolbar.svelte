<script lang="ts">
  import type {
    BytesPerRow,
    InsertDirection,
    WebviewTransformPlugin,
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
    insertDirection?: InsertDirection
    fileSize?: number
    transformPlugins?: WebviewTransformPlugin[]
    transformPluginsLoaded?: boolean
    transformPluginsLoading?: boolean
    transformInFlight?: boolean
    transformPluginError?: string
    transformFeedback?: string
    transformResults?: TransformResultHistoryItem[]
    activeTransformResultId?: string
    selectedOffset?: number
    selectionStart?: number
    selectionEnd?: number
    selectionLength?: number
    onBytesPerRow: (bytesPerRow: BytesPerRow) => void
    onOffsetRadix: (radix: 'hex' | 'dec') => void
    onInsertDirection: (direction: InsertDirection) => void
    onGoToOffset: (offset: number) => void
    onRequestTransforms: () => void
    onApplyTransform: (
      pluginId: string,
      offset: number,
      length: number,
      optionsJson?: string
    ) => void
    onExportRange: (offset: number, length: number) => void
    onInsertFile: (offset: number) => void
    onReplaceRangeWithFile: (offset: number, length: number) => void
    onOpenTransformResult: (resultId: string) => void
  }

  let {
    bytesPerRow,
    offsetRadix = 'hex',
    insertDirection = 'forward',
    fileSize = 0,
    transformPlugins = [],
    transformPluginsLoaded = false,
    transformPluginsLoading = false,
    transformInFlight = false,
    transformPluginError = '',
    transformFeedback = '',
    transformResults = [],
    activeTransformResultId = '',
    selectedOffset = -1,
    selectionStart = -1,
    selectionEnd = -1,
    selectionLength = 0,
    onBytesPerRow,
    onOffsetRadix,
    onInsertDirection,
    onGoToOffset,
    onRequestTransforms,
    onApplyTransform,
    onExportRange,
    onInsertFile,
    onReplaceRangeWithFile,
    onOpenTransformResult,
  }: Props = $props()

  const rowOptions: BytesPerRow[] = [8, 16, 32]
</script>

<div class="toolbar" role="toolbar" aria-label={strings.toolbar.label}>
  <div class="segmented" aria-label={strings.toolbar.bytesPerRow}>
    {#each rowOptions as option}
      <button
        type="button"
        class:active={option === bytesPerRow}
        aria-pressed={option === bytesPerRow}
        title={strings.toolbar.bytesPerRowTitle(option)}
        onclick={() => onBytesPerRow(option)}
      >
        {option}
      </button>
    {/each}
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

  <OffsetJump {fileSize} {offsetRadix} {onGoToOffset} />

  <div class="toolbar-group">
    <TransformPanel
      plugins={transformPlugins}
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
    />
  </div>
</div>
