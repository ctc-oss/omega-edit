<script lang="ts">
  import { tick } from 'svelte'
  import { formatNumber, strings } from '../i18n'
  import {
    MAX_TRANSFORM_OPTIONS_LENGTH,
    type WebviewSessionContentInfo,
    type WebviewSessionContentSource,
    type WebviewTransformPlugin,
  } from '../protocol'

  type OffsetRadix = 'hex' | 'dec'
  type JsonObject = Record<string, unknown>
  type TransformOptionControl = 'checkbox' | 'number' | 'select' | 'text'
  type FileSpliceActionId =
    | 'exportRange'
    | 'insertFile'
    | 'replaceRangeWithFile'
  type SessionActionId =
    | 'createCheckpoint'
    | 'rollbackCheckpoint'
    | 'restoreCheckpoint'
    | 'exportChangeLog'
    | 'applyChangeLog'

  const TRANSFORM_ACTION_PREFIX = 'transform:'
  const FILE_ACTION_PREFIX = 'file:'
  const SESSION_ACTION_PREFIX = 'session:'

  interface TransformOptionChoice {
    label: string
    value: string
  }

  interface TransformPluginGroup {
    label: string
    plugins: WebviewTransformPlugin[]
  }

  interface TransformOptionGroup {
    label: string
    options: TransformOptionChoice[]
  }

  interface TransformOptionField {
    key: string
    id: string
    label: string
    description: string
    type: string
    control: TransformOptionControl
    required: boolean
    value: string
    checked: boolean
    choices: TransformOptionChoice[]
    groups: TransformOptionGroup[]
    ungroupedChoices: TransformOptionChoice[]
    minimum?: number
    maximum?: number
    step?: string
    placeholder?: string
    acceptsInteger?: boolean
    arrayItemsAcceptInteger?: boolean
    clears: string[]
  }

  interface Props {
    plugins?: WebviewTransformPlugin[]
    pluginsLoaded?: boolean
    pluginsLoading?: boolean
    busy?: boolean
    cancelable?: boolean
    error?: string
    fileSize?: number
    contentSources?: WebviewSessionContentInfo[]
    selectedOffset?: number
    selectionStart?: number
    selectionEnd?: number
    selectionLength?: number
    offsetRadix?: OffsetRadix
    feedback?: string
    results?: TransformResultHistoryItem[]
    presets?: TransformPresetHistoryItem[]
    metadata?: TransformMetadataItem
    activeTransformResultId?: string
    onRequestTransforms: () => void
    onCancelTransform: () => void
    onApplyTransform: (
      pluginId: string,
      contentSource: WebviewSessionContentSource,
      offset: number,
      length: number,
      optionsJson?: string
    ) => void
    onExportRange: (offset: number, length: number) => void
    onInsertFile: (offset: number) => void
    onReplaceRangeWithFile: (offset: number, length: number) => void
    onOpenTransformResult: (resultId: string) => void
    onCreateCheckpoint: () => void
    onRollbackCheckpoint: () => void
    onRestoreCheckpoint: () => void
    onExportChangeLog: () => void
    onApplyChangeLog: () => void
  }

  interface TransformResultHistoryItem {
    id: string
    title: string
    summary: string
    label: string
    rangeStart: string
    rangeEnd: string
    historyLabel: string
  }

  interface TransformPresetHistoryItem {
    id: string
    pluginId: string
    pluginName: string
    optionsJson: string
    descriptorJson: string
    descriptorHex: string
    createdAtLabel: string
    summary: string
  }

  interface TransformMetadataItem {
    pluginName: string
    operationLabel: string
    contentSourceLabel: string
    contentChangedLabel: string
    serialLabel: string
    rangeLabel: string
    lengthLabel: string
    replacementLengthLabel: string
    computedFileSizeLabel: string
    descriptorJson: string
    descriptorHex: string
    summary: string
  }

  interface TransformDescriptorPreview {
    json: string
    hex: string
    error: string
  }

  interface TransformRangeState {
    offset: number
    end: number
    length: number
    error: string
  }

  let {
    plugins = [],
    pluginsLoaded = false,
    pluginsLoading = false,
    busy = false,
    cancelable = false,
    error = '',
    fileSize = 0,
    contentSources = [],
    selectedOffset = -1,
    selectionStart = -1,
    selectionEnd = -1,
    selectionLength = 0,
    offsetRadix = 'hex',
    feedback = '',
    results = [],
    presets = [],
    metadata,
    activeTransformResultId = '',
    onRequestTransforms,
    onCancelTransform,
    onApplyTransform,
    onExportRange,
    onInsertFile,
    onReplaceRangeWithFile,
    onOpenTransformResult,
    onCreateCheckpoint,
    onRollbackCheckpoint,
    onRestoreCheckpoint,
    onExportChangeLog,
    onApplyChangeLog,
  }: Props = $props()

  let selectedPluginId = $state('')
  let selectedFileAction = $state<FileSpliceActionId | ''>('')
  let selectedContentSource = $state<WebviewSessionContentSource>('computed')
  let dialogOpen = $state(false)
  let pluginSearch = $state('')
  let optionsJson = $state('')
  let rangeStartInput = $state('')
  let rangeEndInput = $state('')
  let savedOptionsByPluginId = $state<Record<string, string>>({})
  let optionsInput = $state<HTMLElement>()
  let applyButton = $state<HTMLButtonElement>()
  let resultHistoryMenu = $state<HTMLDetailsElement>()
  let presetHistoryMenu = $state<HTMLDetailsElement>()
  let metadataMenu = $state<HTMLDetailsElement>()

  const selectedPlugin = $derived(
    plugins.find((plugin) => plugin.id === selectedPluginId)
  )
  const normalizedContentSources = $derived(
    normalizeContentSources(contentSources, fileSize)
  )
  const canUseInspectableContent = $derived(
    !busy && normalizedContentSources.some((source) => source.available)
  )
  const selectedContentInfo = $derived(
    normalizedContentSources.find(
      (source) => source.content === selectedContentSource && source.available
    ) ?? normalizedContentSources.find((source) => source.content === 'computed')
  )
  const selectedRangeByteLength = $derived(
    selectedFileAction
      ? fileSize
      : isInspectOnlyTransform(selectedPlugin)
        ? (selectedContentInfo?.byteLength ?? 0)
        : fileSize
  )
  const filteredTransformPlugins = $derived(
    filterTransformPlugins(plugins, pluginSearch)
  )
  const groupedTransformPlugins = $derived(
    groupTransformPlugins(filteredTransformPlugins)
  )
  const selectedActionValue = $derived(
    selectedFileAction
      ? `${FILE_ACTION_PREFIX}${selectedFileAction}`
      : selectedPluginId
        ? `${TRANSFORM_ACTION_PREFIX}${selectedPluginId}`
        : ''
  )
  const canTransformSelection = $derived(
    !busy && selectionStart >= 0 && selectionLength > 0
  )
  const canUseFileRangeAction = $derived(!busy && fileSize > 0)
  const canUseActions = $derived(!busy)
  const hasOptionsSchema = $derived(Boolean(selectedPlugin?.argsSchema))
  const optionSchema = $derived(
    parseJsonObject(selectedPlugin?.argsSchema || '')
  )
  const transformOptionFields = $derived(
    buildTransformOptionFields(optionSchema, optionsJson)
  )
  const hasOptionForm = $derived(transformOptionFields.length > 0)
  const advertisedExamples = $derived(advertisedTransformExamples(selectedPlugin))
  const optionHelp = $derived(getTransformOptionHelp(selectedPlugin))
  const transformRange = $derived(
    validateTransformRange(rangeStartInput, rangeEndInput, selectedRangeByteLength)
  )
  const insertOffset = $derived(validateInsertOffset(rangeStartInput))
  const optionsValidationError = $derived(
    selectedPlugin ? validateTransformOptions(selectedPlugin, optionsJson.trim()) : ''
  )
  const descriptorPreview = $derived(
    selectedPlugin
      ? createTransformDescriptorPreview(selectedPlugin.id, optionsJson)
      : undefined
  )
  const canApplyTransform = $derived(
    Boolean(selectedPlugin && canUseTransformPlugin(selectedPlugin)) &&
      transformRange.error === '' &&
      transformRange.length > 0 &&
      optionsValidationError === '' &&
      descriptorPreview?.error === '' &&
      !busy
  )
  const canApplyFileAction = $derived(
    selectedFileAction !== '' &&
      !busy &&
      (selectedFileAction === 'insertFile'
        ? insertOffset.error === ''
        : transformRange.error === '' && transformRange.length > 0)
  )
  const controlTitle = $derived(
    busy ? strings.transform.inFlight : strings.transform.chooseTitle
  )
  const statusMessage = $derived(
    busy
      ? feedback || strings.transform.inFlight
      : error || feedback || (pluginsLoading ? strings.transform.loading : '')
  )
  const latestResult = $derived(results[0])
  const resultHistorySummary = $derived(
    latestResult?.summary || strings.transform.resultHistoryLabel
  )
  const presetHistorySummary = $derived(
    presets[0]?.pluginName || strings.transform.presetHistoryLabel
  )

  $effect(() => {
    if (selectedPluginId && !selectedPlugin) {
      selectedPluginId = ''
      dialogOpen = false
    }
  })

  $effect(() => {
    if (
      !normalizedContentSources.some(
        (source) => source.content === selectedContentSource && source.available
      )
    ) {
      selectedContentSource = 'computed'
    }
  })

  function requestTransforms(): void {
    if (pluginsLoaded || pluginsLoading) {
      return
    }
    onRequestTransforms()
  }

  function contentSourceFallbackLabel(
    content: WebviewSessionContentSource
  ): string {
    switch (content) {
      case 'original':
        return strings.transform.contentOriginal
      case 'latestCheckpoint':
        return strings.transform.contentLatestCheckpoint
      case 'computed':
        return strings.transform.contentComputed
    }
  }

  function normalizeContentSources(
    sources: WebviewSessionContentInfo[],
    computedByteLength: number
  ): WebviewSessionContentInfo[] {
    const byContent = new Map<WebviewSessionContentSource, WebviewSessionContentInfo>()
    for (const source of sources) {
      byContent.set(source.content, {
        ...source,
        label: source.label || contentSourceFallbackLabel(source.content),
      })
    }
    byContent.set('computed', {
      ...(byContent.get('computed') ?? {}),
      content: 'computed',
      available: true,
      byteLength: computedByteLength,
      label:
        byContent.get('computed')?.label || strings.transform.contentComputed,
    })
    return [
      byContent.get('computed'),
      byContent.get('original'),
      byContent.get('latestCheckpoint'),
    ].filter((source): source is WebviewSessionContentInfo => Boolean(source))
  }

  function formatOffset(offset: number): string {
    return offsetRadix === 'dec'
      ? formatNumber(offset)
      : `0x${offset.toString(16).toUpperCase()}`
  }

  function formatOffsetInput(offset: number): string {
    return offsetRadix === 'dec'
      ? Math.max(0, offset).toString()
      : `0x${Math.max(0, offset).toString(16).toUpperCase()}`
  }

  function parseOffsetInput(value: string): number | undefined {
    const text = value.trim()
    if (text.length === 0) {
      return undefined
    }

    const isExplicitHex = /^0x/i.test(text)
    const source = isExplicitHex ? text.slice(2) : text
    const base = isExplicitHex || offsetRadix === 'hex' ? 16 : 10
    const pattern = base === 16 ? /^[0-9a-f]+$/i : /^[0-9]+$/
    if (!pattern.test(source)) {
      return undefined
    }

    const offset = Number.parseInt(source, base)
    return Number.isSafeInteger(offset) && offset >= 0 ? offset : undefined
  }

  function validateTransformRange(
    startInput: string,
    endInput: string,
    byteLength: number
  ): TransformRangeState {
    const emptyRange = { offset: -1, end: -1, length: 0 }
    if (byteLength <= 0) {
      return { ...emptyRange, error: strings.transform.noFileRange }
    }

    const maxOffset = byteLength - 1
    const start = parseOffsetInput(startInput)
    const end = parseOffsetInput(endInput)
    if (start === undefined || end === undefined) {
      return { ...emptyRange, error: strings.transform.invalidRangeOffset }
    }
    if (start > maxOffset || end > maxOffset) {
      return {
        ...emptyRange,
        error: strings.transform.rangeOutOfBounds(formatOffset(maxOffset)),
      }
    }
    if (end < start) {
      return { ...emptyRange, error: strings.transform.rangeEndBeforeStart }
    }

    return { offset: start, end, length: end - start + 1, error: '' }
  }

  function validateInsertOffset(input: string): { offset: number; error: string } {
    const offset = parseOffsetInput(input)
    if (offset === undefined) {
      return { offset: -1, error: strings.transform.invalidInsertOffset }
    }
    if (offset > fileSize) {
      return {
        offset: -1,
        error: strings.transform.insertOffsetOutOfBounds(formatOffset(fileSize)),
      }
    }
    return { offset, error: '' }
  }

  function defaultRangeStart(): number {
    if (selectionStart >= 0) {
      return Math.min(selectionStart, Math.max(0, selectedRangeByteLength - 1))
    }
    if (selectedOffset >= 0) {
      return Math.max(
        0,
        Math.min(selectedOffset, Math.max(0, selectedRangeByteLength - 1))
      )
    }
    return 0
  }

  function defaultInsertOffset(): number {
    if (selectionStart >= 0) {
      return selectionStart
    }
    if (selectedOffset >= 0) {
      return Math.max(0, Math.min(selectedOffset, fileSize))
    }
    return Math.max(0, fileSize)
  }

  function resetRangeInputs(): void {
    const start = defaultRangeStart()
    const maxEnd = Math.max(0, selectedRangeByteLength - 1)
    const end = selectionEnd >= start ? Math.min(selectionEnd, maxEnd) : start
    rangeStartInput = formatOffsetInput(start)
    rangeEndInput = formatOffsetInput(end)
  }

  function resetInsertOffsetInput(): void {
    const offset = defaultInsertOffset()
    rangeStartInput = formatOffsetInput(offset)
    rangeEndInput = formatOffsetInput(offset)
  }

  function useMaxRangeEnd(): void {
    if (selectedRangeByteLength <= 0) {
      return
    }
    rangeEndInput = formatOffsetInput(selectedRangeByteLength - 1)
  }

  function useMaxInsertOffset(): void {
    rangeStartInput = formatOffsetInput(Math.max(0, fileSize))
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

  function transformPluginSortKey(plugin: WebviewTransformPlugin): string {
    return plugin.name || plugin.id
  }

  function sortTransformPlugins(
    entries: WebviewTransformPlugin[]
  ): WebviewTransformPlugin[] {
    return [...entries].sort((left, right) => {
      const byName = transformPluginSortKey(left).localeCompare(
        transformPluginSortKey(right),
        undefined,
        { sensitivity: 'base' }
      )
      return byName || left.id.localeCompare(right.id)
    })
  }

  function filterTransformPlugins(
    entries: WebviewTransformPlugin[],
    query: string
  ): WebviewTransformPlugin[] {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
      return entries
    }

    return entries.filter((plugin) =>
      [
        plugin.id,
        plugin.name,
        plugin.description,
        plugin.help,
        transformOperationLabel(plugin.operation),
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery)
    )
  }

  function isMutatingTransform(plugin: WebviewTransformPlugin): boolean {
    return plugin.operation !== 2
  }

  function isInspectOnlyTransform(
    plugin: WebviewTransformPlugin | undefined
  ): boolean {
    return plugin?.operation === 2
  }

  function canUseTransformPlugin(plugin: WebviewTransformPlugin): boolean {
    return isInspectOnlyTransform(plugin)
      ? canUseInspectableContent
      : canTransformSelection
  }

  function groupTransformPlugins(
    entries: WebviewTransformPlugin[]
  ): TransformPluginGroup[] {
    const groups = [
      {
        label: strings.transform.calculationsGroup,
        plugins: sortTransformPlugins(
          entries.filter((plugin) => !isMutatingTransform(plugin))
        ),
      },
      {
        label: strings.transform.transformsGroup,
        plugins: sortTransformPlugins(
          entries.filter((plugin) => isMutatingTransform(plugin))
        ),
      },
    ].filter((group) => group.plugins.length > 0)

    return groups.sort((left, right) =>
      left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })
    )
  }

  function transformActionValue(pluginId: string): string {
    return `${TRANSFORM_ACTION_PREFIX}${pluginId}`
  }

  function fileActionValue(action: FileSpliceActionId): string {
    return `${FILE_ACTION_PREFIX}${action}`
  }

  function sessionActionValue(action: SessionActionId): string {
    return `${SESSION_ACTION_PREFIX}${action}`
  }

  function parseFileActionValue(value: string): FileSpliceActionId | undefined {
    if (!value.startsWith(FILE_ACTION_PREFIX)) {
      return undefined
    }
    const action = value.slice(FILE_ACTION_PREFIX.length)
    return action === 'exportRange' ||
      action === 'insertFile' ||
      action === 'replaceRangeWithFile'
      ? action
      : undefined
  }

  function parseSessionActionValue(value: string): SessionActionId | undefined {
    if (!value.startsWith(SESSION_ACTION_PREFIX)) {
      return undefined
    }
    const action = value.slice(SESSION_ACTION_PREFIX.length)
    return action === 'createCheckpoint' ||
      action === 'rollbackCheckpoint' ||
      action === 'restoreCheckpoint' ||
      action === 'exportChangeLog' ||
      action === 'applyChangeLog'
      ? action
      : undefined
  }

  function fileActionLabel(action: FileSpliceActionId | ''): string {
    switch (action) {
      case 'exportRange':
        return strings.transform.exportRange
      case 'insertFile':
        return strings.transform.insertFile
      case 'replaceRangeWithFile':
        return strings.transform.replaceRangeWithFile
      default:
        return ''
    }
  }

  function fileActionDescription(action: FileSpliceActionId | ''): string {
    switch (action) {
      case 'exportRange':
        return strings.transform.exportRangeDescription
      case 'insertFile':
        return strings.transform.insertFileDescription
      case 'replaceRangeWithFile':
        return strings.transform.replaceRangeWithFileDescription
      default:
        return ''
    }
  }

  function fileActionApplyLabel(action: FileSpliceActionId | ''): string {
    switch (action) {
      case 'exportRange':
        return strings.transform.exportRangeApply
      case 'insertFile':
        return strings.transform.insertFileApply
      case 'replaceRangeWithFile':
        return strings.transform.replaceRangeWithFileApply
      default:
        return strings.transform.apply
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

  function parseJsonObject(rawJson: string): JsonObject | undefined {
    if (!rawJson.trim()) {
      return undefined
    }
    try {
      const parsed: unknown = JSON.parse(rawJson)
      return schemaObject(parsed) ? parsed : undefined
    } catch {
      return undefined
    }
  }

  function parseTransformDescriptorArgs(rawOptionsJson: string): JsonObject {
    const text = rawOptionsJson.trim()
    if (!text) {
      return {}
    }
    const parsed: unknown = JSON.parse(text)
    if (!schemaObject(parsed)) {
      throw new Error(strings.transform.schemaObject(strings.transform.optionsPath))
    }
    return parsed
  }

  function canonicalizeTransformDescriptorValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map(canonicalizeTransformDescriptorValue)
    }
    if (!schemaObject(value)) {
      return value
    }
    return Object.keys(value)
      .sort()
      .reduce<JsonObject>((canonical, key) => {
        canonical[key] = canonicalizeTransformDescriptorValue(value[key])
        return canonical
      }, {})
  }

  function canonicalizeTransformDescriptorArgs(args: JsonObject): JsonObject {
    return canonicalizeTransformDescriptorValue(args) as JsonObject
  }

  function utf8ToHex(value: string): string {
    return Array.from(new TextEncoder().encode(value), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('')
  }

  function createTransformDescriptorPreview(
    transformId: string,
    rawOptionsJson: string
  ): TransformDescriptorPreview {
    try {
      const args = canonicalizeTransformDescriptorArgs(
        parseTransformDescriptorArgs(rawOptionsJson)
      )
      const descriptorJson = JSON.stringify({
        transformId: transformId.trim(),
        args,
      })
      return {
        json: descriptorJson,
        hex: utf8ToHex(descriptorJson),
        error: '',
      }
    } catch (error) {
      return {
        json: '',
        hex: '',
        error:
          error instanceof Error && error.message
            ? error.message
            : strings.transform.invalidJson,
      }
    }
  }

  function jsonValuesEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) {
      return true
    }
    if (Array.isArray(left) || Array.isArray(right)) {
      return (
        Array.isArray(left) &&
        Array.isArray(right) &&
        left.length === right.length &&
        left.every((item, index) => jsonValuesEqual(item, right[index]))
      )
    }
    if (schemaObject(left) || schemaObject(right)) {
      if (!schemaObject(left) || !schemaObject(right)) {
        return false
      }
      const leftKeys = Object.keys(left)
      const rightKeys = Object.keys(right)
      return (
        leftKeys.length === rightKeys.length &&
        leftKeys.every(
          (key) =>
            Object.prototype.hasOwnProperty.call(right, key) &&
            jsonValuesEqual(left[key], right[key])
        )
      )
    }
    return false
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

    if (Array.isArray(schema.enum)) {
      const matches = schema.enum.some((candidate) =>
        jsonValuesEqual(value, candidate)
      )
      if (!matches) {
        return strings.transform.schemaEnum(path)
      }
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

    if (schema.type === 'number') {
      if (typeof value !== 'number') {
        return strings.transform.schemaNumber(path)
      }
      if (typeof schema.minimum === 'number' && value < schema.minimum) {
        return strings.transform.schemaMinimum(path, schema.minimum)
      }
      if (typeof schema.maximum === 'number' && value > schema.maximum) {
        return strings.transform.schemaMaximum(path, schema.maximum)
      }
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

    if (!schemaObject(parsedOptions)) {
      return strings.transform.schemaObject(strings.transform.optionsPath)
    }

    if (!plugin.argsSchema) {
      return ''
    }

    let schema: unknown
    try {
      schema = JSON.parse(plugin.argsSchema)
    } catch {
      return strings.transform.invalidSchema
    }

    return validateJsonSchemaValue(parsedOptions, schema, strings.transform.optionsPath)
  }

  function formatOptionLabel(key: string): string {
    return key
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (match) => match.toUpperCase())
  }

  function optionChoiceFor(value: unknown): TransformOptionChoice | undefined {
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
      return undefined
    }
    const text = String(value)
    return { label: text, value: text }
  }

  function optionChoices(value: unknown): TransformOptionChoice[] {
    if (!Array.isArray(value)) {
      return []
    }
    const choices: TransformOptionChoice[] = []
    for (const item of value) {
      const choice = optionChoiceFor(item)
      if (choice) {
        choices.push(choice)
      }
    }
    return choices.length === value.length ? choices : []
  }

  function patternOptionChoices(pattern: unknown): TransformOptionChoice[] {
    if (typeof pattern !== 'string') {
      return []
    }
    const match = pattern.match(/^\^\((.+)\)\$$/)
    if (!match) {
      return []
    }
    const values = match[1].split('|')
    if (
      values.length < 2 ||
      values.some((value) => !/^[A-Za-z0-9._:+-]+$/.test(value))
    ) {
      return []
    }
    return values.map((value) => ({ label: value, value }))
  }

  function schemaAllowsType(schema: unknown, type: string): boolean {
    if (!schemaObject(schema)) {
      return false
    }
    if (schema.type === type) {
      return true
    }
    return Array.isArray(schema.oneOf)
      ? schema.oneOf.some((candidate) => schemaAllowsType(candidate, type))
      : false
  }

  function formSchemaFor(schema: unknown): JsonObject | undefined {
    if (!schemaObject(schema)) {
      return undefined
    }
    const type = typeof schema.type === 'string' ? schema.type : ''
    if (['array', 'boolean', 'integer', 'number', 'string'].includes(type)) {
      return schema
    }
    if (!Array.isArray(schema.oneOf)) {
      return undefined
    }

    for (const candidate of schema.oneOf) {
      const candidateSchema = formSchemaFor(candidate)
      if (candidateSchema) {
        return {
          ...candidateSchema,
          title: schema.title ?? candidateSchema.title,
          description: schema.description ?? candidateSchema.description,
          default: schema.default ?? candidateSchema.default,
        }
      }
    }
    return undefined
  }

  function schemaChoices(schema: JsonObject): TransformOptionChoice[] {
    const choices = optionChoices(schema.enum)
    return choices.length > 0 ? choices : patternOptionChoices(schema.pattern)
  }

  function schemaClearTargets(schema: JsonObject): string[] {
    const rawTargets = schema['x-omega-clears']
    return Array.isArray(rawTargets)
      ? rawTargets.filter((target): target is string => typeof target === 'string')
      : []
  }

  function formatArrayOptionValue(value: unknown): string {
    return Array.isArray(value) ? value.map(String).join(', ') : ''
  }

  function parseArrayOptionInput(
    value: string,
    coerceInteger: boolean
  ): Array<string | number> {
    return value
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) =>
        coerceInteger && /^[0-9]+$/.test(item) ? Number.parseInt(item, 10) : item
      )
  }

  function optionGroups(
    schema: JsonObject,
    choices: TransformOptionChoice[]
  ): TransformOptionGroup[] {
    const rawGroups = schema['x-omega-enumGroups']
    if (!Array.isArray(rawGroups) || choices.length === 0) {
      return []
    }
    const choicesByValue = new Map(
      choices.map((choice) => [choice.value, choice])
    )
    const groups: TransformOptionGroup[] = []
    for (const rawGroup of rawGroups) {
      if (!schemaObject(rawGroup) || typeof rawGroup.label !== 'string') {
        continue
      }
      if (!Array.isArray(rawGroup.values)) {
        continue
      }
      const options = rawGroup.values
        .map((value) => choicesByValue.get(String(value)))
        .filter((choice): choice is TransformOptionChoice => Boolean(choice))
      if (options.length > 0) {
        groups.push({ label: rawGroup.label, options })
      }
    }
    return groups
  }

  function ungroupedOptionChoices(
    choices: TransformOptionChoice[],
    groups: TransformOptionGroup[]
  ): TransformOptionChoice[] {
    const grouped = new Set(
      groups.flatMap((group) => group.options.map((choice) => choice.value))
    )
    return choices.filter((choice) => !grouped.has(choice.value))
  }

  function currentOptionValue(
    options: JsonObject | undefined,
    key: string,
    schema: JsonObject
  ): unknown {
    if (options && Object.prototype.hasOwnProperty.call(options, key)) {
      return options[key]
    }
    return schema.default
  }

  function transformOptionField(
    key: string,
    schema: unknown,
    required: boolean,
    options: JsonObject | undefined
  ): TransformOptionField | undefined {
    const sourceSchema = schemaObject(schema) ? schema : undefined
    const fieldSchema = formSchemaFor(schema)
    if (!sourceSchema || !fieldSchema) {
      return undefined
    }
    const type = typeof fieldSchema.type === 'string' ? fieldSchema.type : ''
    if (!['array', 'boolean', 'integer', 'number', 'string'].includes(type)) {
      return undefined
    }

    const itemSchema =
      type === 'array' ? formSchemaFor(fieldSchema.items) : undefined
    if (type === 'array' && !itemSchema) {
      return undefined
    }

    const choices = type === 'array' ? [] : schemaChoices(fieldSchema)
    const control: TransformOptionControl =
      choices.length > 0
        ? 'select'
        : type === 'boolean'
          ? 'checkbox'
          : type === 'integer' || type === 'number'
            ? 'number'
            : 'text'
    const value = currentOptionValue(options, key, sourceSchema)
    const groups = optionGroups(sourceSchema, choices)
    const acceptsInteger = schemaAllowsType(sourceSchema, 'integer')
    const arrayItemsAcceptInteger = schemaAllowsType(itemSchema, 'integer')
    return {
      key,
      id: `transformOption-${key.replace(/[^A-Za-z0-9_-]/g, '-')}`,
      label:
        typeof sourceSchema.title === 'string'
          ? sourceSchema.title
          : typeof fieldSchema.title === 'string'
            ? fieldSchema.title
            : formatOptionLabel(key),
      description:
        typeof sourceSchema.description === 'string'
          ? sourceSchema.description
          : typeof fieldSchema.description === 'string'
            ? fieldSchema.description
            : '',
      type,
      control,
      required,
      value:
        value === undefined
          ? ''
          : type === 'array'
            ? formatArrayOptionValue(value)
            : String(value),
      checked: Boolean(value),
      choices,
      groups,
      ungroupedChoices: ungroupedOptionChoices(choices, groups),
      minimum:
        typeof fieldSchema.minimum === 'number' ? fieldSchema.minimum : undefined,
      maximum:
        typeof fieldSchema.maximum === 'number' ? fieldSchema.maximum : undefined,
      step: type === 'integer' ? '1' : 'any',
      placeholder:
        type === 'array'
          ? strings.transform.arrayOptionPlaceholder
          : typeof fieldSchema.pattern === 'string' &&
              fieldSchema.pattern.includes('0x')
            ? '0xFF'
            : undefined,
      acceptsInteger,
      arrayItemsAcceptInteger,
      clears: schemaClearTargets(sourceSchema),
    }
  }

  function buildTransformOptionFields(
    schema: JsonObject | undefined,
    rawOptionsJson: string
  ): TransformOptionField[] {
    if (
      !schema ||
      schema.type !== 'object' ||
      !schemaObject(schema.properties)
    ) {
      return []
    }

    const required = new Set(
      Array.isArray(schema.required)
        ? schema.required.filter((key): key is string => typeof key === 'string')
        : []
    )
    const options = parseJsonObject(rawOptionsJson)
    const fields: TransformOptionField[] = []
    for (const [key, propertySchema] of Object.entries(schema.properties)) {
      const field = transformOptionField(
        key,
        propertySchema,
        required.has(key),
        options
      )
      if (!field) {
        return []
      }
      fields.push(field)
    }
    return fields
  }

  function setOptionValue(
    field: TransformOptionField,
    rawValue: string | boolean
  ): void {
    const options = { ...(parseJsonObject(optionsJson) || {}) }
    let hasValue = false
    if (field.control === 'checkbox') {
      options[field.key] = Boolean(rawValue)
      hasValue = true
    } else {
      const text = String(rawValue)
      if (!text) {
        delete options[field.key]
      } else if (field.type === 'array') {
        const items = parseArrayOptionInput(
          text,
          field.arrayItemsAcceptInteger ?? false
        )
        if (items.length > 0) {
          options[field.key] = items
          hasValue = true
        } else {
          delete options[field.key]
        }
      } else if (field.type === 'integer') {
        const parsed = Number.parseInt(text, 10)
        options[field.key] = Number.isFinite(parsed) ? parsed : text
        hasValue = true
      } else if (field.type === 'number') {
        const parsed = Number(text)
        options[field.key] = Number.isFinite(parsed) ? parsed : text
        hasValue = true
      } else if (field.type === 'boolean') {
        options[field.key] = text === 'true'
        hasValue = true
      } else if (field.acceptsInteger && /^[0-9]+$/.test(text)) {
        options[field.key] = Number.parseInt(text, 10)
        hasValue = true
      } else {
        options[field.key] = text
        hasValue = true
      }
    }
    if (hasValue) {
      for (const target of field.clears) {
        delete options[target]
      }
    }
    optionsJson = JSON.stringify(options)
  }

  async function openTransformDialog(pluginId: string): Promise<void> {
    const plugin = plugins.find((entry) => entry.id === pluginId)
    selectedPluginId = pluginId
    selectedFileAction = ''
    selectedContentSource = 'computed'
    if (!plugin) {
      return
    }

    optionsJson = savedOptionsByPluginId[plugin.id] ?? plugin.defaultArgs ?? ''
    resetRangeInputs()
    dialogOpen = true
    await tick()
    if (plugin.argsSchema) {
      optionsInput?.focus()
    } else {
      applyButton?.focus()
    }
  }

  async function openFileActionDialog(action: FileSpliceActionId): Promise<void> {
    selectedPluginId = ''
    selectedFileAction = action
    if (action === 'insertFile') {
      resetInsertOffsetInput()
    } else {
      resetRangeInputs()
    }
    dialogOpen = true
    await tick()
    applyButton?.focus()
  }

  function runSessionAction(action: SessionActionId): void {
    selectedPluginId = ''
    selectedFileAction = ''
    dialogOpen = false
    switch (action) {
      case 'createCheckpoint':
        onCreateCheckpoint()
        break
      case 'rollbackCheckpoint':
        onRollbackCheckpoint()
        break
      case 'restoreCheckpoint':
        onRestoreCheckpoint()
        break
      case 'exportChangeLog':
        onExportChangeLog()
        break
      case 'applyChangeLog':
        onApplyChangeLog()
        break
    }
  }

  function handleSelectChange(event: Event): void {
    const select = event.currentTarget
    if (!(select instanceof HTMLSelectElement)) {
      return
    }
    const sessionAction = parseSessionActionValue(select.value)
    if (sessionAction) {
      runSessionAction(sessionAction)
      return
    }
    const fileAction = parseFileActionValue(select.value)
    if (fileAction) {
      void openFileActionDialog(fileAction)
      return
    }
    if (select.value.startsWith(TRANSFORM_ACTION_PREFIX)) {
      void openTransformDialog(select.value.slice(TRANSFORM_ACTION_PREFIX.length))
    }
  }

  function handleContentSourceChange(event: Event): void {
    const select = event.currentTarget
    if (!(select instanceof HTMLSelectElement)) {
      return
    }
    if (
      select.value === 'original' ||
      select.value === 'computed' ||
      select.value === 'latestCheckpoint'
    ) {
      selectedContentSource = select.value
      resetRangeInputs()
    }
  }

  function closeTransformDialog(): void {
    dialogOpen = false
    selectedPluginId = ''
    selectedFileAction = ''
    optionsJson = ''
  }

  function useTransformOptionExample(index: number): void {
    if (index < 0 || index >= advertisedExamples.length) {
      return
    }
    optionsJson = advertisedExamples[index]
    void tick().then(() => optionsInput?.focus())
  }

  async function openTransformPreset(
    preset: TransformPresetHistoryItem
  ): Promise<void> {
    const plugin = plugins.find((entry) => entry.id === preset.pluginId)
    if (!plugin) {
      return
    }

    await openTransformDialog(plugin.id)
    optionsJson = preset.optionsJson
    if (presetHistoryMenu) {
      presetHistoryMenu.open = false
    }
    await tick()
    optionsInput?.focus()
  }

  function applySelectedTransform(): void {
    const plugin = selectedPlugin
    if (
      selectedFileAction ||
      !plugin ||
      !canApplyTransform
    ) {
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
    onApplyTransform(
      plugin.id,
      isInspectOnlyTransform(plugin) ? selectedContentSource : 'computed',
      transformRange.offset,
      transformRange.length,
      trimmedOptions || undefined
    )
    closeTransformDialog()
  }

  function applySelectedFileAction(): void {
    if (!selectedFileAction || !canApplyFileAction) {
      return
    }

    if (selectedFileAction === 'insertFile') {
      onInsertFile(insertOffset.offset)
    } else if (selectedFileAction === 'exportRange') {
      onExportRange(transformRange.offset, transformRange.length)
    } else {
      onReplaceRangeWithFile(transformRange.offset, transformRange.length)
    }
    closeTransformDialog()
  }

  function openResult(resultId: string): void {
    onOpenTransformResult(resultId)
    if (resultHistoryMenu) {
      resultHistoryMenu.open = false
    }
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeTransformDialog()
    }
  }

  function handleOptionsKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && canApplyTransform) {
      event.preventDefault()
      applySelectedTransform()
    }
  }

  function handleRangeKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') {
      return
    }
    if (selectedFileAction && canApplyFileAction) {
      event.preventDefault()
      applySelectedFileAction()
      return
    }
    if (canApplyTransform) {
      event.preventDefault()
      applySelectedTransform()
    }
  }
