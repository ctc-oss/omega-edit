<script lang="ts">
  import { tick } from 'svelte'
  import { strings } from '../i18n'
  import {
    MAX_TRANSFORM_OPTIONS_LENGTH,
    type WebviewTransformPlugin,
  } from '../protocol'

  type OffsetRadix = 'hex' | 'dec'

  interface Props {
    plugins?: WebviewTransformPlugin[]
    pluginsLoaded?: boolean
    pluginsLoading?: boolean
    error?: string
    selectionStart?: number
    selectionEnd?: number
    selectionLength?: number
    offsetRadix?: OffsetRadix
    feedback?: string
    onRequestTransforms: () => void
    onApplyTransform: (pluginId: string, optionsJson?: string) => void
  }

  let {
    plugins = [],
    pluginsLoaded = false,
    pluginsLoading = false,
    error = '',
    selectionStart = -1,
    selectionEnd = -1,
    selectionLength = 0,
    offsetRadix = 'hex',
    feedback = '',
    onRequestTransforms,
    onApplyTransform,
  }: Props = $props()

  let selectedPluginId = $state('')
  let dialogOpen = $state(false)
  let optionsJson = $state('')
  let savedOptionsByPluginId = $state<Record<string, string>>({})
  let optionsInput = $state<HTMLInputElement>()
  let applyButton = $state<HTMLButtonElement>()

  const selectedPlugin = $derived(
    plugins.find((plugin) => plugin.id === selectedPluginId)
  )
  const canTransformSelection = $derived(
    selectionStart >= 0 && selectionLength > 0
  )
  const hasOptionsSchema = $derived(Boolean(selectedPlugin?.argsSchema))
  const advertisedExamples = $derived(advertisedTransformExamples(selectedPlugin))
  const optionHelp = $derived(getTransformOptionHelp(selectedPlugin))
  const validationError = $derived(
    selectedPlugin ? validateTransformOptions(selectedPlugin, optionsJson.trim()) : ''
  )
  const controlTitle = $derived(
    !canTransformSelection
      ? strings.transform.selectRangeFirst
      : error
        ? strings.transform.unavailable(error)
        : plugins.length === 0 && pluginsLoaded
          ? strings.transform.noTransforms
          : strings.transform.chooseTitle
  )
  const statusMessage = $derived(
    error || feedback || (pluginsLoading ? strings.transform.loading : '')
  )

  $effect(() => {
    if (selectedPluginId && !selectedPlugin) {
      selectedPluginId = ''
      dialogOpen = false
    }
  })

  function requestTransforms(): void {
    if (pluginsLoaded || pluginsLoading) {
      return
    }
    onRequestTransforms()
  }

  function formatOffset(offset: number): string {
    return offsetRadix === 'dec'
      ? offset.toLocaleString()
      : `0x${offset.toString(16).toUpperCase()}`
  }

  function transformOperationLabel(operation: number): string {
    switch (operation) {
      case 1:
        return strings.transform.operationReplace
      case 2:
        return strings.transform.operationInspect
      case 3:
        return strings.transform.operationReplaceInspect
      default:
        return strings.transform.operationTransform
    }
  }

  function advertisedTransformExamples(
    plugin: WebviewTransformPlugin | undefined
  ): string[] {
    const examples: string[] = []
    const addExample = (value: unknown): void => {
      const text = typeof value === 'string' ? value : JSON.stringify(value)
      if (text && !examples.includes(text)) {
        examples.push(text)
      }
    }

    if (plugin?.example) {
      try {
        const parsed = JSON.parse(plugin.example)
        if (Array.isArray(parsed)) {
          for (const example of parsed) {
            addExample(example)
          }
        } else {
          addExample(plugin.example)
        }
      } catch {
        addExample(plugin.example)
      }
    }

    if (plugin?.defaultArgs) {
      addExample(plugin.defaultArgs)
    }
    return examples
  }

  function getTransformOptionHelp(
    plugin: WebviewTransformPlugin | undefined
  ): {
    description: string
    help: string
    defaultArgs: string
    argsSchema: string
  } {
    return {
      description:
        plugin?.description ||
        plugin?.name ||
        plugin?.id ||
        strings.transform.noDescription,
      help: plugin?.help || '',
      defaultArgs: plugin?.defaultArgs || '',
      argsSchema: plugin?.argsSchema || '',
    }
  }

  function schemaObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  function matchesPattern(value: string, pattern: string): boolean | undefined {
    try {
      return new RegExp(pattern).test(value)
    } catch {
      return undefined
    }
  }

  function validateJsonSchemaValue(
    value: unknown,
    schema: unknown,
    path: string
  ): string {
    if (!schemaObject(schema)) {
      return ''
    }

    if (Array.isArray(schema.oneOf)) {
      const matches = schema.oneOf.filter(
        (candidate) => validateJsonSchemaValue(value, candidate, path) === ''
      )
      return matches.length === 1 ? '' : strings.transform.schemaOneOf(path)
    }

    if (schema.not && validateJsonSchemaValue(value, schema.not, path) === '') {
      return strings.transform.schemaNot(path)
    }

    if (schema.type === 'object') {
      if (!schemaObject(value)) {
        return strings.transform.schemaObject(path)
      }
      const keys = Object.keys(value)
      if (Array.isArray(schema.required)) {
        const missing = schema.required.find(
          (key) =>
            typeof key === 'string' &&
            !Object.prototype.hasOwnProperty.call(value, key)
        )
        if (typeof missing === 'string') {
          return strings.transform.schemaRequired(path, missing)
        }
      }
      if (
        Number.isInteger(schema.maxProperties) &&
        keys.length > Number(schema.maxProperties)
      ) {
        return strings.transform.schemaMaxProperties(path)
      }

      const properties = schemaObject(schema.properties)
        ? schema.properties
        : {}
      if (schema.additionalProperties === false) {
        const unknown = keys.find(
          (key) => !Object.prototype.hasOwnProperty.call(properties, key)
        )
        if (unknown) {
          return strings.transform.schemaUnknown(path, unknown)
        }
      }

      for (const key of keys) {
        if (schemaObject(properties) && properties[key]) {
          const error = validateJsonSchemaValue(
            value[key],
            properties[key],
            `${path}.${key}`
          )
          if (error) {
            return error
          }
        }
      }
    }

    if (schema.type === 'array') {
      if (!Array.isArray(value)) {
        return strings.transform.schemaArray(path)
      }
      if (
        Number.isInteger(schema.minItems) &&
        value.length < Number(schema.minItems)
      ) {
        return strings.transform.schemaMinItems(path, Number(schema.minItems))
      }
      if (schema.items) {
        for (let index = 0; index < value.length; index += 1) {
          const error = validateJsonSchemaValue(
            value[index],
            schema.items,
            `${path}[${index}]`
          )
          if (error) {
            return error
          }
        }
      }
    }

    if (schema.type === 'string') {
      if (typeof value !== 'string') {
        return strings.transform.schemaString(path)
      }
      if (
        typeof schema.pattern === 'string'
      ) {
        const matches = matchesPattern(value, schema.pattern)
        if (matches === undefined) {
          return strings.transform.invalidSchema
        }
        if (!matches) {
          return strings.transform.schemaPattern(path)
        }
      }
    }

    if (schema.type === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return strings.transform.schemaInteger(path)
      }
      if (typeof schema.minimum === 'number' && value < schema.minimum) {
        return strings.transform.schemaMinimum(path, schema.minimum)
      }
      if (typeof schema.maximum === 'number' && value > schema.maximum) {
        return strings.transform.schemaMaximum(path, schema.maximum)
      }
    }

    if (schema.type === 'number' && typeof value !== 'number') {
      return strings.transform.schemaNumber(path)
    }

    if (schema.type === 'boolean' && typeof value !== 'boolean') {
      return strings.transform.schemaBoolean(path)
    }

    return ''
  }

  function validateTransformOptions(
    plugin: WebviewTransformPlugin,
    rawOptionsJson: string
  ): string {
    if (rawOptionsJson.length === 0) {
      return ''
    }

    let parsedOptions: unknown
    try {
      parsedOptions = JSON.parse(rawOptionsJson)
    } catch {
      return strings.transform.invalidJson
    }

    if (!plugin.argsSchema) {
      return strings.transform.noSchema
    }

    let schema: unknown
    try {
      schema = JSON.parse(plugin.argsSchema)
    } catch {
      return strings.transform.invalidSchema
    }

    return validateJsonSchemaValue(parsedOptions, schema, strings.transform.optionsPath)
  }

  async function openTransformDialog(pluginId: string): Promise<void> {
    const plugin = plugins.find((entry) => entry.id === pluginId)
    selectedPluginId = pluginId
    if (!plugin) {
      return
    }

    optionsJson = plugin.argsSchema
      ? (savedOptionsByPluginId[plugin.id] ?? plugin.defaultArgs ?? '')
      : ''
    dialogOpen = true
    await tick()
    if (plugin.argsSchema) {
      optionsInput?.focus()
    } else {
      applyButton?.focus()
    }
  }

  function handleSelectChange(event: Event): void {
    const select = event.currentTarget
    if (!(select instanceof HTMLSelectElement)) {
      return
    }
    if (select.value) {
      void openTransformDialog(select.value)
    }
  }

  function closeTransformDialog(): void {
    dialogOpen = false
    selectedPluginId = ''
    optionsJson = ''
  }

  function useTransformOptionExample(index: number): void {
    if (!hasOptionsSchema || index < 0 || index >= advertisedExamples.length) {
      return
    }
    optionsJson = advertisedExamples[index]
    void tick().then(() => optionsInput?.focus())
  }

  function applySelectedTransform(): void {
    const plugin = selectedPlugin
    if (!plugin || validationError || !canTransformSelection) {
      return
    }

    const trimmedOptions = optionsJson.trim()
    if (trimmedOptions) {
      savedOptionsByPluginId = {
        ...savedOptionsByPluginId,
        [plugin.id]: trimmedOptions,
      }
    } else {
      const remainingOptions = { ...savedOptionsByPluginId }
      delete remainingOptions[plugin.id]
      savedOptionsByPluginId = remainingOptions
    }
    onApplyTransform(plugin.id, trimmedOptions || undefined)
    closeTransformDialog()
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeTransformDialog()
    }
  }

  function handleOptionsKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !validationError) {
      event.preventDefault()
      applySelectedTransform()
    }
  }
