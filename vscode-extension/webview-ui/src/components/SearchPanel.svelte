<script lang="ts">
  import { strings } from '../i18n'

  interface Props {
    query?: string
    isHex?: boolean
    caseSensitive?: boolean
    replacement?: string
    invalid?: boolean
    replacementInvalid?: boolean
    canNavigate?: boolean
    canReplace?: boolean
    replaceVisible?: boolean
    summary?: string
    replaceSummary?: string
    onQueryChange: (query: string) => void
    onReplacementChange: (replacement: string) => void
    onHexChange: (enabled: boolean) => void
    onCaseSensitiveChange: (enabled: boolean) => void
    onToggleReplace: () => void
    onClose: () => void
    onNavigate: (direction: 'forward' | 'backward') => void
    onReplace: () => void
    onReplaceAll: () => void
  }

  let {
    query = '',
    isHex = false,
    caseSensitive = false,
    replacement = '',
    invalid = false,
    replacementInvalid = false,
    canNavigate = false,
    canReplace = false,
    replaceVisible = false,
    summary = strings.search.noSearch,
    replaceSummary = '',
    onQueryChange,
    onReplacementChange,
    onHexChange,
    onCaseSensitiveChange,
    onToggleReplace,
    onClose,
    onNavigate,
    onReplace,
    onReplaceAll,
  }: Props = $props()

  let queryInput = $state<HTMLInputElement | undefined>(undefined)

  function getInput(event: Event): HTMLInputElement {
    return event.currentTarget as HTMLInputElement
  }

  function handleQueryInput(event: Event): void {
    onQueryChange(getInput(event).value)
  }

  function handleReplacementInput(event: Event): void {
    onReplacementChange(getInput(event).value)
  }

  function handleInputKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Enter') {
      return
    }
    event.preventDefault()
    if (event.shiftKey && canNavigate) {
      onNavigate('backward')
    } else if (canNavigate) {
      onNavigate('forward')
    }
  }

  function handleReplacementKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Enter' || !canReplace || replacementInvalid) {
      return
    }
    event.preventDefault()
    onReplace()
  }

  function handleReplaceAllClick(): void {
    if (!canReplace || replacementInvalid) return
    const confirmed = window.confirm(strings.search.replaceAllConfirm)
    if (confirmed) {
      onReplaceAll()
    }
  }
</script>

<section class="search-panel" role="search" aria-label={strings.search.label}>
  <div class="search-row">
    <button
      type="button"
      class="search-disclosure"
      aria-expanded={replaceVisible}
      aria-label={strings.search.toggleReplace}
      title={strings.search.toggleReplace}
      onclick={onToggleReplace}
    >
      {#if replaceVisible}&#x25BC;{:else}&#x25B6;{/if}
    </button>
    <div class="search-query-field" class:invalid>
      <input
        bind:this={queryInput}
        class="search-input search-query-input"
        type="text"
        value={query}
        placeholder={strings.search.placeholder}
        aria-invalid={invalid}
        oninput={handleQueryInput}
        onkeydown={handleInputKeydown}
      />
      <div class="search-query-modifiers">
        <button
          type="button"
          class="search-input-toggle"
          class:active={isHex}
          aria-pressed={isHex}
          aria-label={strings.search.hexTitle}
          title={strings.search.hexTitle}
          onclick={() => onHexChange(!isHex)}
        >0x</button>
        <button
          type="button"
          class="search-input-toggle"
          class:active={caseSensitive}
          class:disabled={isHex}
          aria-pressed={caseSensitive}
          aria-label={strings.search.matchCaseTitle}
          disabled={isHex}
          title={isHex ? strings.search.hexDisabledCase : strings.search.matchCaseTitle}
          onclick={() => onCaseSensitiveChange(!caseSensitive)}
        >Aa</button>
      </div>
    </div>
    <span class="search-summary" aria-live="polite">{summary}</span>
    <div class="search-nav">
      <button
        type="button"
        class="search-nav-btn"
        aria-label={strings.search.previous}
        title={strings.search.previousTitle}
        disabled={!canNavigate}
        onclick={() => onNavigate('backward')}
      >
        &#x25B2;
      </button>
      <button
        type="button"
        class="search-nav-btn"
        aria-label={strings.search.next}
        title={strings.search.nextTitle}
        disabled={!canNavigate}
        onclick={() => onNavigate('forward')}
      >
        &#x25BC;
      </button>
    </div>
    <button
      type="button"
      class="panel-close"
      aria-label={strings.search.close}
      title={strings.search.closeTitle}
      onclick={onClose}
    >
      &times;
    </button>
  </div>
  {#if replaceVisible}
    <div class="search-row replace-row">
      <input
        class="search-input replace-input"
        type="text"
        value={replacement}
        placeholder={strings.search.replacePlaceholder}
        aria-label={strings.search.replacePlaceholder}
        aria-invalid={replacementInvalid}
        oninput={handleReplacementInput}
        onkeydown={handleReplacementKeydown}
      />
      <button
        type="button"
        class="search-action-btn"
        disabled={!canReplace || replacementInvalid}
        onclick={onReplace}
      >
        {strings.search.replace}
      </button>
      <button
        type="button"
        class="search-action-btn"
        disabled={!canReplace || replacementInvalid}
        onclick={handleReplaceAllClick}
      >
        {strings.search.replaceAll}
      </button>
      {#if replaceSummary}
        <span class="search-summary replace-summary" aria-live="polite">
          {replaceSummary}
        </span>
      {/if}
    </div>
  {/if}
</section>
