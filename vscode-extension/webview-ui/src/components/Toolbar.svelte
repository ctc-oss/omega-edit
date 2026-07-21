<script lang="ts">
  import {
    TEXT_ENCODING_OPTIONS,
    type BytesPerRow,
    type TextEncoding,
    type WebviewSessionContentInfo,
    type WebviewSessionContentSource,
    type WebviewTransformPlugin,
  } from '../protocol'
  import { strings } from '../i18n'
  import BytesPerRowCombobox from './BytesPerRowCombobox.svelte'
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
    actionJournalVisible?: boolean
    selectedOffset?: number
    selectionStart?: number
    selectionEnd?: number
    selectionLength?: number
    onBytesPerRow: (bytesPerRow: BytesPerRow) => void
    onOffsetRadix: (radix: 'hex' | 'dec') => void
    onTextEncoding: (encoding: TextEncoding) => void
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
    onToggleActionJournal: () => void
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
    actionJournalVisible = false,
    selectedOffset = -1,
    selectionStart = -1,
    selectionEnd = -1,
    selectionLength = 0,
    onBytesPerRow,
    onOffsetRadix,
    onTextEncoding,
    onGoToOffset,
    onRequestTransforms,
    onCancelTransform,
    onApplyTransform,
    onExportRange,
    onInsertFile,
    onReplaceRangeWithFile,
    onOpenTransformResult,
    onToggleSearchPanel,
    onToggleActionJournal,
    onCreateCheckpoint,
    onRollbackCheckpoint,
    onRestoreCheckpoint,
    onExportChangeLog,
    onApplyChangeLog,
  }: Props = $props()

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

</script>

<div class="toolbar" role="toolbar" aria-label={strings.toolbar.label}>
  <BytesPerRowCombobox {bytesPerRow} {onBytesPerRow} />

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

  <button
    type="button"
    class="toolbar-toggle"
    class:active={actionJournalVisible}
    aria-pressed={actionJournalVisible}
    title={actionJournalVisible
      ? strings.toolbar.hideActionJournalTitle
      : strings.toolbar.showActionJournalTitle}
    onclick={onToggleActionJournal}
  >
    {strings.toolbar.actionJournal}
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
