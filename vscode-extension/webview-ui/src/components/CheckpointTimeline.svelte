<script lang="ts">
  import { formatNumber, strings } from '../i18n'

  const MAX_VISIBLE_MARKERS = 40

  interface CheckpointMarker {
    checkpoint: number
    changeCount: number
    createdAt: number
    available: boolean
    error?: string
  }

  interface Props {
    cursor: number
    checkpointCount: number
    savedChangeCount: number
    savedCheckpoint?: number
    savedOffBranch: boolean
    canRewind: boolean
    canFastForward: boolean
    checkpoints: CheckpointMarker[]
    navigating?: boolean
    onNavigate: (checkpoint: number) => void
    onClose: () => void
  }

  let {
    cursor,
    checkpointCount,
    savedChangeCount,
    savedCheckpoint,
    savedOffBranch,
    canRewind,
    canFastForward,
    checkpoints,
    navigating = false,
    onNavigate,
    onClose,
  }: Props = $props()

  function handleChange(event: Event): void {
    if (navigating) return
    const target = Number.parseInt((event.currentTarget as HTMLInputElement).value, 10)
    if (Number.isInteger(target) && target !== cursor) {
      onNavigate(target)
    }
  }

  function unavailableCount(): number {
    return checkpoints.filter((checkpoint) => !checkpoint.available).length
  }

  const visibleCheckpoints = $derived.by(() => {
    if (checkpoints.length <= MAX_VISIBLE_MARKERS) return checkpoints
    const edgeCount = Math.floor(MAX_VISIBLE_MARKERS / 2)
    const candidates = [
      ...checkpoints.slice(0, edgeCount),
      ...checkpoints.slice(-edgeCount),
    ]
    const saved = checkpoints.find(
      (checkpoint) => checkpoint.checkpoint === savedCheckpoint
    )
    if (saved) candidates.push(saved)
    return [...new Map(candidates.map((item) => [item.checkpoint, item])).values()].sort(
      (left, right) => left.checkpoint - right.checkpoint
    )
  })

  const savedPositionText = $derived(
    savedOffBranch
      ? strings.timeline.savedOffBranch
      : savedCheckpoint === undefined
        ? strings.timeline.savedAtChange(savedChangeCount)
        : savedCheckpoint === 0
          ? strings.timeline.savedAtOriginal
          : strings.timeline.savedAtCheckpoint(savedCheckpoint)
  )
</script>

<section
  class="checkpoint-timeline"
  aria-label={strings.timeline.label}
  aria-busy={navigating}
