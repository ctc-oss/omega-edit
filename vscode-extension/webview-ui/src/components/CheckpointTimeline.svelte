<script lang="ts">
  import { formatNumber, strings } from '../i18n'

  const MAX_VISIBLE_MARKERS = 24

  interface CheckpointMarker {
    checkpoint: number
    changeCount: number
    sourceChangeCount: string
    replayChangeCount?: string
    byteLengthBefore: string
    byteLengthAfter: string
    archiveByteLength?: string
    boundaryKind: 'plain' | 'transform' | 'tip'
    transformPluginIds: string[]
    missingPluginIds: string[]
    optimized: boolean
    createdAt: number
    available: boolean
    error?: string
  }

  interface Props {
    cursor: number
    checkpointCount: number
    originalByteLength: string
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
    originalByteLength,
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

  function decimal(value: string): bigint {
    try {
      return BigInt(value)
    } catch {
      return 0n
    }
  }

  function formatBytes(value: string): string {
    return `${formatNumber(decimal(value))} B`
  }

  function formatDelta(before: string, after: string): string {
    const delta = decimal(after) - decimal(before)
    return `${delta > 0n ? '+' : ''}${formatNumber(delta)} B`
  }

  function boundaryLabel(kind: CheckpointMarker['boundaryKind']): string {
    switch (kind) {
      case 'transform':
        return strings.timeline.boundaryTransform
      case 'tip':
        return strings.timeline.boundaryTip
      default:
        return strings.timeline.boundaryPlain
    }
  }

  function markerTitle(checkpoint: CheckpointMarker): string {
    const parts = [
      strings.timeline.checkpoint(checkpoint.checkpoint),
      boundaryLabel(checkpoint.boundaryKind),
      strings.timeline.changesInInterval(decimal(checkpoint.sourceChangeCount)),
      `${formatBytes(checkpoint.byteLengthBefore)} → ${formatBytes(checkpoint.byteLengthAfter)}`,
    ]
    if (checkpoint.checkpoint === savedCheckpoint) parts.push(strings.timeline.savedAtCheckpoint(checkpoint.checkpoint))
    if (!checkpoint.available) parts.push(checkpoint.error ?? strings.timeline.unavailable)
    return parts.join('; ')
  }

  const visibleCheckpoints = $derived.by(() => {
    if (checkpoints.length <= MAX_VISIBLE_MARKERS) return checkpoints
    const candidates = new Map<number, CheckpointMarker>()
    const add = (checkpoint: CheckpointMarker | undefined) => {
      if (checkpoint) candidates.set(checkpoint.checkpoint, checkpoint)
    }
    checkpoints.slice(0, 4).forEach(add)
    checkpoints.slice(-4).forEach(add)
    const nearestCursor = [...checkpoints]
      .sort(
        (left, right) =>
          Math.abs(left.checkpoint - cursor) - Math.abs(right.checkpoint - cursor)
      )
      .slice(0, 10)
    nearestCursor.forEach(add)
    if (savedCheckpoint !== undefined) {
      const nearestSaved = [...checkpoints]
        .sort(
          (left, right) =>
            Math.abs(left.checkpoint - savedCheckpoint) -
            Math.abs(right.checkpoint - savedCheckpoint)
        )
        .slice(0, 3)
      nearestSaved.forEach(add)
    }
    const remaining = MAX_VISIBLE_MARKERS - candidates.size
    for (let index = 0; index < remaining; index += 1) {
      add(
        checkpoints[
          Math.round(((checkpoints.length - 1) * index) / Math.max(1, remaining - 1))
        ]
      )
    }
    return [...candidates.values()].sort(
      (left, right) => left.checkpoint - right.checkpoint
    )
  })

  const currentCheckpoint = $derived(
    cursor === 0
      ? undefined
      : checkpoints.find((checkpoint) => checkpoint.checkpoint === cursor)
  )

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
    <div class="timeline-title">
      <strong>{strings.timeline.label}</strong>
      <span id="timeline-state" aria-live="polite">
        {navigating
          ? strings.timeline.navigating
          : strings.timeline.position(cursor === 0 ? strings.timeline.original : strings.timeline.checkpoint(cursor), checkpointCount)}
      </span>
    </div>
    <span id="timeline-saved" class:saved-off-branch={savedOffBranch} class="saved-position">
      {savedOffBranch
        ? strings.timeline.savedOffBranch
        : savedCheckpoint === undefined
        ? strings.timeline.savedAtChange(savedChangeCount)
        : savedCheckpoint === 0
          ? strings.timeline.savedAtOriginal
          : strings.timeline.savedAtCheckpoint(savedCheckpoint)}
    </span>
    <button
      type="button"
      class="panel-close timeline-close"
      aria-label={strings.timeline.close}
      title={strings.timeline.close}
      onclick={onClose}
    >&times;</button>
  </div>

  <div class="timeline-controls">
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
      aria-describedby="timeline-state timeline-saved timeline-availability timeline-details"
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
  </div>

  <nav class="timeline-markers" aria-label={strings.timeline.label}>
    <button
      type="button"
      class:current={cursor === 0}
      class:saved={savedCheckpoint === 0}
      title={`${strings.timeline.original}; ${formatBytes(originalByteLength)}`}
      disabled={navigating}
      aria-current={cursor === 0 ? 'step' : undefined}
      onclick={() => cursor !== 0 && onNavigate(0)}
    >{strings.timeline.originalMarker}</button>
    {#each visibleCheckpoints as checkpoint}
      <button
        type="button"
        class:current={checkpoint.checkpoint === cursor}
        class:saved={checkpoint.checkpoint === savedCheckpoint}
        class:unavailable={!checkpoint.available}
        title={markerTitle(checkpoint)}
        disabled={navigating}
        aria-current={checkpoint.checkpoint === cursor ? 'step' : undefined}
        onclick={() => checkpoint.checkpoint !== cursor && onNavigate(checkpoint.checkpoint)}
      >{formatNumber(checkpoint.checkpoint)}</button>
    {/each}
    {#if checkpointCount > visibleCheckpoints.length}
      <span class="hidden-markers" title={strings.timeline.hiddenMarkers(checkpointCount - visibleCheckpoints.length)}>
        +{formatNumber(checkpointCount - visibleCheckpoints.length)}
      </span>
    {/if}
  </nav>

  <div id="timeline-details" class="timeline-details" aria-live="polite">
    {#if cursor === 0}
      <strong>{strings.timeline.original}</strong>
      <span>{strings.timeline.originalDescription}</span>
      <span class="timeline-metric"><b>{strings.timeline.size}</b> {formatBytes(originalByteLength)}</span>
    {:else if currentCheckpoint}
      <strong>{boundaryLabel(currentCheckpoint.boundaryKind)}</strong>
      <span class:unavailable-text={!currentCheckpoint.available} class="timeline-readiness">
        {currentCheckpoint.available ? strings.timeline.ready : currentCheckpoint.error ?? strings.timeline.unavailable}
      </span>
      <span class="timeline-metric">
        {strings.timeline.changesInInterval(decimal(currentCheckpoint.sourceChangeCount))}
      </span>
      {#if currentCheckpoint.replayChangeCount !== undefined}
        <span class="timeline-metric">
          {strings.timeline.replayOperations(decimal(currentCheckpoint.replayChangeCount))}
        </span>
      {/if}
      <span class="timeline-metric">
        <b>{strings.timeline.size}</b>
        {formatBytes(currentCheckpoint.byteLengthBefore)} → {formatBytes(currentCheckpoint.byteLengthAfter)}
        <em>{formatDelta(currentCheckpoint.byteLengthBefore, currentCheckpoint.byteLengthAfter)}</em>
      </span>
      {#if currentCheckpoint.archiveByteLength !== undefined}
        <span class="timeline-metric">
          <b>{strings.timeline.archive}</b> {formatBytes(currentCheckpoint.archiveByteLength)}
          ({currentCheckpoint.optimized ? strings.timeline.optimizedArchive : strings.timeline.rawArchive})
        </span>
      {/if}
      {#if currentCheckpoint.transformPluginIds.length > 0}
        <span class="timeline-metric" title={currentCheckpoint.transformPluginIds.join(', ')}>
          <b>{strings.timeline.plugins}</b> {currentCheckpoint.transformPluginIds.join(', ')}
        </span>
      {/if}
      <span class="timeline-metric">
        <b>{strings.timeline.created}</b> {new Date(currentCheckpoint.createdAt).toLocaleString()}
      </span>
    {:else}
      <span>{strings.timeline.metadataUnavailable}</span>
    {/if}
  </div>

  <span id="timeline-availability" class="visually-hidden" aria-live="polite">
    {unavailableCount() > 0 ? strings.timeline.displayedUnavailableCount(unavailableCount()) : ''}
  </span>
</section>

<style>
  .checkpoint-timeline {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.55rem 0.75rem 0.65rem;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background);
  }

  .timeline-heading {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 0.75rem;
    min-height: 1.35rem;
    font-size: 0.8rem;
  }

  .timeline-title {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    min-width: 0;
  }

  .timeline-title span,
  .saved-position,
  .timeline-markers,
  .timeline-details {
    color: var(--vscode-descriptionForeground);
    font-size: 0.72rem;
  }

  .saved-position {
    color: var(--vscode-charts-green, var(--vscode-descriptionForeground));
  }

  .saved-off-branch,
  .timeline-markers .unavailable,
  .unavailable-text {
    color: var(--vscode-errorForeground);
  }

  .timeline-markers .saved {
    box-shadow: inset 0 -2px var(--vscode-charts-green);
  }

  .timeline-controls {
    display: grid;
    grid-template-columns: auto minmax(10rem, 1fr) auto;
    align-items: center;
    gap: 0.55rem;
  }

  .timeline-slider {
    width: 100%;
    accent-color: var(--vscode-focusBorder);
  }

  .timeline-markers {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-height: 1.55rem;
    overflow-x: auto;
    scrollbar-width: thin;
  }

  .timeline-markers button {
    flex: 0 0 auto;
    min-width: 1.65rem;
    padding: 0.18rem 0.38rem;
    border: 1px solid transparent;
    border-radius: 0.25rem;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-button-secondaryBackground);
    cursor: pointer;
  }

  .timeline-markers button:hover:not(:disabled) {
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryHoverBackground);
  }

  .timeline-markers button.current {
    border-color: var(--vscode-focusBorder);
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    font-weight: 700;
  }

  .timeline-markers button:disabled:not(.current) {
    opacity: 0.5;
    cursor: default;
  }

  .hidden-markers {
    flex: 0 0 auto;
    padding-inline: 0.25rem;
  }

  .timeline-details {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.3rem 0.75rem;
    min-height: 1.5rem;
    padding: 0.38rem 0.5rem;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 0.3rem;
    background: var(--vscode-editor-background);
  }

  .timeline-details > strong {
    color: var(--vscode-foreground);
  }

  .timeline-metric,
  .timeline-readiness {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .timeline-metric + .timeline-metric {
    padding-inline-start: 0.75rem;
    border-inline-start: 1px solid var(--vscode-panel-border);
  }

  .timeline-metric b {
    color: var(--vscode-foreground);
    font-weight: 600;
  }

  .timeline-metric em {
    color: var(--vscode-descriptionForeground);
    font-style: normal;
  }

  .timeline-step {
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
  .timeline-slider:focus-visible,
  .timeline-markers button:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 2px;
  }

  .timeline-close {
    position: static;
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
    .saved-off-branch,
    .unavailable-text {
      color: CanvasText;
    }

    .timeline-step:focus-visible,
    .timeline-slider:focus-visible,
    .timeline-markers button:focus-visible {
      outline: 2px solid Highlight;
    }
  }

  @media (max-width: 720px) {
    .timeline-heading {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .saved-position {
      grid-column: 1 / -1;
      grid-row: 2;
    }

    .timeline-close {
      grid-column: 2;
      grid-row: 1;
    }

    .timeline-metric + .timeline-metric {
      padding-inline-start: 0;
      border-inline-start: 0;
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
