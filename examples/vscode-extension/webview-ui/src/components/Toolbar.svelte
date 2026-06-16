<script lang="ts">
  import type { BytesPerRow, WebviewTransformPlugin } from '../protocol'
  import { strings } from '../i18n'
  import OffsetJump from './OffsetJump.svelte'
  import TransformPanel from './TransformPanel.svelte'

  interface Props {
    bytesPerRow: BytesPerRow
    offsetRadix?: 'hex' | 'dec'
    fileSize?: number
    transformPlugins?: WebviewTransformPlugin[]
    transformPluginsLoaded?: boolean
    transformPluginsLoading?: boolean
    transformPluginError?: string
    transformFeedback?: string
    selectionStart?: number
    selectionEnd?: number
    selectionLength?: number
    onBytesPerRow: (bytesPerRow: BytesPerRow) => void
    onOffsetRadix: (radix: 'hex' | 'dec') => void
    onGoToOffset: (offset: number) => void
    onRequestTransforms: () => void
    onApplyTransform: (pluginId: string, optionsJson?: string) => void
  }

  let {
    bytesPerRow,
    offsetRadix = 'hex',
    fileSize = 0,
    transformPlugins = [],
    transformPluginsLoaded = false,
    transformPluginsLoading = false,
    transformPluginError = '',
    transformFeedback = '',
    selectionStart = -1,
    selectionEnd = -1,
    selectionLength = 0,
    onBytesPerRow,
    onOffsetRadix,
    onGoToOffset,
    onRequestTransforms,
    onApplyTransform,
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
      onclick={() => onOffsetRadix('hex')}
    >
      {strings.toolbar.hexOffsets}
    </button>
    <button
      type="button"
      class:active={offsetRadix === 'dec'}
      aria-pressed={offsetRadix === 'dec'}
      onclick={() => onOffsetRadix('dec')}
    >
      {strings.toolbar.decOffsets}
    </button>
  </div>

  <OffsetJump {fileSize} {offsetRadix} {onGoToOffset} />

  <div class="toolbar-group">
    <TransformPanel
      plugins={transformPlugins}
      pluginsLoaded={transformPluginsLoaded}
      pluginsLoading={transformPluginsLoading}
      error={transformPluginError}
      {selectionStart}
      {selectionEnd}
      {selectionLength}
      {offsetRadix}
      feedback={transformFeedback}
      {onRequestTransforms}
      {onApplyTransform}
    />
  </div>
</div>
