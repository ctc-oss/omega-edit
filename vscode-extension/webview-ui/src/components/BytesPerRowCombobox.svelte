<script lang="ts">
  import {
    FIXED_BYTES_PER_ROW_OPTIONS,
    MAX_BYTES_PER_ROW,
    MIN_BYTES_PER_ROW,
    type BytesPerRow,
  } from '../protocol'
  import { strings } from '../i18n'

  interface Props {
    bytesPerRow: BytesPerRow
    onBytesPerRow: (bytesPerRow: BytesPerRow) => void
  }

  let { bytesPerRow, onBytesPerRow }: Props = $props()

  const rowOptions: BytesPerRow[] = [...FIXED_BYTES_PER_ROW_OPTIONS]
  let inputValue = $state('')
  let menuOpen = $state(false)
  let filterOptions = $state(false)
  let activeOptionIndex = $state(-1)
  let validationVisible = $state(false)
  let control = $state<HTMLDivElement>()
  let input = $state<HTMLInputElement>()
  const visibleOptions = $derived(
    filterOptions && inputValue
      ? rowOptions.filter((option) => String(option).startsWith(inputValue))
      : rowOptions
  )
  const validationMessage = $derived(validateValue(inputValue))

  function validateValue(value: string): string {
    if (!value.trim()) {
      return strings.toolbar.bytesPerRowRequired
    }
    const parsedValue = Number(value)
    if (!Number.isInteger(parsedValue)) {
      return strings.toolbar.bytesPerRowInteger
    }
    if (parsedValue < MIN_BYTES_PER_ROW || parsedValue > MAX_BYTES_PER_ROW) {
      return strings.toolbar.bytesPerRowRange(
        MIN_BYTES_PER_ROW,
        MAX_BYTES_PER_ROW
      )
    }
    return ''
  }

  function commitValue(force = false): void {
    validationVisible = true
    if (validationMessage) {
      return
    }
    const nextValue = Number.parseInt(inputValue, 10) as BytesPerRow
    if (force || nextValue !== bytesPerRow) {
      onBytesPerRow(nextValue)
    }
  }

  function openMenu(): void {
    filterOptions = false
    menuOpen = true
    const selectedIndex = rowOptions.indexOf(bytesPerRow)
    activeOptionIndex = selectedIndex >= 0 ? selectedIndex : 0
  }

  function closeMenu(): void {
    menuOpen = false
    activeOptionIndex = -1
  }

  function selectOption(option: BytesPerRow): void {
    inputValue = String(option)
    validationVisible = false
    closeMenu()
    onBytesPerRow(option)
    input?.focus()
  }

  function moveActiveOption(direction: 1 | -1): void {
    const optionCount = visibleOptions.length
    if (optionCount === 0) {
      activeOptionIndex = -1
      return
    }
    activeOptionIndex =
      (activeOptionIndex + direction + optionCount) % optionCount
  }

  function handleInput(event: Event): void {
    const target = event.currentTarget as HTMLInputElement
    const sanitizedValue = target.value.replace(/\D/g, '')
    inputValue = sanitizedValue
    if (target.value !== sanitizedValue) {
      target.value = sanitizedValue
    }
    if (menuOpen) {
      filterOptions = true
      activeOptionIndex = -1
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault()
      openMenu()
      return
    }
    if (menuOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      moveActiveOption(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const activeOption = visibleOptions[activeOptionIndex]
      if (menuOpen && activeOption !== undefined) {
        selectOption(activeOption)
      } else {
        closeMenu()
        commitValue(true)
      }
      return
    }
    if (
      event.key === 'Escape' &&
      (menuOpen || inputValue !== String(bytesPerRow))
    ) {
      event.preventDefault()
      inputValue = String(bytesPerRow)
      validationVisible = false
      closeMenu()
    }
  }

  function handleFocusOut(event: FocusEvent): void {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && control?.contains(nextTarget)) {
      return
    }
    closeMenu()
    commitValue()
  }

  function toggleMenu(): void {
    if (menuOpen) {
      closeMenu()
    } else {
      openMenu()
    }
    input?.focus()
  }

  $effect(() => {
    inputValue = String(bytesPerRow)
    validationVisible = false
  })
</script>

<div class="bytes-per-row-control" bind:this={control} onfocusout={handleFocusOut}>
  <label class="toolbar-select-control" for="bytesPerRowInput">
    {strings.toolbar.bytesPerRowSelect}
  </label>
  <div
    class="bytes-per-row-combobox"
    class:invalid={validationVisible && validationMessage}
  >
    <input
      id="bytesPerRowInput"
      bind:this={input}
      class="bytes-per-row-input"
      type="number"
      min={MIN_BYTES_PER_ROW}
      max={MAX_BYTES_PER_ROW}
      step="1"
      value={inputValue}
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={menuOpen}
      aria-controls="bytesPerRowOptions"
      aria-invalid={validationVisible && validationMessage ? 'true' : 'false'}
      aria-describedby={
        validationVisible && validationMessage && !menuOpen
          ? 'bytesPerRowValidation'
          : undefined
      }
      aria-activedescendant={
        menuOpen && activeOptionIndex >= 0
          ? `bytesPerRowOption${activeOptionIndex}`
          : undefined
      }
      aria-label={strings.toolbar.customBytesPerRow}
      title={strings.toolbar.customBytesPerRowTitle(
        MIN_BYTES_PER_ROW,
        MAX_BYTES_PER_ROW
      )}
      oninput={handleInput}
      onchange={() => commitValue()}
      onkeydown={handleKeydown}
    />
    <button
      type="button"
      class="bytes-per-row-toggle"
      aria-label={strings.toolbar.bytesPerRowOptions}
      title={strings.toolbar.bytesPerRowOptions}
      aria-expanded={menuOpen}
      aria-controls="bytesPerRowOptions"
      onmousedown={(event) => event.preventDefault()}
      onclick={toggleMenu}
    >
      <span class="bytes-per-row-chevron" aria-hidden="true"></span>
    </button>
    {#if menuOpen && visibleOptions.length > 0}
      <div
        id="bytesPerRowOptions"
        class="bytes-per-row-options"
        role="listbox"
        aria-label={strings.toolbar.bytesPerRowOptions}
      >
        {#each visibleOptions as option, index}
          <button
            id={`bytesPerRowOption${index}`}
            type="button"
            role="option"
            class:active={index === activeOptionIndex}
            aria-selected={option === bytesPerRow}
            tabindex="-1"
            onmousedown={(event) => event.preventDefault()}
            onclick={() => selectOption(option)}
          >
            <span>{option}</span>
            {#if option === bytesPerRow}
              <span class="bytes-per-row-check" aria-hidden="true">✓</span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
    {#if validationVisible && validationMessage && !menuOpen}
      <span
        id="bytesPerRowValidation"
        class="bytes-per-row-validation"
        role="alert"
      >
        {validationMessage}
      </span>
    {/if}
  </div>
</div>
