<script lang="ts">
  import { formatNumber, strings } from '../i18n'
  import type {
    WebviewActionJournalEntry,
    WebviewActionJournalKind,
    WebviewActionJournalViewport,
  } from '../protocol'
  import { MAX_LABEL_LENGTH, WEBVIEW_ACTION_JOURNAL_KINDS } from '../protocol'

  const maxSafeSerial = BigInt(Number.MAX_SAFE_INTEGER)

  interface Props {
    viewport?: WebviewActionJournalViewport
    selectedKinds: WebviewActionJournalKind[]
    transactionId: string
    loading?: boolean
    error?: string
    onFilter: (kinds: WebviewActionJournalKind[], transactionId: string) => void
    onLoadOlder: (anchorSerial: string) => void
    onReveal: (offset: string) => void
    onCopy: (
      firstSerial: string,
      lastSerial: string,
      format: 'json' | 'cli' | 'mcp'
    ) => void
    onClose: () => void
    onRetry: () => void
  }

  let {
    viewport,
    selectedKinds,
    transactionId,
    loading = false,
    error = '',
    onFilter,
    onLoadOlder,
    onReveal,
    onCopy,
    onClose,
    onRetry,
  }: Props = $props()

  let draftTransaction = $state('')
  let requestedAnchor = $state('')
  $effect(() => {
    draftTransaction = transactionId
  })

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

  function toggleKind(kind: WebviewActionJournalKind): void {
    const selected = selectedKinds.includes(kind)
    if (selected && selectedKinds.length === 1) {
      return
    }
    const next = selected
      ? selectedKinds.filter((candidate) => candidate !== kind)
      : [...selectedKinds, kind]
    requestedAnchor = ''
    onFilter(next, draftTransaction)
  }

  function applyFilters(): void {
    requestedAnchor = ''
    onFilter(selectedKinds, draftTransaction)
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

  function canCopy(entry: WebviewActionJournalEntry): boolean {
    return decimal(entry.firstSerial) <= maxSafeSerial && decimal(entry.lastSerial) <= maxSafeSerial
  }
</script>

<section class="action-journal" aria-label={strings.actionJournal.label} aria-busy={loading}>
  <header>
    <div>
      <strong>{strings.actionJournal.label}</strong>
      {#if viewport}
        <span>{strings.actionJournal.summary(decimal(viewport.changeCount), decimal(viewport.undoCount))}</span>
      {/if}
    </div>
    <button type="button" class="close" aria-label={strings.actionJournal.close} onclick={onClose}>&times;</button>
  </header>

  <div class="filters">
    <span>{strings.actionJournal.kind}</span>
    {#each WEBVIEW_ACTION_JOURNAL_KINDS as kind}
      <button
        type="button"
        class:active={selectedKinds.includes(kind)}
        aria-pressed={selectedKinds.includes(kind)}
        onclick={() => toggleKind(kind)}
      ><span class="filter-indicator" aria-hidden="true">{selectedKinds.includes(kind) ? '✓' : ''}</span>{kind}</button>
    {/each}
    <form onsubmit={(event) => { event.preventDefault(); applyFilters() }}>
      <input bind:value={draftTransaction} maxlength={MAX_LABEL_LENGTH} placeholder={strings.actionJournal.transactionPlaceholder} aria-label={strings.actionJournal.transactionFilter} />
      <button type="submit">{strings.actionJournal.filter}</button>
    </form>
  </div>

  {#if error}
    <div class="empty error" role="alert">
      <span>{error}</span>
      <button type="button" onclick={retry}>{strings.actionJournal.retry}</button>
    </div>
  {:else if !viewport && loading}
    <div class="empty">{strings.actionJournal.loadingHistory}</div>
  {:else if viewport && viewport.entries.length === 0 && decimal(viewport.changeCount) === 0n && decimal(viewport.undoCount) === 0n}
    <div class="empty">{strings.actionJournal.noChanges}</div>
  {:else if !viewport || viewport.entries.length === 0}
    <div class="empty">{strings.actionJournal.noMatchingChanges}</div>
  {:else}
    <ol onscroll={loadOlderNearEnd}>
      {#each viewport.entries as entry (`${entry.firstSerial}:${entry.lastSerial}`)}
        <li>
          <button class="entry-main" type="button" title={strings.actionJournal.jumpToChangedBytes} onclick={() => onReveal(entry.offset)}>
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
          </button>
          <div class="entry-actions">
            <button type="button" disabled={!canCopy(entry)} title={canCopy(entry) ? undefined : strings.actionJournal.copyUnavailable} onclick={() => onCopy(entry.firstSerial, entry.lastSerial, 'json')}>JSON</button>
            <button type="button" disabled={!canCopy(entry)} title={canCopy(entry) ? undefined : strings.actionJournal.copyUnavailable} onclick={() => onCopy(entry.firstSerial, entry.lastSerial, 'cli')}>CLI</button>
            <button type="button" disabled={!canCopy(entry)} title={canCopy(entry) ? undefined : strings.actionJournal.copyUnavailable} onclick={() => onCopy(entry.firstSerial, entry.lastSerial, 'mcp')}>MCP</button>
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
  .action-journal { display: flex; flex-direction: column; gap: .5rem; width: clamp(20rem, 32vw, 30rem); height: 100%; min-width: 0; min-height: 0; padding: .55rem .75rem; border-left: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
  header, header > div, .filters, form, li, .entry-actions { display: flex; align-items: center; gap: .5rem; }
  header { justify-content: space-between; }
  header span, .empty { color: var(--vscode-descriptionForeground); font-size: .75rem; }
  button, input { color: var(--vscode-foreground); border: 1px solid var(--vscode-button-border, var(--vscode-panel-border)); background: var(--vscode-button-secondaryBackground); }
  button { cursor: pointer; padding: .18rem .42rem; }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .filters button.active { color: var(--vscode-button-foreground); border-color: var(--vscode-focusBorder); background: var(--vscode-button-background); font-weight: 600; }
  .filters button.active:hover { background: var(--vscode-button-hoverBackground); }
  .filter-indicator { display: inline-block; width: 1em; }
  button:disabled { cursor: not-allowed; opacity: .55; }
  .close { border: 0; background: transparent; font-size: 1.15rem; }
  .filters { flex-wrap: wrap; font-size: .72rem; }
  .filters form { margin-left: auto; }
  input { width: 10rem; padding: .2rem .35rem; background: var(--vscode-input-background); }
  ol { flex: 1 1 auto; min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; list-style: none; padding: 0; margin: 0; border: 1px solid var(--vscode-panel-border); scrollbar-gutter: stable; }
  li { align-items: stretch; border-bottom: 1px solid var(--vscode-panel-border); }
  li:last-child { border-bottom: 0; }
  .entry-main { flex: 1; display: flex; flex-wrap: wrap; align-items: center; gap: .55rem; min-width: 0; padding: .38rem .5rem; border: 0; background: transparent; text-align: left; }
  .entry-main strong { color: var(--vscode-charts-blue); }
  .entry-main strong.transform { color: var(--vscode-charts-purple); }
  .serial, code, .payload, .checkpoint { font-size: .7rem; }
  code, .payload, .checkpoint { color: var(--vscode-descriptionForeground); }
  .positive { color: var(--vscode-charts-green); }
  .negative { color: var(--vscode-charts-red); }
  .entry-actions { padding-right: .4rem; }
  .entry-actions button { font-size: .67rem; }
  .load-more { align-self: center; }
  .empty { padding: 1rem; text-align: center; }
  .empty.error { display: flex; align-items: center; justify-content: center; gap: .6rem; color: var(--vscode-errorForeground); }

  @media (max-width: 700px) {
    .action-journal { width: min(72vw, 22rem); }
  }
</style>
