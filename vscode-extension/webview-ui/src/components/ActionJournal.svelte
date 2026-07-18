<script lang="ts">
  import { formatNumber, strings } from '../i18n'
  import type {
    WebviewActionJournalEntry,
    WebviewActionJournalViewport,
  } from '../protocol'

  interface Props {
    viewport?: WebviewActionJournalViewport
    loading?: boolean
    error?: string
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
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    onLoadOlder,
    onClose,
    onRetry,
  }: Props = $props()

  let requestedAnchor = $state('')

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
  {:else if !viewport || viewport.entries.length === 0}
    <div class="empty">{strings.actionJournal.noChanges}</div>
  {:else}
    <ol onscroll={loadOlderNearEnd}>
      {#each viewport.entries as entry (`${entry.firstSerial}:${entry.lastSerial}`)}
        <li>
          <div class="entry-main">
            <span class="serial">#{formatted(entry.firstSerial)}{entry.lastSerial === entry.firstSerial ? '' : `–${formatted(entry.lastSerial)}`}</span>
            <strong class:transform={entry.kind === 'TRANSFORM'}>{entry.kind}</strong>
            <span>{range(entry)}</span>
            <span>{strings.actionJournal.dataLength(decimal(entry.dataLength))}</span>
            <span class:positive={decimal(entry.sizeDelta) > 0n} class:negative={decimal(entry.sizeDelta) < 0n}>Δ {delta(entry.sizeDelta)} B</span>
            {#if entry.transactionId}<code>{entry.transactionId}</code>{/if}
            {#if entry.checkpointBefore !== undefined}<span class="checkpoint">{strings.actionJournal.checkpointBefore(decimal(entry.checkpointBefore))}</span>{/if}
            {#if entry.checkpointAfter !== undefined}<span class="checkpoint">{strings.actionJournal.checkpointAfter(decimal(entry.checkpointAfter))}</span>{/if}
            <span class="payload">{payloadHint(entry)}</span>
            {#if entry.transform}<code>{entry.transform.transformId}</code>{/if}
          </div>
        </li>
      {/each}
    </ol>
    {#if viewport.hasMore && viewport.nextAnchorSerial}
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