</script>

<div class="transform-panel">
  <label class="transform-label" for="transformSelect">
    {strings.transform.label}
  </label>
  <select
    id="transformSelect"
    class="transform-select"
    disabled={!canTransformSelection}
    title={controlTitle}
    value={selectedPluginId}
    onfocus={requestTransforms}
    onpointerdown={requestTransforms}
    onchange={handleSelectChange}
  >
    {#if !canTransformSelection}
      <option value="">{strings.transform.selectRange}</option>
    {:else if plugins.length === 0}
      <option value="">
        {pluginsLoading
          ? strings.transform.loading
          : pluginsLoaded
            ? strings.transform.noTransforms
            : strings.transform.choose}
      </option>
    {:else}
      <option value="">{strings.transform.choose}</option>
      {#each plugins as plugin (plugin.id)}
        <option value={plugin.id} title={plugin.description || plugin.id}>
          {plugin.name || plugin.id}
        </option>
      {/each}
    {/if}
  </select>
  {#if statusMessage}
    <span class="transform-status" aria-live="polite">{statusMessage}</span>
  {/if}
</div>

{#if dialogOpen && selectedPlugin}
  <button
    type="button"
    class="dialog-backdrop"
    aria-label={strings.transform.closeDialog}
    onclick={closeTransformDialog}
  ></button>
  <div
    class="transform-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="transformDialogTitle"
    tabindex="-1"
    onkeydown={handleDialogKeydown}
  >
    <h2 id="transformDialogTitle">{selectedPlugin.name || selectedPlugin.id}</h2>
    <div class="transform-dialog-body">
      <div class="help-muted">
        {selectedPlugin.id} | {transformOperationLabel(selectedPlugin.operation)}
      </div>
      <p>{optionHelp.description}</p>

      <div class="help-section-title">{strings.transform.selectedRange}</div>
      <div class="analysis-metrics">
        <span class="analysis-label">{strings.transform.start}</span>
        <span class="analysis-value">{formatOffset(selectionStart)}</span>
        <span class="analysis-label">{strings.transform.end}</span>
        <span class="analysis-value">{formatOffset(selectionEnd)}</span>
        <span class="analysis-label">{strings.transform.length}</span>
        <span class="analysis-value">{strings.transform.bytes(selectionLength)}</span>
      </div>

      {#if optionHelp.help}
        <div class="help-section-title">
          {hasOptionsSchema ? strings.transform.optionsJson : strings.transform.help}
        </div>
        <p>{optionHelp.help}</p>
      {/if}

      {#if advertisedExamples.length > 0}
        <div class="help-section-title">{strings.transform.examples}</div>
        <div class="help-examples">
          {#each advertisedExamples as example, index}
            {#if hasOptionsSchema}
              <button
                type="button"
                class="help-example"
                title={strings.transform.useExample}
                onclick={() => useTransformOptionExample(index)}
              >
                {example}
              </button>
            {:else}
              <span class="help-example">{example}</span>
            {/if}
          {/each}
        </div>
      {/if}

      {#if hasOptionsSchema}
        <label class="transform-options-field">
          <span>{strings.transform.optionsJson}</span>
          <input
            bind:this={optionsInput}
            value={optionsJson}
            maxlength={MAX_TRANSFORM_OPTIONS_LENGTH}
            placeholder={advertisedExamples[0]
              ? strings.transform.examplePlaceholder(advertisedExamples[0])
              : strings.transform.optionsPlaceholder}
            aria-invalid={validationError ? 'true' : 'false'}
            oninput={(event) => {
              const input = event.currentTarget
              if (input instanceof HTMLInputElement) {
                optionsJson = input.value
              }
            }}
            onkeydown={handleOptionsKeydown}
          />
        </label>
      {/if}

      {#if validationError}
        <div class="transform-error" aria-live="polite">{validationError}</div>
      {/if}
    </div>

    <div class="dialog-actions">
      <button type="button" class="secondary" onclick={closeTransformDialog}>
        {strings.transform.cancel}
      </button>
      <button
        bind:this={applyButton}
        type="button"
        disabled={Boolean(validationError)}
        onclick={applySelectedTransform}
      >
        {strings.transform.apply}
      </button>
    </div>
  </div>
{/if}
