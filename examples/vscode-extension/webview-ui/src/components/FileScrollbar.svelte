<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { strings } from '../i18n'
  import type { BytesPerRow } from '../protocol'

  const MIN_THUMB_HEIGHT = 24

  interface Props {
    fileSize?: number
    visibleOffset?: number
    bytesPerRow?: BytesPerRow
    visibleRows?: number
    visibleByteCount?: number
    offsetRadix?: 'hex' | 'dec'
    onScrollTo: (offset: number) => void
  }

  let {
    fileSize = 0,
    visibleOffset = 0,
    bytesPerRow = 16,
    visibleRows = 1,
    visibleByteCount = 0,
    offsetRadix = 'hex',
    onScrollTo,
  }: Props = $props()

  let trackElement = $state<HTMLDivElement>()
  let thumbElement = $state<HTMLDivElement>()
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
    `${progress.toLocaleString(undefined, {
      maximumFractionDigits: progress >= 99.95 ? 0 : 1,
    })}%`
  )
  const currentOffsetLabel = $derived(formatOffset(visibleOffset))
  const thumbTitle = $derived(
    disabled
      ? strings.navigation.scrollbarDisabled
      : strings.navigation.scrollbarValue(currentOffsetLabel, progressLabel)
  )
  const thumbStyle = $derived({
    top: thumbTop,
    height: thumbHeight,
    opacity: disabled ? 0 : 1,
  })

  function dynamicThumbStyle(
    node: HTMLElement,
    value: { top: number; height: number; opacity: number }
  ) {
    const apply = (nextValue: {
      top: number
      height: number
      opacity: number
    }): void => {
      node.style.top = `${nextValue.top}px`
      node.style.height = `${nextValue.height}px`
      node.style.opacity = String(nextValue.opacity)
    }
    apply(value)
    return { update: apply }
  }

  function formatOffset(offset: number): string {
    return offsetRadix === 'dec'
      ? offset.toLocaleString()
      : `0x${offset.toString(16).toUpperCase()}`
  }

  function clampRow(row: number): number {
    return Math.max(0, Math.min(maxStartRow, row))
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
    onkeydown={handleKeydown}
  >
    <div
      bind:this={thumbElement}
      class="file-scrollbar-thumb"
      class:dragging
      use:dynamicThumbStyle={thumbStyle}
      title={thumbTitle}
    ></div>
  </div>
</div>