</script>

<div class="transform-panel">
  <label class="transform-label" for="transformSelect">
    {strings.transform.label}
  </label>
  <input
    class="transform-search"
    type="search"
    value={pluginSearch}
    placeholder={strings.transform.searchTransforms}
    aria-label={strings.transform.searchTransforms}
    title={strings.transform.searchTransformsTitle}
    disabled={!canUseActions}
    onfocus={requestTransforms}
    oninput={(event) => {
      const input = event.currentTarget
      if (input instanceof HTMLInputElement) {
        pluginSearch = input.value
      }
    }}
  />
  <select
    id="transformSelect"
    class="transform-select"
    disabled={!canUseActions}
    title={controlTitle}
    value={selectedActionValue}
    onfocus={requestTransforms}
    onpointerdown={requestTransforms}
    onchange={handleSelectChange}
  >
    <option value="">{strings.transform.choose}</option>
    <optgroup label={strings.transform.sessionGroup}>
      <option value={sessionActionValue('createCheckpoint')}>
        {strings.transform.createCheckpoint}
      </option>
      <option value={sessionActionValue('rollbackCheckpoint')}>
        {strings.transform.rollbackCheckpoint}
      </option>
      <option value={sessionActionValue('restoreCheckpoint')}>
        {strings.transform.restoreCheckpoint}
      </option>
      <option value={sessionActionValue('exportChangeLog')}>
        {strings.transform.exportChangeLog}
      </option>
      <option value={sessionActionValue('applyChangeLog')}>
        {strings.transform.applyChangeLog}
      </option>
    </optgroup>
    <optgroup label={strings.transform.fileSplicingGroup}>
      <option
        value={fileActionValue('exportRange')}
        disabled={!canUseFileRangeAction}
      >
        {strings.transform.exportRange}
      </option>
      <option value={fileActionValue('insertFile')}>
        {strings.transform.insertFile}
      </option>
      <option
        value={fileActionValue('replaceRangeWithFile')}
        disabled={!canUseFileRangeAction}
      >
        {strings.transform.replaceRangeWithFile}
      </option>
    </optgroup>
    {#if plugins.length === 0}
      <optgroup label={strings.transform.transformsGroup}>
        <option value="" disabled>
          {pluginsLoading
            ? strings.transform.loading
            : pluginsLoaded
              ? strings.transform.noTransforms
              : strings.transform.loadTransforms}
        </option>
      </optgroup>
    {:else if filteredTransformPlugins.length === 0}
      <optgroup label={strings.transform.transformsGroup}>
        <option value="" disabled>
          {strings.transform.noTransformMatches}
        </option>
      </optgroup>
    {:else}
      {#each groupedTransformPlugins as group (group.label)}
        <optgroup label={group.label}>
          {#each group.plugins as plugin (plugin.id)}
            <option
              value={transformActionValue(plugin.id)}
              title={plugin.description || plugin.id}
              disabled={!canUseTransformPlugin(plugin)}
            >
              {plugin.name || plugin.id}
            </option>
          {/each}
        </optgroup>
      {/each}
    {/if}
  </select>
  {#if busy && cancelable}
    <button
      type="button"
      class="secondary transform-cancel"
      title={strings.transform.cancelInFlightTitle}
      onclick={onCancelTransform}
    >
      {strings.transform.cancelInFlight}
    </button>
  {/if}
  {#if presets.length > 0}
    <details bind:this={presetHistoryMenu} class="transform-preset-history">
      <summary
        aria-label={strings.transform.presetHistoryTitle}
        title={strings.transform.presetHistoryTitle}
      >
        <span>{presetHistorySummary}</span>
      </summary>
      <div
        class="transform-preset-history-menu"
        role="menu"
        aria-label={strings.transform.presetHistoryLabel}
      >
        {#each presets as preset (preset.id)}
          <button
            type="button"
            role="menuitem"
            title={strings.transform.openPreset(preset.pluginName)}
            disabled={!plugins.some((plugin) => plugin.id === preset.pluginId)}
            onclick={() => openTransformPreset(preset)}
          >
            <span class="transform-result-history-name">{preset.pluginName}</span>
            <span class="transform-result-history-meta">
              {preset.summary} | {preset.createdAtLabel}
            </span>
          </button>
        {/each}
      </div>
    </details>
  {/if}
  {#if metadata}
    <details bind:this={metadataMenu} class="transform-metadata">
      <summary
        aria-label={strings.transform.metadataTitle}
        title={strings.transform.metadataTitle}
      >
        <span>{metadata.summary}</span>
      </summary>
      <div
        class="transform-metadata-menu"
        aria-label={strings.transform.metadataLabel}
      >
        <dl class="transform-metadata-grid">
          <dt>{strings.transform.metadataOperation}</dt>
          <dd>{metadata.operationLabel}</dd>
          <dt>{strings.transform.contentSource}</dt>
          <dd>{metadata.contentSourceLabel}</dd>
          <dt>{strings.transform.metadataSerial}</dt>
          <dd>{metadata.serialLabel}</dd>
          <dt>{strings.transform.metadataRange}</dt>
          <dd>{metadata.rangeLabel}</dd>
          <dt>{strings.transform.length}</dt>
          <dd>{metadata.lengthLabel}</dd>
          <dt>{strings.transform.metadataReplacement}</dt>
          <dd>{metadata.replacementLengthLabel}</dd>
          <dt>{strings.transform.metadataComputedSize}</dt>
          <dd>{metadata.computedFileSizeLabel}</dd>
          <dt>{strings.transform.metadataContent}</dt>
          <dd>{metadata.contentChangedLabel}</dd>
        </dl>
        <div class="help-section-title">{strings.transform.descriptor}</div>
        <label class="transform-options-field">
          <span>{strings.transform.descriptorJson}</span>
          <textarea readonly rows="3" value={metadata.descriptorJson}></textarea>
        </label>
        <label class="transform-options-field">
          <span>{strings.transform.descriptorHex}</span>
          <textarea readonly rows="3" value={metadata.descriptorHex}></textarea>
        </label>
      </div>
    </details>
  {/if}
  {#if results.length > 0}
    <details bind:this={resultHistoryMenu} class="transform-result-history">
      <summary
        aria-label={strings.transform.resultHistoryTitle}
        title={strings.transform.resultHistoryTitle}
      >
        <span aria-live="polite">{resultHistorySummary}</span>
      </summary>
      <div
        class="transform-result-history-menu"
        role="menu"
        aria-label={strings.transform.resultHistoryLabel}
      >
        {#each results as result (result.id)}
          <button
            type="button"
            class:active={result.id === activeTransformResultId}
            role="menuitem"
            title={strings.transform.openResult(result.title, result.label)}
            onclick={() => openResult(result.id)}
          >
            <span class="transform-result-history-name">{result.title}</span>
            <span class="transform-result-history-meta">
              {result.historyLabel}
            </span>
          </button>
        {/each}
      </div>
    </details>
  {:else if statusMessage}
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

      {#if isInspectOnlyTransform(selectedPlugin)}
        <div class="help-section-title">{strings.transform.contentSource}</div>
        <label class="transform-options-field">
          <span>{strings.transform.contentSource}</span>
          <select
            value={selectedContentSource}
            onchange={handleContentSourceChange}
            onkeydown={handleRangeKeydown}
          >
            {#each normalizedContentSources as source (source.content)}
              <option value={source.content} disabled={!source.available}>
                {source.label}
              </option>
            {/each}
          </select>
        </label>
      {/if}

      <div class="help-section-title">{strings.transform.selectedRange}</div>
      <div class="transform-range-grid">
        <div class="transform-range-field">
          <label for="transformRangeStart">{strings.transform.start}</label>
          <input
            id="transformRangeStart"
            value={rangeStartInput}
            aria-invalid={transformRange.error ? 'true' : 'false'}
            title={strings.transform.rangeOffsetTitle}
            oninput={(event) => {
              const input = event.currentTarget
              if (input instanceof HTMLInputElement) {
                rangeStartInput = input.value
              }
            }}
            onkeydown={handleRangeKeydown}
          />
        </div>
        <div class="transform-range-field">
          <label for="transformRangeEnd">{strings.transform.end}</label>
          <div class="transform-range-end-control">
            <input
              id="transformRangeEnd"
              value={rangeEndInput}
              aria-invalid={transformRange.error ? 'true' : 'false'}
              title={strings.transform.rangeOffsetTitle}
              oninput={(event) => {
                const input = event.currentTarget
                if (input instanceof HTMLInputElement) {
                  rangeEndInput = input.value
                }
              }}
              onkeydown={handleRangeKeydown}
            />
            <button
              type="button"
              class="secondary transform-range-max"
              title={strings.transform.useMaxOffset}
              onclick={useMaxRangeEnd}
            >
              {strings.transform.maxOffset}
            </button>
          </div>
        </div>
        <div class="transform-range-length">
          <span class="analysis-label">{strings.transform.length}</span>
          <span class="analysis-value">
            {strings.transform.bytes(
              transformRange.length > 0 ? transformRange.length : selectionLength
            )}
          </span>
        </div>
      </div>

      {#if transformRange.error}
        <div class="transform-error" aria-live="polite">{transformRange.error}</div>
      {/if}

      {#if optionHelp.help}
        <div class="help-section-title">
          {hasOptionForm ? strings.transform.options : strings.transform.details}
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
        {#if hasOptionForm}
          <div class="help-section-title">{strings.transform.options}</div>
          <div class="transform-options-form">
            {#each transformOptionFields as field (field.key)}
              <div class="transform-option-field">
                <label class="transform-option-label" for={field.id}>
                  {field.label}
                </label>
                {#if field.control === 'select'}
                  <select
                    bind:this={optionsInput}
                    id={field.id}
                    value={field.value}
                    aria-invalid={optionsValidationError ? 'true' : 'false'}
                    onchange={(event) => {
                      const select = event.currentTarget
                      if (select instanceof HTMLSelectElement) {
                        setOptionValue(field, select.value)
                      }
                    }}
                    onkeydown={handleOptionsKeydown}
                  >
                    {#if !field.required}
                      <option value="">{strings.transform.optionUnset}</option>
                    {/if}
                    {#if field.groups.length > 0}
                      {#each field.groups as group}
                        <optgroup label={group.label}>
                          {#each group.options as choice}
                            <option value={choice.value}>{choice.label}</option>
                          {/each}
                        </optgroup>
                      {/each}
                      {#each field.ungroupedChoices as choice}
                        <option value={choice.value}>{choice.label}</option>
                      {/each}
                    {:else}
                      {#each field.choices as choice}
                        <option value={choice.value}>{choice.label}</option>
                      {/each}
                    {/if}
                  </select>
                {:else if field.control === 'checkbox'}
                  <input
                    bind:this={optionsInput}
                    id={field.id}
                    type="checkbox"
                    checked={field.checked}
                    aria-invalid={optionsValidationError ? 'true' : 'false'}
                    onchange={(event) => {
                      const input = event.currentTarget
                      if (input instanceof HTMLInputElement) {
                        setOptionValue(field, input.checked)
                      }
                    }}
                    onkeydown={handleOptionsKeydown}
                  />
                {:else}
                  <input
                    bind:this={optionsInput}
                    id={field.id}
                    type={field.control === 'number' ? 'number' : 'text'}
                    min={field.minimum}
                    max={field.maximum}
                    step={field.step}
                    value={field.value}
                    placeholder={field.placeholder}
                    aria-invalid={optionsValidationError ? 'true' : 'false'}
                    oninput={(event) => {
                      const input = event.currentTarget
                      if (input instanceof HTMLInputElement) {
                        setOptionValue(field, input.value)
                      }
                    }}
                    onkeydown={handleOptionsKeydown}
                  />
                {/if}
                {#if field.description}
                  <div class="transform-option-description">
                    {field.description}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
          <details class="transform-raw-options">
            <summary>{strings.transform.advancedOptions}</summary>
            <label class="transform-options-field">
              <span>{strings.transform.optionsJson}</span>
              <textarea
                value={optionsJson}
                maxlength={MAX_TRANSFORM_OPTIONS_LENGTH}
                rows="3"
                placeholder={advertisedExamples[0]
                  ? strings.transform.examplePlaceholder(advertisedExamples[0])
                  : strings.transform.optionsPlaceholder}
                aria-invalid={optionsValidationError ? 'true' : 'false'}
                oninput={(event) => {
                  const input = event.currentTarget
                  if (input instanceof HTMLTextAreaElement) {
                    optionsJson = input.value
                  }
                }}
                onkeydown={handleOptionsKeydown}
              ></textarea>
            </label>
          </details>
        {:else}
          <details class="transform-raw-options">
            <summary>{strings.transform.advancedOptions}</summary>
            <label class="transform-options-field">
              <span>{strings.transform.optionsJson}</span>
              <textarea
                bind:this={optionsInput}
                value={optionsJson}
                maxlength={MAX_TRANSFORM_OPTIONS_LENGTH}
                rows="3"
                placeholder={advertisedExamples[0]
                  ? strings.transform.examplePlaceholder(advertisedExamples[0])
                  : strings.transform.optionsPlaceholder}
                aria-invalid={optionsValidationError ? 'true' : 'false'}
                oninput={(event) => {
                  const input = event.currentTarget
                  if (input instanceof HTMLTextAreaElement) {
                    optionsJson = input.value
                  }
                }}
                onkeydown={handleOptionsKeydown}
              ></textarea>
            </label>
          </details>
        {/if}
      {:else}
        <details class="transform-raw-options">
          <summary>{strings.transform.advancedOptions}</summary>
          <label class="transform-options-field">
            <span>{strings.transform.optionsJson}</span>
            <textarea
              bind:this={optionsInput}
              value={optionsJson}
              maxlength={MAX_TRANSFORM_OPTIONS_LENGTH}
              rows="3"
              placeholder={advertisedExamples[0]
                ? strings.transform.examplePlaceholder(advertisedExamples[0])
                : strings.transform.optionsPlaceholder}
              aria-invalid={optionsValidationError ? 'true' : 'false'}
              oninput={(event) => {
                const input = event.currentTarget
                if (input instanceof HTMLTextAreaElement) {
                  optionsJson = input.value
                }
              }}
              onkeydown={handleOptionsKeydown}
            ></textarea>
          </label>
        </details>
      {/if}

      {#if descriptorPreview}
        <div class="help-section-title">{strings.transform.descriptor}</div>
        <p class="help-muted">
          {isInspectOnlyTransform(selectedPlugin)
            ? strings.transform.inspectDescriptorNotice
            : strings.transform.transformDescriptorNotice}
        </p>
        {#if descriptorPreview.error}
          <div class="transform-error" aria-live="polite">
            {descriptorPreview.error}
          </div>
        {:else}
          <div class="transform-descriptor-preview">
            <label class="transform-options-field">
              <span>{strings.transform.descriptorJson}</span>
              <textarea readonly rows="3" value={descriptorPreview.json}></textarea>
            </label>
            <label class="transform-options-field">
              <span>{strings.transform.descriptorHex}</span>
              <textarea readonly rows="3" value={descriptorPreview.hex}></textarea>
            </label>
          </div>
        {/if}
      {/if}

      {#if optionsValidationError}
        <div class="transform-error" aria-live="polite">{optionsValidationError}</div>
      {/if}
    </div>

    <div class="dialog-actions">
      <button type="button" class="secondary" onclick={closeTransformDialog}>
        {strings.transform.cancel}
      </button>
      <button
        bind:this={applyButton}
        type="button"
        disabled={!canApplyTransform}
        onclick={applySelectedTransform}
      >
        {strings.transform.apply}
      </button>
    </div>
  </div>
{/if}

{#if dialogOpen && selectedFileAction}
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
    aria-labelledby="fileActionDialogTitle"
    tabindex="-1"
    onkeydown={handleDialogKeydown}
  >
    <h2 id="fileActionDialogTitle">{fileActionLabel(selectedFileAction)}</h2>
    <div class="transform-dialog-body">
      <div class="help-muted">{strings.transform.fileSplicingGroup}</div>
      <p>{fileActionDescription(selectedFileAction)}</p>

      {#if selectedFileAction === 'insertFile'}
        <div class="help-section-title">{strings.transform.insertOffset}</div>
        <div class="transform-range-grid">
          <div class="transform-range-field">
            <label for="fileActionInsertOffset">
              {strings.transform.insertOffset}
            </label>
            <div class="transform-range-end-control">
              <input
                id="fileActionInsertOffset"
                value={rangeStartInput}
                aria-invalid={insertOffset.error ? 'true' : 'false'}
                title={strings.transform.insertOffsetTitle}
                oninput={(event) => {
                  const input = event.currentTarget
                  if (input instanceof HTMLInputElement) {
                    rangeStartInput = input.value
                  }
                }}
                onkeydown={handleRangeKeydown}
              />
              <button
                type="button"
                class="secondary transform-range-max"
                title={strings.transform.useEndOffset}
                onclick={useMaxInsertOffset}
              >
                {strings.transform.endOffset}
              </button>
            </div>
          </div>
          <div class="transform-range-length">
            <span class="analysis-label">{strings.transform.destination}</span>
            <span class="analysis-value">
              {insertOffset.offset >= 0 ? formatOffset(insertOffset.offset) : '...'}
            </span>
          </div>
        </div>

        {#if insertOffset.error}
          <div class="transform-error" aria-live="polite">
            {insertOffset.error}
          </div>
        {/if}
      {:else}
        <div class="help-section-title">{strings.transform.destinationRange}</div>
        <div class="transform-range-grid">
          <div class="transform-range-field">
            <label for="fileActionRangeStart">{strings.transform.start}</label>
            <input
              id="fileActionRangeStart"
              value={rangeStartInput}
              aria-invalid={transformRange.error ? 'true' : 'false'}
              title={strings.transform.rangeOffsetTitle}
              oninput={(event) => {
                const input = event.currentTarget
                if (input instanceof HTMLInputElement) {
                  rangeStartInput = input.value
                }
              }}
              onkeydown={handleRangeKeydown}
            />
          </div>
          <div class="transform-range-field">
            <label for="fileActionRangeEnd">{strings.transform.end}</label>
            <div class="transform-range-end-control">
              <input
                id="fileActionRangeEnd"
                value={rangeEndInput}
                aria-invalid={transformRange.error ? 'true' : 'false'}
                title={strings.transform.rangeOffsetTitle}
                oninput={(event) => {
                  const input = event.currentTarget
                  if (input instanceof HTMLInputElement) {
                    rangeEndInput = input.value
                  }
                }}
                onkeydown={handleRangeKeydown}
              />
              <button
                type="button"
                class="secondary transform-range-max"
                title={strings.transform.useMaxOffset}
                onclick={useMaxRangeEnd}
              >
                {strings.transform.maxOffset}
              </button>
            </div>
          </div>
          <div class="transform-range-length">
            <span class="analysis-label">{strings.transform.length}</span>
            <span class="analysis-value">
              {strings.transform.bytes(
                transformRange.length > 0
                  ? transformRange.length
                  : selectionLength
              )}
            </span>
          </div>
        </div>

        {#if transformRange.error}
          <div class="transform-error" aria-live="polite">
            {transformRange.error}
          </div>
        {/if}
      {/if}
    </div>

    <div class="dialog-actions">
      <button type="button" class="secondary" onclick={closeTransformDialog}>
        {strings.transform.cancel}
      </button>
      <button
        bind:this={applyButton}
        type="button"
        disabled={!canApplyFileAction}
        onclick={applySelectedFileAction}
      >
        {fileActionApplyLabel(selectedFileAction)}
      </button>
    </div>
  </div>
{/if}
