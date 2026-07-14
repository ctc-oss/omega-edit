<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { formatNumber, strings } from '../i18n'
  import type { BytesPerRow, WebviewExternalHighlight } from '../protocol'

  const MIN_THUMB_HEIGHT = 24
  const MIN_RANGE_MARKER_HEIGHT = 2
  // Must match the number of data-external-color selectors (0..N-1) defined in styles.css
  const EXTERNAL_HIGHLIGHT_COLOR_COUNT = 12

  interface RangeMarker {
    highlight: WebviewExternalHighlight
    top: number
    height: number
    colorSlot: string
  }

  interface Props {
    fileSize?: number
    visibleOffset?: number
    bytesPerRow?: BytesPerRow
    visibleRows?: number
    visibleByteCount?: number
    offsetRadix?: 'hex' | 'dec'
    selectionStart?: number
    selectionEnd?: number
    externalHighlights?: WebviewExternalHighlight[]
    hoveredExternalHighlightId?: string
    onScrollTo: (offset: number) => void
    onExternalHighlightHover?: (id: string | undefined) => void
    onExternalHighlightEmphasis?: (id: string | undefined) => void
  }

  let {
    fileSize = 0,
    visibleOffset = 0,
    bytesPerRow = 16,
    visibleRows = 1,
    visibleByteCount = 0,
    offsetRadix = 'hex',
    selectionStart = -1,
    selectionEnd = -1,
    externalHighlights = [],
    hoveredExternalHighlightId,
    onScrollTo,
    onExternalHighlightHover = () => {},
    onExternalHighlightEmphasis = () => {},
  }: Props = $props()

  let trackElement = $state<HTMLDivElement>()
  let thumbElement = $state<SVGRectElement>()
  let trackHeight = $state(0)
  let dragging = $state(false)
  let dragPointerId = $state<number | undefined>(undefined)
  let dragOffsetY = $state(0)
  let pendingScrollOffset = $state<number | undefined>(undefined)
  let scrollAnimationFrame: number | undefined

  const totalRows = $derived(
    Math.max(1, Math.ceil(Math.max(0, fileSize) / bytesPerRow))
  )
  const renderedRows = $derived(Math.max(1, Math.ceil(visibleByteCount / bytesPerRow)))
  const viewportRows = $derived(Math.max(1, visibleRows || renderedRows))
  const maxStartRow = $derived(Math.max(0, totalRows - viewportRows))
  const currentStartRow = $derived(
    Math.max(0, Math.min(maxStartRow, Math.floor(visibleOffset / bytesPerRow)))
  )
  const maxOffset = $derived(maxStartRow * bytesPerRow)
  const disabled = $derived(fileSize <= 0 || maxStartRow <= 0 || trackHeight <= 0)
  const thumbHeight = $derived(
    disabled
      ? Math.max(0, trackHeight)
      : Math.min(
          trackHeight,
          Math.max(
            MIN_THUMB_HEIGHT,
            Math.round((viewportRows / totalRows) * trackHeight)
          )
        )
  )
  const thumbTravel = $derived(Math.max(0, trackHeight - thumbHeight))
  const thumbTop = $derived(
    disabled || maxStartRow === 0
      ? 0
      : Math.round((currentStartRow / maxStartRow) * thumbTravel)
  )
  const progress = $derived(
    fileSize > 0 && visibleOffset + visibleByteCount >= fileSize
      ? 100
      : maxOffset > 0
        ? Math.max(0, Math.min(99.9, (visibleOffset / maxOffset) * 100))
        : 100
  )
  const progressLabel = $derived(
    `${formatNumber(progress, {
      maximumFractionDigits: progress >= 99.95 ? 0 : 1,
    })}%`
  )
  const currentOffsetLabel = $derived(formatOffset(visibleOffset))
  const thumbTitle = $derived(
    disabled
      ? strings.navigation.scrollbarDisabled
      : strings.navigation.scrollbarValue(currentOffsetLabel, progressLabel)
  )
  const thumbViewBoxHeight = $derived(Math.max(1, trackHeight))
  const safeThumbHeight = $derived(Math.min(thumbViewBoxHeight, thumbHeight))
  const safeThumbTop = $derived(
    Math.max(0, Math.min(thumbViewBoxHeight - safeThumbHeight, thumbTop))
  )
  const rangeMarkers = $derived(buildRangeMarkers())

  function formatOffset(offset: number): string {
    return offsetRadix === 'dec'
      ? formatNumber(offset)
      : `0x${offset.toString(16).toUpperCase()}`
  }

  function clampRow(row: number): number {
    return Math.max(0, Math.min(maxStartRow, row))
  }

  function clampNumber(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
  }

  function hashExternalHighlightId(id: string): number {
    let hash = 0
    for (let index = 0; index < id.length; index += 1) {
      hash = (hash * 31 + id.charCodeAt(index)) >>> 0
    }
    return hash
  }

  function externalHighlightColorSlot(highlight: WebviewExternalHighlight): string {
    return String(
      hashExternalHighlightId(highlight.id) % EXTERNAL_HIGHLIGHT_COLOR_COUNT
    )
  }

  function rangeMarkerTitle(highlight: WebviewExternalHighlight): string {
    const endOffset = Math.max(highlight.offset, highlight.offset + highlight.length - 1)
    const staleSuffix = highlight.stale
      ? `\n${strings.grid.externalHighlightStale}`
      : ''
    return `${strings.grid.externalHighlight(
      highlight.label,
      highlight.source
    )}\n${formatOffset(highlight.offset)} - ${formatOffset(endOffset)}${staleSuffix}`
  }

  function buildRangeMarkers(): RangeMarker[] {
    if (fileSize <= 0 || trackHeight <= 0) {
      return []
    }

    const markers: RangeMarker[] = []
    for (const highlight of externalHighlights) {
      if (highlight.length <= 0) {
        continue
      }

      const start = clampNumber(highlight.offset, 0, fileSize)
      const end = clampNumber(highlight.offset + highlight.length, start, fileSize)
      if (end <= start) {
        continue
      }

      const rawTop = (start / fileSize) * thumbViewBoxHeight
      const rawBottom = (end / fileSize) * thumbViewBoxHeight
      const height = Math.min(
        thumbViewBoxHeight,
        Math.max(MIN_RANGE_MARKER_HEIGHT, rawBottom - rawTop)
      )
      const top = clampNumber(rawTop, 0, Math.max(0, thumbViewBoxHeight - height))
      markers.push({
        highlight,
        top,
        height,
        colorSlot: externalHighlightColorSlot(highlight),
      })
    }

    return markers
  }

  function isRangeMarkerSelected(highlight: WebviewExternalHighlight): boolean {
    return (
      selectionStart === highlight.offset &&
      selectionEnd === highlight.offset + highlight.length - 1
    )
  }

  function isRangeMarkerHovered(highlight: WebviewExternalHighlight): boolean {
    return hoveredExternalHighlightId === highlight.id
  }

  function scrollToRangeMarker(highlight: WebviewExternalHighlight): void {
    scrollToRow(Math.floor(Math.max(0, highlight.offset) / bytesPerRow))
  }

  function activateRangeMarker(highlight: WebviewExternalHighlight): void {
    scrollToRangeMarker(highlight)
    onExternalHighlightEmphasis(highlight.id)
  }

  function handleRangeMarkerPointerDown(
    highlight: WebviewExternalHighlight,
    event: PointerEvent
  ): void {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    trackElement?.focus()
    activateRangeMarker(highlight)
  }

  function handleRangeMarkerKeydown(
    highlight: WebviewExternalHighlight,
    event: KeyboardEvent
  ): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    activateRangeMarker(highlight)
  }

  function queueScrollToOffset(offset: number): void {
    pendingScrollOffset = Math.max(0, Math.min(maxOffset, offset))
    if (scrollAnimationFrame !== undefined) {
      return
    }

    scrollAnimationFrame = requestAnimationFrame(() => {
      scrollAnimationFrame = undefined
      const nextOffset = pendingScrollOffset
      pendingScrollOffset = undefined
      if (nextOffset !== undefined) {
        onScrollTo(nextOffset)
      }
    })
  }

  function scrollToRow(row: number): void {
    if (fileSize <= 0) {
      return
    }
    queueScrollToOffset(clampRow(row) * bytesPerRow)
  }

  function scrollFromTrackPosition(clientY: number, offsetWithinThumb: number): void {
    if (!trackElement || disabled) {
      return
    }

    const rect = trackElement.getBoundingClientRect()
    const rawY = clientY - rect.top - offsetWithinThumb
    const thumbY = Math.max(0, Math.min(thumbTravel, rawY))
    const ratio = thumbTravel === 0 ? 0 : thumbY / thumbTravel
    scrollToRow(Math.round(ratio * maxStartRow))
  }

  function startDrag(event: PointerEvent, offsetWithinThumb: number): void {
    if (disabled || !trackElement) {
      return
    }

    dragging = true
    dragPointerId = event.pointerId
    dragOffsetY = offsetWithinThumb
    trackElement.setPointerCapture(event.pointerId)
    scrollFromTrackPosition(event.clientY, offsetWithinThumb)
  }

  function stopDrag(event: PointerEvent): void {
    if (!dragging || event.pointerId !== dragPointerId) {
      return
    }

    if (trackElement?.hasPointerCapture(event.pointerId)) {
      trackElement.releasePointerCapture(event.pointerId)
    }
    dragging = false
    dragPointerId = undefined
    dragOffsetY = 0
  }

  function handlePointerDown(event: PointerEvent): void {
    if (disabled || event.button !== 0) {
      return
    }

    event.preventDefault()
    const target = event.target
    const offsetWithinThumb =
      target === thumbElement && thumbElement
        ? Math.max(
            0,
            Math.min(
              thumbHeight,
              event.clientY - thumbElement.getBoundingClientRect().top
            )
          )
        : thumbHeight / 2
    startDrag(event, offsetWithinThumb)
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!dragging || event.pointerId !== dragPointerId) {
      return
    }

    event.preventDefault()
    scrollFromTrackPosition(event.clientY, dragOffsetY)
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (disabled) {
      return
    }

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault()
        scrollToRow(currentStartRow - 1)
        break
      case 'ArrowDown':
        event.preventDefault()
        scrollToRow(currentStartRow + 1)
        break
      case 'PageUp':
        event.preventDefault()
        scrollToRow(currentStartRow - viewportRows)
        break
      case 'PageDown':
        event.preventDefault()
        scrollToRow(currentStartRow + viewportRows)
        break
      case 'Home':
        event.preventDefault()
        scrollToRow(0)
        break
      case 'End':
        event.preventDefault()
        scrollToRow(maxStartRow)
        break
    }
  }

  onMount(() => {
    if (!trackElement) {
      return
    }

    const observer = new ResizeObserver(([entry]) => {
      trackHeight = Math.max(0, Math.floor(entry.contentRect.height))
    })
    observer.observe(trackElement)
    trackHeight = Math.max(0, Math.floor(trackElement.getBoundingClientRect().height))
    return () => observer.disconnect()
  })

  onDestroy(() => {
    if (scrollAnimationFrame !== undefined) {
      cancelAnimationFrame(scrollAnimationFrame)
    }
  })
