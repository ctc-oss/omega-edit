<script lang="ts">
  import { formatNumber, strings } from '../i18n'
  import type {
    WebviewActionJournalCheckpoint,
    WebviewActionJournalEntry,
    WebviewActionJournalViewport,
  } from '../protocol'

  interface Props {
    viewport?: WebviewActionJournalViewport
    loading?: boolean
    error?: string
    checkpoints?: WebviewActionJournalCheckpoint[]
    checkpointCursor?: number
    canUndo: boolean
    canRedo: boolean
    onUndo: () => void
    onRedo: () => void
    onLoadOlder: (anchorSerial: string) => void
    onClose: () => void
    onRetry: () => void
  }

  let {
    viewport,
    loading = false,
    error = '',
    checkpoints = [],
    checkpointCursor = 0,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    onLoadOlder,
    onClose,
    onRetry,
  }: Props = $props()

  let requestedAnchor = $state('')

  type JournalRow =
    | { type: 'change'; key: string; coordinate: bigint; entry: WebviewActionJournalEntry }
    | { type: 'checkpoint'; key: string; coordinate: bigint; checkpoint: WebviewActionJournalCheckpoint }

  function decimal(value: string): bigint {
    try {
      return BigInt(value)
    } catch {
      return 0n
    }
  }

  function formatted(value: string): string {
    return formatNumber(decimal(value))
  }

  function delta(value: string): string {
    const parsed = decimal(value)
    return `${parsed > 0n ? '+' : ''}${formatNumber(parsed)}`
  }

  function loadOlder(anchorSerial: string): void {
    if (loading || requestedAnchor === anchorSerial) {
      return
    }
    requestedAnchor = anchorSerial
    onLoadOlder(anchorSerial)
  }

  function loadOlderNearEnd(event: Event): void {
    const scroller = event.currentTarget as HTMLOListElement
    if (
      viewport?.hasMore &&
      viewport.nextAnchorSerial &&
      scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 96
    ) {
      loadOlder(viewport.nextAnchorSerial)
    }
  }

  function retry(): void {
    requestedAnchor = ''
    onRetry()
  }

  function journalRows(): JournalRow[] {
    const rows: JournalRow[] = [
      ...((viewport?.entries ?? []).map((entry) => ({
        type: 'change' as const,
        key: `change:${entry.firstSerial}:${entry.lastSerial}`,
        coordinate: decimal(entry.changeCountAfter),
        entry,
      }))),
      ...checkpoints.map((checkpoint) => ({
        type: 'checkpoint' as const,
        key: `checkpoint:${checkpoint.checkpoint}`,
        coordinate: BigInt(checkpoint.changeCount),
        checkpoint,
      })),
    ]
    return rows.sort((left, right) => {
      if (left.coordinate !== right.coordinate) {
        return left.coordinate > right.coordinate ? -1 : 1
      }
      if (left.type === right.type) return 0
      return left.type === 'checkpoint' ? -1 : 1
    })
  }

  function checkpointKind(kind: WebviewActionJournalCheckpoint['boundaryKind']): string {
    switch (kind) {
      case 'plain':
        return strings.actionJournal.checkpointPlain
      case 'transform':
        return strings.actionJournal.checkpointTransform
      case 'tip':
        return strings.actionJournal.checkpointTip
      default:
        return strings.actionJournal.checkpointPlain
    }
  }

  function range(entry: WebviewActionJournalEntry): string {
    const length = decimal(entry.length)
    return length === 0n
      ? strings.actionJournal.rangeAt(decimal(entry.offset))
      : strings.actionJournal.rangeLength(decimal(entry.offset), length)
  }

  function payloadHint(entry: WebviewActionJournalEntry): string {
    switch (entry.payloadHint) {
      case 'none':
        return strings.actionJournal.payloadNone
      case 'inline':
        return strings.actionJournal.payloadInline
      case 'file-backed':
        return strings.actionJournal.payloadFileBacked
      case 'checkpoint-backed':
        return strings.actionJournal.payloadCheckpointBacked
    }
  }
