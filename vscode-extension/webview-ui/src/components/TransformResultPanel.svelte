<script lang="ts">
  import { strings } from '../i18n'

  interface Props {
    title: string
    summary: string
    label: string
    value: string
    mimeType?: string
    contentSourceLabel: string
    rangeStart: string
    rangeEnd: string
    length: string
    onDismiss: () => void
  }

  let {
    title,
    summary,
    label,
    value,
    mimeType = '',
    contentSourceLabel,
    rangeStart,
    rangeEnd,
    length,
    onDismiss,
  }: Props = $props()

  let copyStatus = $state('')

  async function copyResult(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value)
      copyStatus = strings.transform.resultCopied
    } catch {
      copyStatus = strings.transform.resultCopyFailed
    }
  }
</script>

<section class="transform-result-panel" aria-label={strings.transform.resultTitle}>
  <div class="transform-result-header">
    <div class="transform-result-heading">
      <h2>{title}</h2>
      <p>{summary}</p>
    </div>
    <div class="transform-result-actions">
      <button type="button" class="secondary" onclick={copyResult}>
        {strings.transform.copyResult}
      </button>
      <button
        type="button"
        class="panel-close"
        aria-label={strings.transform.dismissResult}
        title={strings.transform.dismissResult}
        onclick={onDismiss}
      >
        &times;
      </button>
    </div>
  </div>

  <div class="transform-result-meta">
    <span class="analysis-label">{strings.transform.resultLabel}</span>
    <span class="analysis-value">{label}</span>
    <span class="analysis-label">{strings.transform.contentSource}</span>
    <span class="analysis-value">{contentSourceLabel}</span>
    {#if mimeType}
      <span class="analysis-label">{strings.transform.resultMimeType}</span>
      <span class="analysis-value">{mimeType}</span>
    {/if}
    <span class="analysis-label">{strings.transform.start}</span>
    <span class="analysis-value">{rangeStart}</span>
    <span class="analysis-label">{strings.transform.end}</span>
    <span class="analysis-value">{rangeEnd}</span>
    <span class="analysis-label">{strings.transform.length}</span>
    <span class="analysis-value">{length}</span>
  </div>

  <textarea
    class="transform-result-value"
    aria-label={strings.transform.resultValue}
    readonly
    value={value}
  ></textarea>

  {#if copyStatus}
    <div class="transform-result-status" aria-live="polite">{copyStatus}</div>
  {/if}
</section>
