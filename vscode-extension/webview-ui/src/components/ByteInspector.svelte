<script lang="ts">
  import { formatNumber, strings } from '../i18n'
  import type { TextEncoding } from '../protocol'
  import {
    decodeTextByte,
    encodeTextToHex,
    isPrintableTextByte,
    byteToHex2,
    bytesToHex,
    isPrintableAscii,
  } from '../../../src/textEncoding'

  interface InspectorField {
    key: string
    label: string
    minBytes: number
    editable: boolean
    byteLength?: (bytes: number[], littleEndian: boolean) => number
    read: (bytes: number[], littleEndian: boolean) => string
    write?: (raw: string, littleEndian: boolean) => string
  }

  interface InspectorFieldView {
    field: InspectorField
    value: string
    length: number
    available: boolean
  }

  interface InspectorGroup {
    id: string
    label: string
    fields: InspectorField[]
    defaultExpanded: boolean
  }

  interface Props {
    selectedOffset?: number
    bytes?: number[]
    selectionStart?: number
    selectionEnd?: number
    clipboardMessage?: string
    littleEndian?: boolean
    offsetRadix?: 'hex' | 'dec'
    textEncoding?: TextEncoding
    expanded?: boolean
    disabled?: boolean
    onToggleExpanded: () => void
    onToggleEndian: () => void
    onInspectRange: (offset: number, length: number) => void
    onCommitValue: (offset: number, length: number, data: string) => void
  }

  let {
    selectedOffset = -1,
    bytes = [],
    selectionStart = -1,
    selectionEnd = -1,
    clipboardMessage = '',
    littleEndian = true,
    offsetRadix = 'hex',
    textEncoding = 'ascii',
    expanded = false,
    disabled = false,
    onToggleExpanded,
    onToggleEndian,
    onInspectRange,
    onCommitValue,
  }: Props = $props()

  let editingKey = $state('')
  let editValue = $state('')
  let editError = $state('')
  let lastSelectedOffset = $state(-1)
  let collapsedGroups = $state<Set<string>>(new Set())

  const hasSelection = $derived(
    selectionStart >= 0 && selectionEnd >= selectionStart
  )
  const selectionLength = $derived(
    hasSelection ? selectionEnd - selectionStart + 1 : 0
  )

  function setEndian(useLittleEndian: boolean): void {
    if (littleEndian !== useLittleEndian) {
      onToggleEndian()
    }
  }

  function formatOffset(offset: number): string {
    return offsetRadix === 'dec'
      ? formatNumber(offset)
      : `0x${offset.toString(16).toUpperCase()}`
  }

  function makeDataView(value: number[]): DataView {
    return new DataView(Uint8Array.from(value).buffer)
  }

  function textEncodingLabel(): string {
    switch (textEncoding) {
      case 'ascii':
        return strings.encoding.ascii
      case 'windows-1252':
        return strings.encoding.windows1252
      case 'cp437':
        return strings.encoding.cp437
      case 'ebcdic-037':
        return strings.encoding.ebcdic037
      case 'macroman':
        return strings.encoding.macRoman
    }
  }

  function quoted(value: string): string {
    return value ? `'${value}'` : '--'
  }

  function firstUnicodeCharacter(raw: string): string {
    return Array.from(raw)[0] ?? ''
  }

  function decodeFirstUtf8(value: number[]):
    | { text: string; length: number }
    | undefined {
    const first = value[0]
    let length = 0
    if (first <= 0x7f) {
      length = 1
    } else if (first >= 0xc2 && first <= 0xdf) {
      length = 2
    } else if (first >= 0xe0 && first <= 0xef) {
      length = 3
    } else if (first >= 0xf0 && first <= 0xf4) {
      length = 4
    } else {
      return undefined
    }
    if (value.length < length) return undefined
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(
        Uint8Array.from(value.slice(0, length))
      )
      return text ? { text, length } : undefined
    } catch {
      return undefined
    }
  }

  function decodeFirstUtf16(
    value: number[],
    useLittleEndian: boolean
  ): { text: string; length: number } | undefined {
    if (value.length < 2) return undefined
    const view = makeDataView(value)
    const first = view.getUint16(0, useLittleEndian)
    if (first >= 0xd800 && first <= 0xdbff) {
      if (value.length < 4) return undefined
      const second = view.getUint16(2, useLittleEndian)
      if (second < 0xdc00 || second > 0xdfff) return undefined
      return {
        text: String.fromCodePoint(
          0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00)
        ),
        length: 4,
      }
    }
    if (first >= 0xdc00 && first <= 0xdfff) return undefined
    return { text: String.fromCharCode(first), length: 2 }
  }

  function utf8ToHex(value: string): string {
    const text = firstUnicodeCharacter(value)
    if (!text) throw new Error(strings.inspector.emptyValue)
    return bytesToHex(Array.from(new TextEncoder().encode(text)))
  }

  function encodeUtf16Character(value: string, useLittleEndian: boolean): string {
    const text = firstUnicodeCharacter(value)
    if (!text) throw new Error(strings.inspector.emptyValue)
    const codePoint = text.codePointAt(0)
    if (codePoint === undefined) throw new Error(strings.inspector.emptyValue)
    const units =
      codePoint <= 0xffff
        ? [codePoint]
        : [
            0xd800 + ((codePoint - 0x10000) >> 10),
            0xdc00 + ((codePoint - 0x10000) & 0x3ff),
          ]
    const buffer = new ArrayBuffer(units.length * 2)
    const view = new DataView(buffer)
    units.forEach((unit, index) => {
      view.setUint16(index * 2, unit, useLittleEndian)
    })
    return bytesToHex(Array.from(new Uint8Array(buffer)))
  }

  function parseBigIntInput(raw: string): bigint {
    const text = raw.trim().replaceAll('_', '')
    if (!text) throw new Error(strings.inspector.emptyValue)
    let sign = 1n
    let body = text
    if (body.startsWith('-')) {
      sign = -1n
      body = body.slice(1)
    } else if (body.startsWith('+')) {
      body = body.slice(1)
    }
    if (
      /^0x[0-9a-f]+$/i.test(body) ||
      /^0b[01]+$/i.test(body) ||
      /^0o[0-7]+$/i.test(body) ||
      /^[0-9]+$/.test(body)
    ) {
      return sign * BigInt(body)
    }
    throw new Error(strings.inspector.invalidInteger)
  }

  function parseIntegerInRange(raw: string, min: bigint, max: bigint): bigint {
    const value = parseBigIntInput(raw)
    if (value < min || value > max) throw new Error(strings.inspector.outOfRange)
    return value
  }

  function writeIntegerBytes(
    value: bigint,
    byteLength: number,
    signed: boolean,
    useLittleEndian: boolean
  ): string {
    const buffer = new ArrayBuffer(byteLength)
    const view = new DataView(buffer)
    if (byteLength === 1) {
      signed ? view.setInt8(0, Number(value)) : view.setUint8(0, Number(value))
    } else if (byteLength === 2) {
      signed
        ? view.setInt16(0, Number(value), useLittleEndian)
        : view.setUint16(0, Number(value), useLittleEndian)
    } else if (byteLength === 4) {
      signed
        ? view.setInt32(0, Number(value), useLittleEndian)
        : view.setUint32(0, Number(value), useLittleEndian)
    } else if (byteLength === 8) {
      signed
        ? view.setBigInt64(0, value, useLittleEndian)
        : view.setBigUint64(0, value, useLittleEndian)
    }
    return bytesToHex(Array.from(new Uint8Array(buffer)))
  }

  function integerField(
    key: string,
    label: string,
    byteLength: number,
    signed: boolean
  ): InspectorField {
    const bits = BigInt(byteLength * 8)
    const min = signed ? -(1n << (bits - 1n)) : 0n
    const max = signed ? (1n << (bits - 1n)) - 1n : (1n << bits) - 1n
    return {
      key,
      label,
      minBytes: byteLength,
      editable: true,
      read: (value, useLittleEndian) => {
        const view = makeDataView(value)
        if (byteLength === 1) {
          return signed ? view.getInt8(0).toString() : view.getUint8(0).toString()
        }
        if (byteLength === 2) {
          return signed
            ? view.getInt16(0, useLittleEndian).toString()
            : view.getUint16(0, useLittleEndian).toString()
        }
        if (byteLength === 4) {
          return signed
            ? view.getInt32(0, useLittleEndian).toString()
            : view.getUint32(0, useLittleEndian).toString()
        }
        return signed
          ? view.getBigInt64(0, useLittleEndian).toString()
          : view.getBigUint64(0, useLittleEndian).toString()
      },
      write: (raw, useLittleEndian) =>
        writeIntegerBytes(
          parseIntegerInRange(raw, min, max),
          byteLength,
          signed,
          useLittleEndian
        ),
    }
  }

  function activeTextEncodingField(): InspectorField {
    return {
      key: `text-${textEncoding}`,
      label: strings.encoding.inspectorText(textEncodingLabel()),
      minBytes: 1,
      editable: true,
      read: (value) => {
        if (!isPrintableTextByte(value[0], textEncoding)) {
          throw new Error(strings.inspector.invalidTextByte)
        }
        return quoted(decodeTextByte(value[0], textEncoding) ?? '')
      },
      write: (raw) => {
        const text = firstUnicodeCharacter(raw)
        if (!text || Array.from(text).length !== 1) {
          throw new Error(strings.inspector.invalidTextByte)
        }
        const data = encodeTextToHex(text, textEncoding)
        if (
          !data ||
          data.length !== 2 ||
          !isPrintableTextByte(parseInt(data, 16), textEncoding)
        ) {
          throw new Error(strings.inspector.invalidTextByte)
        }
        return data
      },
    }
  }

  // Field definitions grouped by category
  const commonFields: InspectorField[] = [
    {
      key: 'hex8',
      label: strings.inspector.byteValue,
      minBytes: 1,
      editable: true,
      read: (value) => `0x${byteToHex2(value[0])}`,
      write: (raw) => {
        const text = raw.trim().replace(/^0x/i, '')
        if (!/^[0-9a-f]{1,2}$/i.test(text)) {
          throw new Error(strings.inspector.invalidHexByte)
        }
        return byteToHex2(parseInt(text, 16))
      },
    },
    {
      key: 'ascii',
      label: strings.inspector.ascii,
      minBytes: 1,
      editable: true,
      read: (value) => {
        if (!isPrintableAscii(value[0])) {
          throw new Error(strings.inspector.invalidAsciiByte)
        }
        return `'${String.fromCharCode(value[0])}'`
      },
      write: (raw) => {
        if (raw.length !== 1 || !isPrintableAscii(raw.charCodeAt(0))) {
          throw new Error(strings.inspector.invalidAsciiByte)
        }
        return byteToHex2(raw.charCodeAt(0))
      },
    },
    {
      key: 'binary',
      label: strings.inspector.bin,
      minBytes: 1,
      editable: true,
      read: (value) => value[0].toString(2).padStart(8, '0'),
      write: (raw) => {
        const text = raw.trim().replace(/^0b/i, '')
        if (!/^[01]{1,8}$/.test(text)) {
          throw new Error(strings.inspector.invalidBinaryByte)
        }
        return byteToHex2(parseInt(text, 2))
      },
    },
    {
      key: 'octal',
      label: strings.inspector.octal,
      minBytes: 1,
      editable: true,
      read: (value) => value[0].toString(8).padStart(3, '0'),
      write: (raw) => {
        const text = raw.trim().replace(/^0o/i, '')
        if (!/^[0-7]{1,3}$/.test(text)) {
          throw new Error(strings.inspector.invalidOctalByte)
        }
        const value = parseInt(text, 8)
        if (value > 0xff) throw new Error(strings.inspector.outOfRange)
        return byteToHex2(value)
      },
    },
  ]

  const integerFields: InspectorField[] = [
    integerField('uint8', strings.inspector.uint8, 1, false),
    integerField('int8', strings.inspector.int8, 1, true),
    integerField('uint16', strings.inspector.uint16, 2, false),
    integerField('int16', strings.inspector.int16, 2, true),
    integerField('uint32', strings.inspector.uint32, 4, false),
    integerField('int32', strings.inspector.int32, 4, true),
    integerField('uint64', strings.inspector.uint64, 8, false),
    integerField('int64', strings.inspector.int64, 8, true),
  ]

  const floatFields: InspectorField[] = [
    {
      key: 'float32',
      label: strings.inspector.float32,
      minBytes: 4,
      editable: false,
      read: (value, useLittleEndian) =>
        makeDataView(value).getFloat32(0, useLittleEndian).toString(),
    },
    {
      key: 'float64',
      label: strings.inspector.float64,
      minBytes: 8,
      editable: false,
      read: (value, useLittleEndian) =>
        makeDataView(value).getFloat64(0, useLittleEndian).toString(),
    },
  ]

  const textFields: InspectorField[] = [
    {
      key: 'utf8',
      label: strings.inspector.utf8,
      minBytes: 1,
      editable: true,
      byteLength: (value) => decodeFirstUtf8(value)?.length ?? 1,
      read: (value) => {
        const decoded = decodeFirstUtf8(value)
        if (!decoded) throw new Error(strings.inspector.invalidValue)
        return quoted(decoded.text)
      },
      write: (raw) => utf8ToHex(raw),
    },
    {
      key: 'utf16',
      label: strings.inspector.utf16,
      minBytes: 2,
      editable: true,
      byteLength: (value, useLittleEndian) =>
        decodeFirstUtf16(value, useLittleEndian)?.length ?? 2,
      read: (value, useLittleEndian) => {
        const decoded = decodeFirstUtf16(value, useLittleEndian)
        if (!decoded) throw new Error(strings.inspector.invalidValue)
        return quoted(decoded.text)
      },
      write: (raw, useLittleEndian) =>
        encodeUtf16Character(raw, useLittleEndian),
    },
  ]

  const groups: InspectorGroup[] = [
    { id: 'common', label: strings.inspector.groupCommon, fields: commonFields, defaultExpanded: true },
    { id: 'integers', label: strings.inspector.groupIntegers, fields: integerFields, defaultExpanded: false },
    { id: 'floats', label: strings.inspector.groupFloats, fields: floatFields, defaultExpanded: false },
    { id: 'text', label: strings.inspector.groupText, fields: textFields, defaultExpanded: false },
  ]

  // Merge active text encoding into the text group
  const allGroups = $derived(
    groups.map((g) =>
      g.id === 'text'
        ? { ...g, fields: [activeTextEncodingField(), ...g.fields] }
        : g.id === 'common'
          ? { ...g, fields: [g.fields[0], g.fields[1], activeTextEncodingField(), ...g.fields.slice(2)] }
          : g
    )
  )

  function isGroupCollapsed(groupId: string): boolean {
    return collapsedGroups.has(groupId)
  }

  function toggleGroup(groupId: string): void {
    const next = new Set(collapsedGroups)
    if (next.has(groupId)) {
      next.delete(groupId)
    } else {
      next.add(groupId)
    }
    collapsedGroups = next
  }

  function displayValue(
    field: InspectorField,
    valueBytes: number[],
    useLittleEndian: boolean
  ): string {
    if (valueBytes.length < field.minBytes) return '--'
    try {
      return field.read(valueBytes, useLittleEndian)
    } catch {
      return '--'
    }
  }

  function fieldByteLength(
    field: InspectorField,
    valueBytes: number[],
    useLittleEndian: boolean
  ): number {
    if (valueBytes.length < field.minBytes) return field.minBytes
    return Math.max(
      1,
      field.byteLength?.(valueBytes, useLittleEndian) ?? field.minBytes
    )
  }

  function buildFieldView(
    field: InspectorField,
    valueBytes: number[],
    useLittleEndian: boolean
  ): InspectorFieldView {
    const length = fieldByteLength(field, valueBytes, useLittleEndian)
    const value = displayValue(field, valueBytes, useLittleEndian)
    return {
      field,
      value,
      length,
      available: valueBytes.length >= length && value !== '--',
    }
  }

  function beginEdit(item: InspectorFieldView): void {
    const { field } = item
    if (disabled || !field.editable || !item.available || selectedOffset < 0) return
    onInspectRange(selectedOffset, item.length)
    editingKey = field.key
    editValue = item.value.replace(/^'|'$/g, '')
    editError = ''
  }

  function inspectField(item: InspectorFieldView): void {
    if (item.available && selectedOffset >= 0) {
      onInspectRange(selectedOffset, item.length)
    }
  }

  function cancelEdit(): void {
    editingKey = ''
    editValue = ''
    editError = ''
  }

  function commitEdit(item: InspectorFieldView): void {
    const { field } = item
    if (disabled || !field.write || selectedOffset < 0) return
    try {
      const data = field.write(editValue, littleEndian)
      onCommitValue(selectedOffset, item.length, data)
      cancelEdit()
    } catch (error) {
      editError = error instanceof Error ? error.message : strings.inspector.invalidValue
    }
  }

  function handleEditKeydown(
    event: KeyboardEvent,
    item: InspectorFieldView
  ): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitEdit(item)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelEdit()
    }
  }

  $effect(() => {
    if (selectedOffset !== lastSelectedOffset) {
      lastSelectedOffset = selectedOffset
      cancelEdit()
    } else if (selectedOffset < 0) {
      cancelEdit()
    }
  })