>
  <div class="timeline-heading">
    <strong>{strings.timeline.label}</strong>
    <span id="timeline-state" aria-live="polite">
      {navigating
        ? strings.timeline.navigating
        : strings.timeline.position(cursor === 0 ? strings.timeline.original : strings.timeline.checkpoint(cursor), checkpointCount)}
    </span>
    <span id="timeline-saved" class:saved-off-branch={savedOffBranch} class="saved-position">
      {savedOffBranch
        ? strings.timeline.savedOffBranch
        : savedCheckpoint === undefined
        ? strings.timeline.savedAtChange(savedChangeCount)
        : savedCheckpoint === 0
          ? strings.timeline.savedAtOriginal
          : strings.timeline.savedAtCheckpoint(savedCheckpoint)}
    </span>
  </div>
  <button
    type="button"
    class="timeline-step"
    aria-label={strings.timeline.previous}
    title={strings.timeline.previousTitle}
    disabled={navigating || !canRewind}
    onclick={() => onNavigate(cursor - 1)}
  >&#x25C0;</button>
  <input
    class="timeline-slider"
    type="range"
    min="0"
    max={checkpointCount}
    step="1"
    value={cursor}
    aria-label={strings.timeline.current}
    aria-describedby="timeline-state timeline-saved timeline-availability"
    aria-valuetext={`${cursor === 0 ? strings.timeline.original : strings.timeline.checkpoint(cursor)}; ${savedPositionText}`}
    disabled={navigating || checkpointCount === 0}
    onchange={handleChange}
  />
  <button
    type="button"
    class="timeline-step"
    aria-label={strings.timeline.next}
    title={strings.timeline.nextTitle}
    disabled={navigating || !canFastForward}
    onclick={() => onNavigate(cursor + 1)}
  >&#x25B6;</button>
  <div class="timeline-markers" aria-hidden="true">
    <span class:saved={savedCheckpoint === 0}>{strings.timeline.originalMarker}</span>
    {#each visibleCheckpoints as checkpoint}
      <span
        class:saved={checkpoint.checkpoint === savedCheckpoint}
        class:unavailable={!checkpoint.available}
        title={checkpoint.available
          ? strings.timeline.marker(checkpoint.checkpoint, checkpoint.changeCount, checkpoint.checkpoint === savedCheckpoint)
          : `${strings.timeline.marker(checkpoint.checkpoint, checkpoint.changeCount, checkpoint.checkpoint === savedCheckpoint)}; ${checkpoint.error ?? strings.timeline.unavailable}`}
      >
        {formatNumber(checkpoint.checkpoint)}
      </span>
    {/each}
    {#if checkpoints.length > visibleCheckpoints.length}
      <span title={strings.timeline.hiddenMarkers(checkpoints.length - visibleCheckpoints.length)}>
        +{formatNumber(checkpoints.length - visibleCheckpoints.length)}
      </span>
    {/if}
  </div>
  <span id="timeline-availability" class="visually-hidden" aria-live="polite">
    {unavailableCount() > 0 ? strings.timeline.unavailableCount(unavailableCount()) : ''}
  </span>
  <button
    type="button"
    class="timeline-close"
    aria-label={strings.timeline.close}
    title={strings.timeline.close}
    onclick={onClose}
  >&times;</button>
</section>

<style>
  .checkpoint-timeline {
    display: grid;
    grid-template-columns: auto auto minmax(10rem, 1fr) auto auto;
    grid-template-rows: auto auto;
    align-items: center;
    gap: 0.35rem 0.6rem;
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background);
  }

  .timeline-heading {
    display: flex;
    flex-direction: column;
    min-width: 9rem;
    font-size: 0.8rem;
  }

  .timeline-heading span,
  .timeline-markers {
    color: var(--vscode-descriptionForeground);
    font-size: 0.72rem;
  }

  .saved-position {
    color: var(--vscode-charts-green, var(--vscode-descriptionForeground));
  }

  .saved-off-branch,
  .timeline-markers .unavailable {
    color: var(--vscode-errorForeground);
  }

  .timeline-markers .saved {
    color: var(--vscode-charts-green);
    font-weight: 700;
  }

  .timeline-slider {
    width: 100%;
    accent-color: var(--vscode-focusBorder);
  }

  .timeline-markers {
    grid-column: 3;
    display: flex;
    justify-content: space-between;
    overflow: hidden;
  }

  .timeline-step,
  .timeline-close {
    border: 0;
    color: var(--vscode-foreground);
    background: transparent;
    cursor: pointer;
  }

  .timeline-step:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .timeline-step:focus-visible,
  .timeline-close:focus-visible,
  .timeline-slider:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 2px;
  }

  .timeline-close {
    grid-column: 5;
    grid-row: 1 / span 2;
    align-self: start;
    font-size: 1.1rem;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @media (forced-colors: active) {
    .checkpoint-timeline {
      border-bottom: 1px solid CanvasText;
    }

    .timeline-markers .saved,
    .timeline-markers .unavailable,
    .saved-position,
    .saved-off-branch {
      color: CanvasText;
    }

    .timeline-step:focus-visible,
    .timeline-close:focus-visible,
    .timeline-slider:focus-visible {
      outline: 2px solid Highlight;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .checkpoint-timeline,
    .checkpoint-timeline * {
      scroll-behavior: auto;
      transition-duration: 0s;
      animation-duration: 0s;
    }
  }
</style>
