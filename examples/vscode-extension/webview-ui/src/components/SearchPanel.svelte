<script lang="ts">
  import { strings } from '../i18n'

  interface Props {
    query?: string
    isHex?: boolean
    caseInsensitive?: boolean
    isReverse?: boolean
    replacement?: string
    invalid?: boolean
    replacementInvalid?: boolean
    canNavigate?: boolean
    canReplace?: boolean
    summary?: string
    replaceSummary?: string
    onQueryChange: (query: string) => void
    onReplacementChange: (replacement: string) => void
    onHexChange: (enabled: boolean) => void
    onCaseInsensitiveChange: (enabled: boolean) => void
    onReverseChange: (enabled: boolean) => void
    onSearch: () => void
    onNavigate: (direction: 'forward' | 'backward') => void
    onReplace: () => void
    onReplaceAll: () => void
  }

  let {
    query = '',
    isHex = false,
    caseInsensitive = false,
    isReverse = false,
    replacement = '',
    invalid = false,
    replacementInvalid = false,
    canNavigate = false,
    canReplace = false,
    summary = strings.search.noSearch,
    replaceSummary = '',
    onQueryChange,
    onReplacementChange,
    onHexChange,
    onCaseInsensitiveChange,
    onReverseChange,
    onSearch,
    onNavigate,
    onReplace,
    onReplaceAll,
  }: Props = $props()

  function getInput(event: Event): HTMLInputElement {
    return event.currentTarget as HTMLInputElement
  }

  function handleQueryInput(event: Event): void {
    onQueryChange(getInput(event).value)
  }

  function handleReplacementInput(event: Event): void {
    onReplacementChange(getInput(event).value)
  }

  function handleHexChange(event: Event): void {
    onHexChange(getInput(event).checked)
  }

  function handleCaseInsensitiveChange(event: Event): void {
    onCaseInsensitiveChange(getInput(event).checked)
  }

  function handleDirectionChange(event: Event): void {
    const select = event.currentTarget as HTMLSelectElement
    onReverseChange(select.value === 'reverse')
  }

  function handleInputKeydown(event: KeyboardEvent): void {
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
    if (event.key !== 'Enter' || !canReplace || replacementInvalid) {
      return
    }
    event.preventDefault()
    onReplace()
  }
</script>

<section class="search-panel" role="search" aria-label={strings.search.label}>
  <div class="search-fields">
    <input
      class="search-input"
      type="text"
      value={query}
      placeholder={strings.search.placeholder}
      aria-invalid={invalid}
      oninput={handleQueryInput}
      onkeydown={handleInputKeydown}
    />
    <label class="check-control">
      <input type="checkbox" checked={isHex} onchange={handleHexChange} />
      <span>{strings.search.hex}</span>
    </label>
    <label class="check-control" class:disabled={isHex}>
      <input
        type="checkbox"
        checked={caseInsensitive}
        disabled={isHex}
        onchange={handleCaseInsensitiveChange}
      />
      <span>{strings.search.ignoreCase}</span>
    </label>
    <select
      class="direction-select"
      title={strings.search.directionTitle}
      value={isReverse ? 'reverse' : 'forward'}
      onchange={handleDirectionChange}
    >
      <option value="forward">{strings.search.forward}</option>
      <option value="reverse">{strings.search.reverse}</option>
    </select>
    <button
      type="button"
      disabled={query.trim().length === 0 || invalid}
      onclick={onSearch}
    >
      {strings.search.find}
    </button>
  </div>

  <div class="search-actions">
    <button
      type="button"
      class="secondary"
      disabled={!canNavigate}
      title={strings.search.previousTitle}
      onclick={() => onNavigate('backward')}
    >
      {strings.search.previous}
    </button>
    <button
      type="button"
      class="secondary"
      disabled={!canNavigate}
      title={strings.search.nextTitle}
      onclick={() => onNavigate('forward')}
    >
      {strings.search.next}
    </button>
    <span class="search-summary" aria-live="polite">{summary}</span>
  </div>

  <div class="replace-fields">
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
      class="secondary"
      disabled={!canReplace || replacementInvalid}
      onclick={onReplace}
    >
      {strings.search.replace}
    </button>
    <button
      type="button"
      class="secondary"
      disabled={!canReplace || replacementInvalid}
      onclick={onReplaceAll}
    >
      {strings.search.replaceAll}
    </button>
    {#if replaceSummary}
      <span class="search-summary replace-summary" aria-live="polite">
        {replaceSummary}
      </span>
    {/if}
  </div>
</section>