</script>

<section class="action-journal" aria-label={strings.actionJournal.label} aria-busy={loading}>
  <header>
    <div>
      <strong>{strings.actionJournal.label}</strong>
      {#if viewport}
        <span aria-live="polite">{strings.actionJournal.summary(decimal(viewport.changeCount), decimal(viewport.undoCount))}</span>
      {/if}
    </div>
    <div class="journal-controls">
      <button
        type="button"
        class="history-step"
        aria-label={strings.actionJournal.rewind}
        title={strings.actionJournal.rewind}
        disabled={!canUndo}
        onclick={onUndo}
      >&#x25C0;</button>
      <button
        type="button"
        class="history-step"
        aria-label={strings.actionJournal.fastForward}
        title={strings.actionJournal.fastForward}
        disabled={!canRedo}
        onclick={onRedo}
      >&#x25B6;</button>
      <button type="button" class="close" aria-label={strings.actionJournal.close} onclick={onClose}>&times;</button>
    </div>
  </header>

  {#if error}
    <div class="empty error" role="alert">
      <span>{error}</span>
      <button type="button" onclick={retry}>{strings.actionJournal.retry}</button>
    </div>
  {:else if !viewport && loading}
    <div class="empty">{strings.actionJournal.loadingHistory}</div>
  {:else if (!viewport || viewport.entries.length === 0) && checkpoints.length === 0}
    <div class="empty">{strings.actionJournal.noChanges}</div>
  {:else}
    <ol onscroll={loadOlderNearEnd}>
      {#each journalRows() as row (row.key)}
        {#if row.type === 'checkpoint'}
          <li
            class="checkpoint-card"
            class:active={row.checkpoint.checkpoint === checkpointCursor}
            class:future={row.checkpoint.checkpoint > checkpointCursor}
          >
            <span class="checkpoint-symbol" aria-hidden="true">◆</span>
            <div>
              <strong>{strings.actionJournal.checkpointCard(row.checkpoint.checkpoint)}</strong>
              <span>{checkpointKind(row.checkpoint.boundaryKind)}</span>
              <span>{strings.actionJournal.checkpointChanges(row.checkpoint.changeCount)}</span>
              <span>{strings.actionJournal.checkpointBytes(decimal(row.checkpoint.byteLengthAfter))}</span>
              {#if row.checkpoint.checkpoint === checkpointCursor}<span class="checkpoint-state">{strings.actionJournal.checkpointCurrent}</span>{/if}
              {#if row.checkpoint.checkpoint > checkpointCursor}<span class="checkpoint-state">{strings.actionJournal.checkpointFuture}</span>{/if}
              {#if !row.checkpoint.available}<span class="checkpoint-state unavailable">{strings.actionJournal.checkpointUnavailable}</span>{/if}
            </div>
          </li>
        {:else}
          <li>
            <div class="entry-main">
              <span class="serial">#{formatted(row.entry.firstSerial)}{row.entry.lastSerial === row.entry.firstSerial ? '' : `–${formatted(row.entry.lastSerial)}`}</span>
              <strong class:transform={row.entry.kind === 'TRANSFORM'}>{row.entry.kind}</strong>
              <span>{range(row.entry)}</span>
              <span>{strings.actionJournal.dataLength(decimal(row.entry.dataLength))}</span>
              <span class:positive={decimal(row.entry.sizeDelta) > 0n} class:negative={decimal(row.entry.sizeDelta) < 0n}>Δ {delta(row.entry.sizeDelta)} B</span>
              {#if row.entry.transactionId}<code>{row.entry.transactionId}</code>{/if}
              {#if row.entry.checkpointBefore !== undefined}<span class="checkpoint">{strings.actionJournal.checkpointBefore(decimal(row.entry.checkpointBefore))}</span>{/if}
              {#if row.entry.checkpointAfter !== undefined}<span class="checkpoint">{strings.actionJournal.checkpointAfter(decimal(row.entry.checkpointAfter))}</span>{/if}
              <span class="payload">{payloadHint(row.entry)}</span>
              {#if row.entry.transform}<code>{row.entry.transform.transformId}</code>{/if}
            </div>
          </li>
        {/if}
      {/each}
    </ol>
    {#if viewport?.hasMore && viewport.nextAnchorSerial}
      <button class="load-more" type="button" disabled={loading} onclick={() => loadOlder(viewport.nextAnchorSerial!)}>
        {loading ? strings.actionJournal.loading : strings.actionJournal.loadOlderChanges}
      </button>
    {/if}
  {/if}
</section>

<style>
  .action-journal { display: flex; flex-direction: column; gap: .5rem; width: clamp(20rem, 32vw, 30rem); height: 100%; min-height: 0; padding: .55rem .75rem; border-left: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
  header, header > div, li { display: flex; align-items: center; gap: .5rem; }
  header { justify-content: space-between; }
  header span, .empty { color: var(--vscode-descriptionForeground); font-size: .75rem; }
  button { color: var(--vscode-foreground); border: 1px solid var(--vscode-button-border, var(--vscode-panel-border)); background: var(--vscode-button-secondaryBackground); }
  button { cursor: pointer; padding: .18rem .42rem; }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button:disabled { cursor: not-allowed; opacity: .55; }
  .close { border: 0; background: transparent; font-size: 1.15rem; }
  .journal-controls { margin-left: auto; }
  .history-step { min-width: 1.75rem; }
  ol { flex: 1 1 auto; min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; list-style: none; padding: 0; margin: 0; border: 1px solid var(--vscode-panel-border); scrollbar-gutter: stable; }
  li { align-items: stretch; border-bottom: 1px solid var(--vscode-panel-border); }
  li:last-child { border-bottom: 0; }
  .entry-main { flex: 1; display: flex; flex-wrap: wrap; align-items: center; gap: .55rem; min-width: 0; padding: .38rem .5rem; text-align: left; }
  .entry-main strong { color: var(--vscode-charts-blue); }
  .entry-main strong.transform { color: var(--vscode-charts-purple); }
  .checkpoint-card { gap: .6rem; padding: .48rem .55rem; border-left: 3px solid var(--vscode-charts-yellow); background: color-mix(in srgb, var(--vscode-charts-yellow) 8%, transparent); }
  .checkpoint-card > div { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; min-width: 0; }
  .checkpoint-card.active { border-left-color: var(--vscode-charts-green); background: color-mix(in srgb, var(--vscode-charts-green) 10%, transparent); }
  .checkpoint-card.future { opacity: .72; border-left-style: dashed; }
  .checkpoint-symbol { color: var(--vscode-charts-yellow); }
  .checkpoint-card.active .checkpoint-symbol { color: var(--vscode-charts-green); }
  .checkpoint-card span { color: var(--vscode-descriptionForeground); font-size: .7rem; }
  .checkpoint-state { padding: .05rem .3rem; border: 1px solid var(--vscode-panel-border); border-radius: .3rem; }
  .checkpoint-state.unavailable { color: var(--vscode-errorForeground); }
  .serial, code, .payload, .checkpoint { font-size: .7rem; }
  code, .payload, .checkpoint { color: var(--vscode-descriptionForeground); }
  .positive { color: var(--vscode-charts-green); }
  .negative { color: var(--vscode-charts-red); }
  .load-more { align-self: center; }
  .empty { padding: 1rem; text-align: center; }
  .empty.error { display: flex; align-items: center; justify-content: center; gap: .6rem; color: var(--vscode-errorForeground); }

  @media (max-width: 700px) {
    .action-journal { width: min(72vw, 22rem); }
  }
</style>