</script>

<section class="byte-inspector-panel" aria-label={strings.inspector.label}>
  <div class="inspector-header">
    {#if !expanded}
      <button
        type="button"
        class="inspector-toggle inspector-collapsed-toggle"
        aria-expanded={expanded}
        aria-label={strings.inspector.expand}
        title={strings.inspector.expand}
        onclick={onToggleExpanded}
      >
        <span>{strings.inspector.show}</span>
        <span class="inspector-collapsed-label">{strings.inspector.title}</span>
      </button>
    {:else}
      <button
        type="button"
        class="panel-close inspector-toggle"
        aria-expanded={expanded}
        aria-label={strings.inspector.collapse}
        title={strings.inspector.collapse}
        onclick={onToggleExpanded}
      >{strings.inspector.collapseSymbol}</button>
      <div class="inspector-summary">
        <span class="inspector-label">{strings.inspector.label}</span>
        {#if hasSelection}
          <strong>
            {selectionLength === 1
              ? formatOffset(selectionStart)
              : `${formatOffset(selectionStart)}-${formatOffset(selectionEnd)}`}
          </strong>
          <span>{strings.inspector.byte(selectionLength)}</span>
        {:else}
          <strong>{strings.inspector.noSelection}</strong>
        {/if}
      </div>
      <div class="inspector-byte-order">
        <span class="inspector-byte-order-label">{strings.inspector.byteOrder}</span>
        <div class="segmented inspector-byte-order-toggle" role="group" aria-label={strings.inspector.byteOrder}>
          <button type="button" class:active={littleEndian} aria-pressed={littleEndian} onclick={() => setEndian(true)}>
            {strings.inspector.littleEndian}
          </button>
          <button type="button" class:active={!littleEndian} aria-pressed={!littleEndian} onclick={() => setEndian(false)}>
            {strings.inspector.bigEndian}
          </button>
        </div>
      </div>
    {/if}
  </div>

  {#if expanded}
    <div class="inspector-feedback" aria-live="polite">
      {editError || clipboardMessage}
    </div>

    {#each allGroups as group (group.id)}
      <div class="inspector-group" class:collapsed={isGroupCollapsed(group.id)}>
        <button
          type="button"
          class="inspector-group-toggle"
          aria-expanded={!isGroupCollapsed(group.id)}
          aria-label={strings.inspector.groupToggle(group.label)}
          title={group.label}
          onclick={() => toggleGroup(group.id)}
        >
          <span class="inspector-group-chevron" aria-hidden="true">
            {#if isGroupCollapsed(group.id)}&#x25B6;{:else}&#x25BC;{/if}
          </span>
          <span class="inspector-group-label">{group.label}</span>
        </button>
        {#if !isGroupCollapsed(group.id)}
          <dl class="inspector-values">
            {#each group.fields as field (field.key)}
              {@const item = buildFieldView(field, bytes, littleEndian)}
              <div>
                <dt>{field.label}</dt>
                <dd>
                  {#if editingKey === field.key}
                    <span class="inspector-edit-row">
                      <input
                        aria-label={strings.inspector.valueInput(field.label)}
                        bind:value={editValue}
                        spellcheck="false"
                        disabled={disabled}
                        onkeydown={(event) => handleEditKeydown(event, item)}
                      />
                      <button type="button" class="secondary" disabled={disabled} onclick={() => commitEdit(item)}>
                        {strings.inspector.apply}
                      </button>
                    </span>
                  {:else if field.editable && item.available && selectedOffset >= 0}
                    <button type="button" class="inspector-value-button" disabled={disabled} onclick={() => beginEdit(item)}>
                      {item.value}
                    </button>
                  {:else}
                    <button
                      type="button"
                      class="inspector-value-button"
                      class:inspector-value-readonly={!field.editable}
                      disabled={!item.available || selectedOffset < 0 || (disabled && field.editable)}
                      onclick={() => field.editable ? beginEdit(item) : inspectField(item)}
                    >
                      {item.value}
                    </button>
                  {/if}
                </dd>
              </div>
            {/each}
          </dl>
        {/if}
      </div>
    {/each}
  {/if}
</section>
