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

  const HEX_PREFIX = '0x'

  let offsetText = $state('')
  let submitted = $state(false)
  let previousOffsetRadix = $state<'hex' | 'dec'>('hex')

  const parsedOffset = $derived(parseOffset(offsetText, offsetRadix))
  const validationMessage = $derived(validateOffset())
  const showValidation = $derived(submitted && validationMessage.length > 0)
  const offsetInputMode = $derived(offsetRadix === 'dec' ? 'numeric' : 'text')
  const offsetPattern = $derived(
    offsetRadix === 'dec' ? '[0-9]*' : '[0-9A-Fa-f]*'
  )
  const placeholder = $derived(
    offsetRadix === 'dec'
      ? strings.navigation.offsetPlaceholderDec
      : strings.navigation.offsetPlaceholderHex.replace(/^0x/i, '')
  )
  const title = $derived(
    offsetRadix === 'dec'
      ? strings.navigation.offsetTitleDec
      : strings.navigation.offsetTitleHex
  )

  function offsetDigits(value: string, radix: 'hex' | 'dec'): string {
    const text = value.trim()
    if (radix === 'dec') {
      return text
    }
    return text.toLowerCase().startsWith(HEX_PREFIX)
      ? text.slice(HEX_PREFIX.length)
      : text
  }

  function parseOffset(
    value: string,
    radix: 'hex' | 'dec'
  ): number | undefined {
    const source = offsetDigits(value, radix)
    const pattern = radix === 'hex' ? /^[0-9a-f]+$/i : /^[0-9]+$/
    if (!pattern.test(source)) {
      return undefined
    }

    const valueBase = radix === 'hex' ? 16 : 10
    const parsed = Number.parseInt(source, valueBase)
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
  }

  function formatOffset(offset: number): string {
    return offsetRadix === 'dec'
      ? formatNumber(offset)
      : `${HEX_PREFIX}${offset.toString(16).toUpperCase()}`
  }

  function formatOffsetInput(offset: number, radix: 'hex' | 'dec'): string {
    return radix === 'dec'
      ? String(offset)
      : offset.toString(16).toUpperCase()
  }

  function sanitizeOffsetText(value: string): string {
    return sanitizeOffsetTextForRadix(value, offsetRadix)
  }

  function sanitizeOffsetTextForRadix(
    value: string,
    radix: 'hex' | 'dec'
  ): string {
    if (radix === 'dec') {
      return value.replace(/\D/g, '')
    }

    const text = value.trim()
    const source = text.toLowerCase().startsWith(HEX_PREFIX)
      ? text.slice(HEX_PREFIX.length)
      : text
    return source.replace(/[^0-9a-f]/gi, '').toUpperCase()
  }

  function convertOffsetTextRadix(
    value: string,
    fromRadix: 'hex' | 'dec',
    toRadix: 'hex' | 'dec'
  ): string {
    const offset = parseOffset(value, fromRadix)
    return offset === undefined
      ? ''
      : formatOffsetInput(offset, toRadix)
  }

  function validateOffset(): string {
    if (!offsetDigits(offsetText, offsetRadix)) {
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

  function handleBeforeInput(event: InputEvent): void {
    if (event.inputType !== 'insertText' || !event.data) {
      return
    }

    const pattern = offsetRadix === 'dec' ? /^[0-9]+$/ : /^[0-9a-f]+$/i
    if (!pattern.test(event.data)) {
      event.preventDefault()
    }
  }

  function handleInput(event: Event): void {
    const input = event.currentTarget
    if (!(input instanceof HTMLInputElement)) {
      return
    }
    const sanitizedOffsetText = sanitizeOffsetText(input.value)
    offsetText = sanitizedOffsetText
    if (input.value !== sanitizedOffsetText) {
      input.value = sanitizedOffsetText
    }
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

  $effect(() => {
    if (offsetRadix === previousOffsetRadix) {
      return
    }

    offsetText = convertOffsetTextRadix(
      offsetText,
      previousOffsetRadix,
      offsetRadix
    )
    previousOffsetRadix = offsetRadix
    submitted = false
  })
</script>

<div class="offset-jump">
  <label class="offset-jump-label" for="offsetJumpInput">
    {strings.navigation.offsetLabel}
  </label>
  <span
    class="offset-jump-input-shell"
    class:hex={offsetRadix === 'hex'}
    class:invalid={showValidation}
  >
    {#if offsetRadix === 'hex'}
      <span class="offset-jump-prefix" aria-hidden="true">{HEX_PREFIX}</span>
    {/if}
    <input
      id="offsetJumpInput"
      class="offset-jump-input"
      value={offsetText}
      inputmode={offsetInputMode}
      pattern={offsetPattern}
      placeholder={placeholder}
      title={title}
      autocomplete="off"
      spellcheck={false}
      aria-invalid={showValidation ? 'true' : 'false'}
      aria-describedby={showValidation ? 'offsetJumpStatus' : undefined}
      onbeforeinput={handleBeforeInput}
      oninput={handleInput}
      onkeydown={handleKeydown}
    />
  </span>
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
