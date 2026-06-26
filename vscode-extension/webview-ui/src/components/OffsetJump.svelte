<script lang="ts">
  import { formatNumber, strings } from '../i18n'

  interface Props {
    fileSize?: number
    offsetRadix?: 'hex' | 'dec'
    onGoToOffset: (offset: number) => void
  }

  let {
    fileSize = 0,
    offsetRadix = 'hex',
    onGoToOffset,
  }: Props = $props()

  let offsetText = $state('')
  let submitted = $state(false)

  const parsedOffset = $derived(parseOffset(offsetText))
  const validationMessage = $derived(validateOffset())
  const showValidation = $derived(submitted && validationMessage.length > 0)
  const placeholder = $derived(
    offsetRadix === 'dec'
      ? strings.navigation.offsetPlaceholderDec
      : strings.navigation.offsetPlaceholderHex
  )
  const title = $derived(
    offsetRadix === 'dec'
      ? strings.navigation.offsetTitleDec
      : strings.navigation.offsetTitleHex
  )

  function parseOffset(value: string): number | undefined {
    const text = value.trim()
    if (!text) {
      return undefined
    }

    const normalizedHex = text.toLowerCase().startsWith('0x')
      ? text.slice(2)
      : text
    const normalizedDecimal = text.replace(/[,_]/g, '')
    const source = offsetRadix === 'hex' ? normalizedHex : normalizedDecimal
    const pattern = offsetRadix === 'hex' ? /^[0-9a-f]+$/i : /^[0-9]+$/
    if (!pattern.test(source)) {
      return undefined
    }

    const valueBase = offsetRadix === 'hex' ? 16 : 10
    const parsed = Number.parseInt(source, valueBase)
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
  }

  function formatOffset(offset: number): string {
    return offsetRadix === 'dec'
      ? formatNumber(offset)
      : `0x${offset.toString(16).toUpperCase()}`
  }

  function validateOffset(): string {
    if (!offsetText.trim()) {
      return strings.navigation.offsetRequired
    }
    if (parsedOffset === undefined) {
      return offsetRadix === 'dec'
        ? strings.navigation.invalidDecimalOffset
        : strings.navigation.invalidHexOffset
    }
    if (fileSize <= 0) {
      return strings.navigation.noFile
    }
    if (parsedOffset >= fileSize) {
      return strings.navigation.offsetOutOfRange(formatOffset(fileSize - 1))
    }
    return ''
  }

  function submitOffset(): void {
    submitted = true
    if (validationMessage || parsedOffset === undefined) {
      return
    }
    onGoToOffset(parsedOffset)
  }

  function handleInput(event: Event): void {
    const input = event.currentTarget
    if (!(input instanceof HTMLInputElement)) {
      return
    }
    offsetText = input.value
    if (submitted) {
      submitted = false
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      submitOffset()
    }
  }
</script>

<div class="offset-jump">
  <label class="offset-jump-label" for="offsetJumpInput">
    {strings.navigation.offsetLabel}
  </label>
  <input
    id="offsetJumpInput"
    class="offset-jump-input"
    value={offsetText}
    placeholder={placeholder}
    title={title}
    aria-invalid={showValidation ? 'true' : 'false'}
    aria-describedby={showValidation ? 'offsetJumpStatus' : undefined}
    oninput={handleInput}
    onkeydown={handleKeydown}
  />
  <button
    type="button"
    class="secondary offset-jump-button"
    title={strings.navigation.goTitle}
    onclick={submitOffset}
  >
    {strings.navigation.go}
  </button>
  {#if showValidation}
    <span id="offsetJumpStatus" class="offset-jump-status" aria-live="polite">
      {validationMessage}
    </span>
  {/if}
</div>
