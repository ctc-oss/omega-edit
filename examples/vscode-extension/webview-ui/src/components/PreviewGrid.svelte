<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { strings } from '../i18n'
  import type { BytesPerRow, WebviewExternalHighlight } from '../protocol'

  const FALLBACK_VISIBLE_ROWS = 16

  interface Props {
    data?: number[]
    offset?: number
    bytesPerRow?: BytesPerRow
    offsetRadix?: 'hex' | 'dec'
    selectedOffset?: number
    selectionStart?: number
    selectionEnd?: number
    searchStart?: number
    searchEnd?: number
    inspectorStart?: number
    inspectorEnd?: number
    externalHighlights?: WebviewExternalHighlight[]
    activePane?: 'hex' | 'ascii'
    editMode?: 'insert' | 'overwrite'
    pendingHexLabel?: string
    onSelect: (offset: number, extend: boolean) => void
    onActivePaneChange: (pane: 'hex' | 'ascii') => void
    onMoveSelection: (delta: number, extend: boolean) => void
    onJumpToBoundary: (boundary: 'top' | 'bottom') => void
    onScroll: (direction: 'up' | 'down') => void
    onToggleEditMode: () => void
    onTypeByte: (pane: 'hex' | 'ascii', key: string) => boolean
    onDeleteByte: (backward: boolean) => boolean
    canScrollUp?: boolean
    canScrollDown?: boolean
    onVisibleRowsChange: (visibleRows: number) => void
  }

  let {
    data = [],
    offset = 0,
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
    activePane = 'hex',
    editMode = 'insert',
    pendingHexLabel = '',
    onSelect,
    onActivePaneChange,
    onMoveSelection,
    onJumpToBoundary,
    onScroll,
    onToggleEditMode,
    onTypeByte,
    onDeleteByte,
    canScrollUp = false,
    canScrollDown = false,
    onVisibleRowsChange,
  }: Props = $props()

  let gridElement = $state<HTMLDivElement>()
  let lastReportedVisibleRows = $state(0)
  let hoveredColumn = $state(-1)
  let hoveredRowIndex = $state(-1)
  let isDraggingSelection = $state(false)
  let dragPointerId = $state<number | undefined>(undefined)

  const rows = $derived(Array.from(
    { length: Math.ceil(data.length / bytesPerRow) },
    (_, rowIndex) => {
      const rowOffset = offset + rowIndex * bytesPerRow
      const bytes = data.slice(
        rowIndex * bytesPerRow,
        rowIndex * bytesPerRow + bytesPerRow
      )
      return { rowOffset, bytes }
    }
  ))
  const externalHighlightByOffset = $derived.by(() => {
    const lookup = new Map<number, WebviewExternalHighlight>()
    const visibleStart = offset
    const visibleEnd = offset + data.length
    const visibleByteCount = Math.max(0, visibleEnd - visibleStart)
    if (visibleByteCount === 0) {
      return lookup
    }

    for (const highlight of externalHighlights) {
      const start = Math.max(visibleStart, highlight.offset)
      const end = Math.min(visibleEnd, highlight.offset + highlight.length)
      for (let byteOffset = start; byteOffset < end; byteOffset += 1) {
        if (!lookup.has(byteOffset)) {
          lookup.set(byteOffset, highlight)
          if (lookup.size >= visibleByteCount) {
            return lookup
          }
        }
      }
    }

    return lookup
  })

  function formatHex(byte: number): string {
    return byte.toString(16).toUpperCase().padStart(2, '0')
  }

  function isPrintable(byte: number): boolean {
    return byte >= 0x20 && byte <= 0x7e
  }

  function isControlByte(byte: number): boolean {
    return byte < 0x20 || byte === 0x7f
  }

  function isHighBitByte(byte: number): boolean {
    return byte >= 0x80
  }

  function formatAscii(byte: number): string {
    return isPrintable(byte) ? String.fromCharCode(byte) : '.'
  }

  function formatBinary(byte: number): string {
    return `0b${byte.toString(2).padStart(8, '0')}`
  }

  function formatTooltipText(byte: number): string {
    return isPrintable(byte)
      ? `'${String.fromCharCode(byte)}'`
      : strings.grid.notPrintable
  }

  function byteClassLabel(byte: number): string {
    if (isControlByte(byte)) {
      return strings.grid.controlByte
    }
    if (isHighBitByte(byte)) {
      return strings.grid.highBitByte
    }
    return strings.grid.printableByte
  }

  function formatOffset(offset: number): string {
    return offsetRadix === 'dec'
      ? offset.toLocaleString()
      : `0x${offset.toString(16).toUpperCase().padStart(8, '0')}`
  }

  function formatHexOffset(offset: number): string {
    return `0x${offset.toString(16).toUpperCase().padStart(8, '0')}`
  }

  function formatColumnOffset(offset: number): string {
    return offsetRadix === 'dec'
      ? offset.toString().padStart(2, '0')
      : offset.toString(16).toUpperCase().padStart(2, '0')
  }

  function formatByteHoverTitle(
    pane: 'hex' | 'ascii',
    byte: number,
    byteOffset: number,
    highlight = externalHighlightFor(byteOffset)
  ): string {
    const baseTitle = strings.grid.byteHoverTitle(
      pane === 'hex' ? strings.grid.hexPane : strings.grid.textPane,
      formatOffset(byteOffset),
      formatHexOffset(byteOffset),
      byteOffset.toLocaleString(),
      formatHex(byte),
      byte.toLocaleString(),
      formatBinary(byte),
      formatTooltipText(byte),
      byteClassLabel(byte),
      editMode === 'overwrite'
        ? strings.grid.overwriteTitle
        : strings.grid.insertTitle
    )
    return highlight
      ? `${baseTitle}\n${strings.grid.externalHighlight(
          highlight.label,
          highlight.source
        )}`
      : baseTitle
  }

  function isSelected(byteOffset: number): boolean {
    return (
      selectionStart >= 0 &&
      selectionEnd >= selectionStart &&
      byteOffset >= selectionStart &&
      byteOffset <= selectionEnd
    )
  }

  function isSearchHit(byteOffset: number): boolean {
    return (
      searchStart >= 0 &&
      searchEnd >= searchStart &&
      byteOffset >= searchStart &&
      byteOffset <= searchEnd
    )
  }

  function isInspectorByte(byteOffset: number): boolean {
    return (
      inspectorStart >= 0 &&
      inspectorEnd >= inspectorStart &&
      byteOffset >= inspectorStart &&
      byteOffset <= inspectorEnd
    )
  }

  function externalHighlightFor(
    byteOffset: number
  ): WebviewExternalHighlight | undefined {
    return externalHighlightByOffset.get(byteOffset)
  }

  function updateHover(rowIndex: number, column: number): void {
    hoveredRowIndex = rowIndex
    hoveredColumn = column
  }

  function clearHover(): void {
    hoveredRowIndex = -1
    hoveredColumn = -1
  }

  function isColumnHover(column: number): boolean {
    return column === hoveredColumn
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return
    }

    const pageDelta = Math.max(
      bytesPerRow,
      data.length > 0 ? data.length : bytesPerRow * FALLBACK_VISIBLE_ROWS
    )

    switch (event.key) {
      case 'Insert':
        event.preventDefault()
        onToggleEditMode()
        break
      case 'Backspace':
        event.preventDefault()
        onDeleteByte(true)
        break
      case 'Delete':
        event.preventDefault()
        onDeleteByte(false)
        break
      case 'ArrowLeft':
        event.preventDefault()
        onMoveSelection(-1, event.shiftKey)
        break
      case 'ArrowRight':
        event.preventDefault()
        onMoveSelection(1, event.shiftKey)
        break
      case 'ArrowUp':
        event.preventDefault()
        onMoveSelection(-bytesPerRow, event.shiftKey)
        break
      case 'ArrowDown':
        event.preventDefault()
        onMoveSelection(bytesPerRow, event.shiftKey)
        break
      case 'Home':
        event.preventDefault()
        onJumpToBoundary('top')
        break
      case 'End':
        event.preventDefault()
        onJumpToBoundary('bottom')
        break
      case 'PageUp':
        event.preventDefault()
        onMoveSelection(-pageDelta, event.shiftKey)
        if (canScrollUp) {
          onScroll('up')
        }
        break
      case 'PageDown':
        event.preventDefault()
        onMoveSelection(pageDelta, event.shiftKey)
        if (canScrollDown) {
          onScroll('down')
        }
        break
      default:
        if (onTypeByte(activePane, event.key)) {
          event.preventDefault()
        }
    }
  }

  function selectPaneByte(
    pane: 'hex' | 'ascii',
    offset: number,
    extend: boolean
  ): void {
    onActivePaneChange(pane)
    onSelect(offset, extend)
  }

  function getPointerByteTarget(event: PointerEvent): {
    offset: number
    pane: 'hex' | 'ascii'
    rowIndex: number
    column: number
  } | undefined {
    const element = document.elementFromPoint(event.clientX, event.clientY)
    if (!(element instanceof HTMLElement)) {
      return undefined
    }

    const target = element.closest('[data-offset][data-pane]')
    if (!(target instanceof HTMLElement) || !gridElement?.contains(target)) {
      return undefined
    }

    const offset = Number.parseInt(target.dataset.offset ?? '', 10)
    const rowIndex = Number.parseInt(target.dataset.rowIndex ?? '', 10)
    const column = Number.parseInt(target.dataset.column ?? '', 10)
    const pane = target.dataset.pane === 'ascii' ? 'ascii' : 'hex'
    if (
      !Number.isInteger(offset) ||
      !Number.isInteger(rowIndex) ||
      !Number.isInteger(column)
    ) {
      return undefined
    }

    return { offset, pane, rowIndex, column }
  }

  function handlePointerDown(
    pane: 'hex' | 'ascii',
    offset: number,
    rowIndex: number,
    column: number,
    event: PointerEvent
  ): void {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    gridElement?.focus()
    selectPaneByte(pane, offset, event.shiftKey)
    updateHover(rowIndex, column)
    isDraggingSelection = true
    dragPointerId = event.pointerId
    gridElement?.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: PointerEvent): void {
    const target = getPointerByteTarget(event)
    if (!target) {
      return
    }

    updateHover(target.rowIndex, target.column)
    if (isDraggingSelection && event.pointerId === dragPointerId) {
      event.preventDefault()
      onSelect(target.offset, true)
    }
  }

  function stopDraggingSelection(event: PointerEvent): void {
    if (!isDraggingSelection || event.pointerId !== dragPointerId) {
      return
    }

    if (gridElement?.hasPointerCapture(event.pointerId)) {
      gridElement.releasePointerCapture(event.pointerId)
    }
    isDraggingSelection = false
    dragPointerId = undefined
  }

  function handlePointerLeave(): void {
    if (!isDraggingSelection) {
      clearHover()
    }
  }

  function handleWheel(event: WheelEvent): void {
    if (event.deltaY === 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const direction = event.deltaY < 0 ? 'up' : 'down'
    if (direction === 'up' ? canScrollUp : canScrollDown) {
      onScroll(direction)
    }
  }

  function reportVisibleRows(): void {
    if (!gridElement) {
      return
    }

    const header = gridElement.querySelector('.grid-header')
    const row = gridElement.querySelector('.grid-row')
    const headerHeight = header?.getBoundingClientRect().height ?? 24
    const rowHeight = row?.getBoundingClientRect().height ?? 24
    const availableHeight = Math.max(0, gridElement.clientHeight - headerHeight)
    const nextVisibleRows = Math.max(1, Math.floor(availableHeight / rowHeight))

    if (nextVisibleRows !== lastReportedVisibleRows) {
      lastReportedVisibleRows = nextVisibleRows
      onVisibleRowsChange(nextVisibleRows)
    }
  }

  async function reportVisibleRowsAfterRender(): Promise<void> {
    await tick()
    reportVisibleRows()
  }

  $effect(() => {
    if (gridElement && bytesPerRow && data.length >= 0) {
      void reportVisibleRowsAfterRender()
    }
  })

  onMount(() => {
    const observer = new ResizeObserver(() => {
      reportVisibleRows()
    })
    if (gridElement) {
      observer.observe(gridElement)
    }
    reportVisibleRows()
    return () => observer.disconnect()
  })
</script>

<div
  id="previewGrid"
  bind:this={gridElement}
  class={`preview-grid bytes-${bytesPerRow}`}
  class:overwrite={editMode === 'overwrite'}
  role="grid"
  tabindex="0"
  aria-label={strings.grid.label}
  aria-colcount={1 + bytesPerRow * 2}
  aria-rowcount={rows.length + 1}
  onkeydown={handleKeydown}
  onpointermove={handlePointerMove}
  onpointerup={stopDraggingSelection}
  onpointercancel={stopDraggingSelection}
  onpointerleave={handlePointerLeave}
  onwheel={handleWheel}
>
  <div class="grid-header" role="row" aria-rowindex="1">
    <span class="offset-heading" role="columnheader" aria-colindex="1">
      {strings.grid.offset}
    </span>
    <div class="hex-heading" role="presentation">
      {#each Array.from({ length: bytesPerRow }) as _, index}
        <span
          class:hover={index === hoveredColumn}
          role="columnheader"
          aria-colindex={index + 2}
        >
          {formatColumnOffset(index)}
        </span>
      {/each}
    </div>
    <span
      class="ascii-heading"
      role="columnheader"
      aria-colindex={bytesPerRow + 2}
      aria-colspan={bytesPerRow}
    >
      {strings.grid.text}
    </span>
  </div>

  {#if rows.length === 0}
    <div class="empty-row">{strings.grid.waitingForData}</div>
  {:else}
    {#each rows as row, rowIndex}
      <div
        class="grid-row"
        data-row-index={rowIndex}
        role="row"
        aria-rowindex={rowIndex + 2}
      >
        <span
          class="offset"
          class:hover={rowIndex === hoveredRowIndex}
          role="rowheader"
          aria-colindex="1"
        >
          {formatOffset(row.rowOffset)}
        </span>
        <div class="hex-cells" role="presentation">
          {#each row.bytes as byte, index}
            {@const byteOffset = row.rowOffset + index}
            {@const externalHighlight = externalHighlightFor(byteOffset)}
            {@const externalKind = externalHighlight?.kind ?? ''}
            {@const byteTitle = formatByteHoverTitle(
              'hex',
              byte,
              byteOffset,
              externalHighlight
            )}
            <button
              type="button"
              class="byte"
              class:columnHover={isColumnHover(index)}
              class:searchHit={isSearchHit(byteOffset)}
              class:inspectorRange={isInspectorByte(byteOffset)}
              class:externalHighlight={!!externalHighlight}
              class:externalCurrent={externalKind === 'current'}
              class:externalParsed={externalKind === 'parsed'}
              class:externalError={externalKind === 'error'}
              class:externalWarning={externalKind === 'warning'}
              class:externalBreakpoint={externalKind === 'breakpoint'}
              class:externalSecondary={externalKind === 'secondary'}
              class:selected={isSelected(byteOffset)}
              class:focused={byteOffset === selectedOffset}
              class:activePane={activePane === 'hex' && byteOffset === selectedOffset}
              data-column={index}
              data-offset={byteOffset}
              data-pane="hex"
              data-row-index={rowIndex}
              role="gridcell"
              aria-colindex={index + 2}
              aria-selected={isSelected(byteOffset)}
              aria-label={byteTitle}
              title={byteTitle}
              onpointerdown={(event) =>
                handlePointerDown('hex', byteOffset, rowIndex, index, event)}
            >
              {activePane === 'hex' &&
              byteOffset === selectedOffset &&
              pendingHexLabel
                ? pendingHexLabel
                : formatHex(byte)}
            </button>
          {/each}
        </div>
        <span class="ascii" role="presentation">
          {#each row.bytes as byte, index}
            {@const byteOffset = row.rowOffset + index}
            {@const externalHighlight = externalHighlightFor(byteOffset)}
            {@const externalKind = externalHighlight?.kind ?? ''}
            {@const byteTitle = formatByteHoverTitle(
              'ascii',
              byte,
              byteOffset,
              externalHighlight
            )}
            <button
              type="button"
              class="text-byte"
              class:printable={isPrintable(byte)}
              class:control={isControlByte(byte)}
              class:high-bit={isHighBitByte(byte)}
              class:columnHover={isColumnHover(index)}
              class:searchHit={isSearchHit(byteOffset)}
              class:inspectorRange={isInspectorByte(byteOffset)}
              class:externalHighlight={!!externalHighlight}
              class:externalCurrent={externalKind === 'current'}
              class:externalParsed={externalKind === 'parsed'}
              class:externalError={externalKind === 'error'}
              class:externalWarning={externalKind === 'warning'}
              class:externalBreakpoint={externalKind === 'breakpoint'}
              class:externalSecondary={externalKind === 'secondary'}
              class:selected={isSelected(byteOffset)}
              class:focused={byteOffset === selectedOffset}
              class:activePane={activePane === 'ascii' && byteOffset === selectedOffset}
              data-column={index}
              data-offset={byteOffset}
              data-pane="ascii"
              data-row-index={rowIndex}
              role="gridcell"
              aria-colindex={bytesPerRow + index + 2}
              aria-selected={isSelected(byteOffset)}
              aria-label={byteTitle}
              title={byteTitle}
              onpointerdown={(event) =>
                handlePointerDown('ascii', byteOffset, rowIndex, index, event)}
            >
              {formatAscii(byte)}
            </button>
          {/each}
        </span>
      </div>
    {/each}
  {/if}
</div>
