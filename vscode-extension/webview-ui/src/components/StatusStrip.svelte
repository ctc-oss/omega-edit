<script lang="ts">
  import { formatNumber, strings } from '../i18n'
  import type { BytesPerRow, InsertDirection, TextEncoding } from '../protocol'

  interface Props {
    selectedOffset: number
    selectionStart: number
    selectionEnd: number
    selectionLength: number
    fileSize: number
    offsetRadix: 'hex' | 'dec'
    textEncoding: TextEncoding
    editMode: 'insert' | 'overwrite'
    insertDirection: InsertDirection
    bytesPerRow: BytesPerRow
  }

  let {
    selectedOffset,
    selectionStart,
    selectionEnd,
    selectionLength,
    fileSize,
    offsetRadix,
    textEncoding,
    editMode,
    insertDirection,
    bytesPerRow,
  }: Props = $props()

  function offsetLabel(offset: number): string {
    if (offset < 0) return strings.status.none
    return offsetRadix === 'dec'
      ? formatNumber(offset)
      : `0x${offset.toString(16).toUpperCase()}`
  }

  function byteCountLabel(byteCount: number): string {
    return `${formatNumber(Math.max(0, byteCount))} B`
  }
</script>

<footer class="editor-status-strip" aria-label={strings.status.editorStatus}>
  <span>{strings.status.offset}: {offsetLabel(selectedOffset)}</span>
  <span>
    {strings.status.selection}:
    {#if selectionLength > 0}
      {offsetLabel(selectionStart)}–{offsetLabel(selectionEnd)} ({byteCountLabel(selectionLength)})
    {:else}
      {strings.status.none}
    {/if}
  </span>
  <span>{strings.status.size}: {byteCountLabel(fileSize)}</span>
  <span>{textEncoding.toUpperCase()}</span>
  <span>
    {editMode === 'overwrite' ? strings.status.overwrite : strings.status.insert}
    {insertDirection === 'forward' ? '→' : '←'}
  </span>
  <span>{strings.status.bytesPerRow}: {formatNumber(bytesPerRow)}</span>
</footer>