</script>

<div class="file-scrollbar" class:dragging>
  <div
    bind:this={trackElement}
    class="file-scrollbar-track"
    class:disabled
    role="scrollbar"
    aria-controls="previewGrid"
    aria-label={strings.navigation.scrollbarLabel}
    aria-orientation="vertical"
    aria-valuemin={0}
    aria-valuemax={maxOffset}
    aria-valuenow={Math.min(maxOffset, Math.max(0, visibleOffset))}
    aria-valuetext={thumbTitle}
    tabindex={disabled ? -1 : 0}
    title={thumbTitle}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={stopDrag}
    onpointercancel={stopDrag}
    onpointerleave={() => onExternalHighlightHover(undefined)}
    onkeydown={handleKeydown}
  >
    <svg
      class="file-scrollbar-svg"
      viewBox={`0 0 14 ${thumbViewBoxHeight}`}
      preserveAspectRatio="none"
    >
      {#each rangeMarkers as marker (marker.highlight.id)}
        <rect
          class="file-scrollbar-range-marker"
          class:hovered={isRangeMarkerHovered(marker.highlight)}
          class:selected={isRangeMarkerSelected(marker.highlight)}
          class:stale={marker.highlight.stale === true}
          data-external-color={marker.colorSlot}
          x="1"
          y={marker.top}
          width="12"
          height={marker.height}
          rx="1.5"
          role="button"
          tabindex="0"
          aria-label={rangeMarkerTitle(marker.highlight)}
          onpointerdown={(event) =>
            handleRangeMarkerPointerDown(marker.highlight, event)}
          onpointerenter={() => onExternalHighlightHover(marker.highlight.id)}
          onpointerleave={() => onExternalHighlightHover(undefined)}
          onkeydown={(event) =>
            handleRangeMarkerKeydown(marker.highlight, event)}
        >
          <title>{rangeMarkerTitle(marker.highlight)}</title>
        </rect>
      {/each}
      <rect
        bind:this={thumbElement}
        class="file-scrollbar-thumb"
        class:dragging
        x="0"
        y={safeThumbTop}
        width="14"
        height={safeThumbHeight}
        rx="3"
      ></rect>
      {#if !disabled && safeThumbHeight >= 16}
        <text
          class="file-scrollbar-thumb-glyph"
          x="7"
          y={safeThumbTop + safeThumbHeight / 2}
          aria-hidden="true"
        >
          Ω
        </text>
      {/if}
    </svg>
  </div>
</div>
