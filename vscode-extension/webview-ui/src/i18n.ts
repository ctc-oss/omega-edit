const DEFAULT_LANGUAGE = 'en'
const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ps', 'ur'])

let activeLanguage = DEFAULT_LANGUAGE

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions
): string {
  return value.toLocaleString(activeLanguage, options)
}

export function textDirectionForLanguage(language: string): 'ltr' | 'rtl' {
  const [baseLanguage] = normalizeLanguageTag(language).split('-')
  return RTL_LANGUAGES.has(baseLanguage) ? 'rtl' : 'ltr'
}

function normalizeLanguageTag(language: string): string {
  return language.trim().replaceAll('_', '-').toLowerCase()
}

const englishStrings = {
  app: {
    missingMountPoint: 'Missing Svelte webview mount point',
    failedToStart: (message: string) =>
      `Failed to start editor webview: ${message}`,
  },
  toolbar: {
    label: 'OmegaEdit editor toolbar',
    bytesPerRow: 'Bytes per row',
    bytesPerRowSelect: 'Bytes/row',
    bytesPerRowOptions: 'Choose a standard bytes-per-row value',
    bytesPerRowRequired: 'Enter a bytes-per-row value',
    bytesPerRowInteger: 'Use a whole number',
    bytesPerRowRange: (min: number, max: number) =>
      `Use a value from ${min} to ${max}`,
    customBytesPerRow: 'Custom bytes per row',
    customBytesPerRowTitle: (min: number, max: number) =>
      `Set bytes per row from ${min} to ${max}`,
    offsetRadix: 'Offset radix',
    offsetRadixTitle: (label: string) => `Display offsets in ${label}`,
    hexOffsets: 'Hex',
    decOffsets: 'Dec',
    hexOffsetsTitle: 'Display offsets in hexadecimal',
    decOffsetsTitle: 'Display offsets in decimal',
    textEncoding: 'Text encoding',
    textEncodingTitle: (label: string) => `Display TEXT bytes as ${label}`,
    insertDirection: 'Insert direction',
    forwardInsert: 'Forward',
    backwardInsert: 'Backward',
    forwardInsertTitle: 'Insert direction: Forward. Click for backward insert.',
    backwardInsertTitle: 'Insert direction: Backward. Click for forward insert.',
    searchPanel: 'Find',
    showSearchPanelTitle: 'Show search and replace',
    hideSearchPanelTitle: 'Hide search and replace',
  },
  encoding: {
    ascii: 'ASCII',
    windows1252: 'Windows-1252',
    cp437: 'CP437',
    ebcdic037: 'EBCDIC',
    macRoman: 'MacRoman',
    notRepresentable: 'Not representable in selected text encoding',
    printable: (label: string) => `Printable (${label})`,
    inspectorText: (label: string) => `Text (${label})`,
  },
  navigation: {
    offsetLabel: 'Offset',
    offsetPlaceholderHex: '0x0000',
    offsetPlaceholderDec: '0',
    offsetTitleHex: 'Go to hex offset',
    offsetTitleDec: 'Go to decimal offset',
    offsetRequired: 'Enter an offset',
    invalidHexOffset: 'Invalid hex offset',
    invalidDecimalOffset: 'Invalid decimal offset',
    noFile: 'No file loaded',
    offsetOutOfRange: (maxOffset: string) => `Max ${maxOffset}`,
    scrollbarLabel: 'File navigation',
    scrollbarDisabled: 'File fits in view',
    scrollbarValue: (offset: string, progress: string) =>
      `${offset} (${progress})`,
  },
  transform: {
    label: 'Action',
    choose: 'Select action...',
    chooseTitle: 'Find an action for the current file',
    calculationsGroup: 'Calculations',
    transformsGroup: 'Transforms',
    fileSplicingGroup: 'File Splicing',
    sessionGroup: 'Session',
    createCheckpoint: 'Checkpoint',
    rollbackCheckpoint: 'Roll back',
    restoreCheckpoint: 'Restore',
    exportChangeLog: 'Export Log',
    applyChangeLog: 'Apply Log',
    createCheckpointDescription: 'Save the current edit state as a checkpoint.',
    rollbackCheckpointDescription: 'Return to the previous checkpoint.',
    restoreCheckpointDescription: 'Restore the latest checkpoint.',
    exportChangeLogDescription: 'Save the session change log to a file.',
    applyChangeLogDescription: 'Apply a saved change log to this session.',
    loading: 'Loading transforms...',
    inFlight: 'Action in progress; edits are disabled.',
    searchActions: 'Find action',
    actionsLabel: 'Available actions',
    noActionMatches: 'No matching actions',
    selectRange: 'Select bytes first',
    selectRangeFirst: 'Select one or more bytes to transform',
    unavailable: (message: string) => `Transform plugins unavailable: ${message}`,
    options: 'Options',
    optionsPlaceholder: 'options JSON',
    examplePlaceholder: (example: string) => `e.g. ${example}`,
    optionUnset: 'Unset',
    noDescription: 'This transform did not advertise a description.',
    contentSource: 'Content',
    contentComputed: 'Current Content',
    contentOriginal: 'Original Snapshot',
    contentLatestCheckpoint: 'Latest Checkpoint',
    selectedRange: 'Selected Range',
    destinationRange: 'Destination Range',
    destination: 'Destination',
    exportRange: 'Save Range As...',
    insertFile: 'Insert File...',
    replaceRangeWithFile: 'Replace Range With File...',
    exportRangeDescription:
      'Save the selected or tuned byte range to another file.',
    insertFileDescription:
      'Insert all bytes from another file at the selected or tuned offset.',
    replaceRangeWithFileDescription:
      'Replace the selected or tuned range with all bytes from another file.',
    exportRangeApply: 'Export...',
    insertFileApply: 'Insert...',
    replaceRangeWithFileApply: 'Replace...',
    insertOffset: 'Insert Offset',
    insertOffsetTitle: 'Enter the destination offset for the inserted file',
    invalidInsertOffset: 'Enter a valid insert offset',
    insertOffsetOutOfBounds: (maxOffset: string) => `Max insert offset ${maxOffset}`,
    endOffset: 'EOF',
    useEndOffset: 'Use the end of the file as the insert offset',
    start: 'Start',
    end: 'End',
    length: 'Length',
    bytes: (count: number) => `${formatNumber(count)} byte${count === 1 ? '' : 's'}`,
    rangeOffsetTitle: 'Enter an offset for this transform range',
    invalidRangeOffset: 'Enter valid start and end offsets',
    noFileRange: 'No file bytes are available to transform',
    rangeEndBeforeStart: 'End offset must be at or after start offset',
    rangeOutOfBounds: (maxOffset: string) => `Max offset ${maxOffset}`,
    maxOffset: 'Max',
    useMaxOffset: 'Use the last file offset as the range end',
    help: 'Help',
    details: 'Details',
    examples: 'Examples',
    useExample: 'Use this example',
    exampleLabel: (index: number) => `Example ${formatNumber(index)}`,
    descriptor: 'Descriptor',
    descriptorJson: 'Descriptor JSON',
    descriptorPlaceholder: (id: string) => `{"transformId":"${id}","args":{}}`,
    apply: 'Apply',
    cancel: 'Cancel',
    cancelInFlight: 'Cancel',
    cancelInFlightTitle: 'Cancel the running transform',
    cancelling: 'Cancelling transform...',
    closeDialog: 'Close transform options',
    advancedOptions: 'Advanced',
    arrayOptionPlaceholder: '0x0F, 0xF0',
    invalidJson: 'Invalid JSON',
    missingSchema: 'Selected transform does not advertise an options schema',
    invalidSchema: 'Selected transform advertised an invalid options schema',
    optionsTooLong: (limit: number) =>
      `options must be ${formatNumber(limit)} characters or fewer`,
    optionsPath: 'options',
    descriptorPath: 'descriptor',
    descriptorArgsPath: 'descriptor.args',
    descriptorTransformPath: 'descriptor.transformId',
    descriptorTransformMismatch: 'descriptor.transformId must match the selected transform',
    schemaOneOf: (path: string) =>
      `${path} must match exactly one allowed shape`,
    schemaNot: (path: string) =>
      `${path} uses a disallowed option combination`,
    schemaEnum: (path: string) => `${path} must be one of the allowed values`,
    schemaObject: (path: string) => `${path} must be an object`,
    schemaRequired: (path: string, key: string) =>
      `${path} is missing "${key}"`,
    schemaMaxProperties: (path: string) =>
      `${path} has too many properties`,
    schemaUnknown: (path: string, key: string) =>
      `${path} has unknown field "${key}"`,
    schemaArray: (path: string) => `${path} must be an array`,
    schemaMinItems: (path: string, count: number) =>
      `${path} must contain at least ${count} item`,
    schemaString: (path: string) => `${path} must be a string`,
    schemaPattern: (path: string) =>
      `${path} does not match the expected format`,
    schemaInteger: (path: string) => `${path} must be an integer`,
    schemaMinimum: (path: string, value: number) =>
      `${path} must be at least ${value}`,
    schemaMaximum: (path: string, value: number) =>
      `${path} must be at most ${value}`,
    schemaNumber: (path: string) => `${path} must be a number`,
    schemaBoolean: (path: string) => `${path} must be true or false`,
    operationReplace: 'Replace',
    operationInspect: 'Inspect',
    operationReplaceInspect: 'Replace + Inspect',
    operationTransform: 'Transform',
    supportProduction: 'Production',
    supportExperimental: 'Experimental',
    supportTest: 'Test',
    supportUnknown: 'Unknown',
    applying: (name: string) => `Applying ${name}...`,
    creatingCheckpoint: 'Creating checkpoint...',
    rollingBackCheckpoint: 'Rolling back checkpoint...',
    restoringCheckpoint: 'Restoring checkpoint...',
    exportingChangeLog: 'Exporting change log...',
    applyingChangeLog: 'Applying change log...',
    checkpointCreated: (count: number) =>
      `Checkpoint created (${formatNumber(count)} total)`,
    checkpointRolledBack: (count: number) =>
      `Checkpoint rolled back (${formatNumber(count)} remaining)`,
    checkpointRestored: (count: number) =>
      `Checkpoint restored (${formatNumber(count)} total)`,
    changeLogExported: (count: number) =>
      `Exported ${formatNumber(count)} change${count === 1 ? '' : 's'}`,
    changeLogApplied: (count: number) =>
      `Applied ${formatNumber(count)} change${count === 1 ? '' : 's'}`,
    exportingRange: 'Exporting range...',
    insertingFile: 'Selecting file to insert...',
    replacingWithFile: 'Selecting replacement file...',
    fileActionCancelled: 'File action cancelled',
    exportedRange: (count: number) =>
      `Exported ${formatNumber(count)} byte${count === 1 ? '' : 's'}`,
    insertedFile: (count: number) =>
      `Inserted ${formatNumber(count)} byte${count === 1 ? '' : 's'}`,
    replacedRangeWithFile: (from: number, to: number) =>
      `Replaced ${formatNumber(from)} byte${from === 1 ? '' : 's'} with ${formatNumber(to)} byte${to === 1 ? '' : 's'}`,
    resultTitle: 'Transform result',
    resultDefault: 'Result',
    resultAvailable: (label: string) => `${label} available`,
    resultHistoryTitle: 'Open recent transform results',
    resultHistoryLabel: 'Recent transform results',
    resultHistoryItem: (
      label: string,
      rangeStart: string,
      rangeEnd: string,
      createdAt: string
    ) => `${label} | ${rangeStart}-${rangeEnd} | ${createdAt}`,
    openResult: (title: string, label: string) => `Open ${title} ${label} result`,
    contentChanged: 'Changed',
    contentUnchanged: 'Unchanged',
    resultLabel: 'Label',
    resultValue: 'Transform result value',
    resultMimeType: 'MIME',
    copyResult: 'Copy',
    resultCopied: 'Copied',
    resultCopyFailed: 'Copy failed',
    dismissResult: 'Dismiss transform result',
    dismissResultSymbol: 'x',
    transformed: (from: number, to: number) =>
      `Transformed ${formatNumber(from)} byte${from === 1 ? '' : 's'} into ${formatNumber(to)} byte${to === 1 ? '' : 's'}`,
    completed: 'Transform completed',
    calculationCompleted: 'Calculation completed',
    noContentChange: 'Transform completed without content changes',
  },
  search: {
    label: 'Find bytes',
    placeholder: 'Find text or hex',
    replacePlaceholder: 'Replace with text or hex',
    hex: 'Hex',
    ignoreCase: 'Ignore case',
    forward: 'Forward',
    reverse: 'Reverse',
    directionTitle: 'Search direction',
    find: 'Find',
    previous: 'Search Previous',
    next: 'Search Next',
    previousTitle: 'Previous match',
    nextTitle: 'Next match',
    replace: 'Replace',
    replaceAll: 'Replace All',
    noSearch: 'No search',
    invalidHex: 'Invalid hex',
    invalidSearch: 'Invalid search',
    invalidReplacementHex: 'Invalid replacement hex',
    ready: 'Ready',
    searching: 'Searching...',
    largeSearch: 'Large search',
    noMatches: 'No matches',
    searchComplete: 'Search complete',
    noMatch: 'No match',
    largeMatchSummary: (limit: number, offset: string) =>
      `${formatNumber(limit)}+ matches @ ${offset}`,
    boundedMatchSummary: (index: number, total: number, offset: string) =>
      `${index + 1} / ${total} @ ${offset}`,
    replaceSummary: (count: number) =>
      count === 1
        ? 'Replaced 1 match'
        : `Replaced ${formatNumber(count)} matches`,
    replacingAll: 'Replacing matches...',
  },
  grid: {
    label: 'OmegaEdit byte editor',
    offset: 'Offset',
    hexPane: 'HEX',
    text: 'TEXT',
    textPane: 'TEXT',
    waitingForData: 'Waiting for data',
    emptyFile: 'Empty file',
    preparingFile: 'Preparing file...',
    readOnly: 'Read-only',
    insertTitle: 'Insert mode',
    overwriteTitle: 'Overwrite mode',
    notPrintable: 'Not printable',
    printableByte: 'Printable ASCII',
    printableTextByte: (label: string) => `Printable ${label}`,
    controlByte: 'Control byte',
    highBitByte: 'High-bit byte',
    byteLabel: (hex: string, offset: string) => `Byte ${hex} at offset ${offset}`,
    textLabel: (text: string, offset: string) => `Text ${text} at offset ${offset}`,
    hexByteTitle: (hex: string) => `HEX Byte '${hex}'`,
    textByteTitle: 'TEXT Byte',
    byteHoverTitle: (
      pane: string,
      offset: string,
      hex: string,
      decimal: string,
      binary: string,
      text: string,
      byteClass: string,
      mode: string
    ) =>
      `${pane}\nOffset: ${offset}\nValue: 0x${hex} / ${decimal} / ${binary}\nText: ${text}\nClass: ${byteClass}\nMode: ${mode}`,
    byteTooltipTitle: (
      pane: string,
      offset: string,
      hex: string,
      decimal: string,
      binary: string,
      textLabel: string,
      text: string,
      byteClass: string
    ) =>
      `${pane}\nOffset: ${offset}\nValue: 0x${hex} / ${decimal} / ${binary}\n${textLabel}: ${text}\nClass: ${byteClass}`,
    externalHighlight: (label: string, source?: string) =>
      source ? `External: ${label} (${source})` : `External: ${label}`,
    externalHighlightRange: (start: string, end: string) =>
      `Range: ${start}-${end}`,
    externalHighlightPosition: (position: number, length: number) =>
      `Position: byte ${formatNumber(position)} of ${formatNumber(length)}`,
    externalHighlightStale: 'Stale: content changed; reparse to refresh labels',
  },
  inspector: {
    label: 'Selected byte inspector',
    title: 'Inspector',
    show: 'Show',
    collapseSymbol: 'X',
    expand: 'Expand inspector',
    collapse: 'Collapse inspector',
    selection: 'Selection',
    noSelection: 'No selection',
    byte: (count: number) => `${formatNumber(count)} byte${count === 1 ? '' : 's'}`,
    copying: 'Copying...',
    copied: 'Copied',
    cut: 'Cut',
    insert: 'Insert',
    overwrite: 'Overwrite',
    apply: 'Apply',
    asHex: 'hex',
    asText: 'text',
    clipboardComplete: (
      action: 'copy' | 'cut',
      byteCount: number,
      format: 'hex' | 'utf8'
    ) =>
      `${action === 'cut' ? strings.inspector.cut : strings.inspector.copied} ${strings.inspector.byte(byteCount)} as ${
        format === 'hex' ? strings.inspector.asHex : strings.inspector.asText
      }`,
    hex: 'Hex',
    dec: 'Dec',
    bin: 'Bin',
    text: 'Text',
    focus: 'Focus',
    ascii: 'ASCII',
    utf8: 'UTF-8',
    utf16: 'UTF-16',
    octal: 'Octal',
    byteValue: 'Byte',
    uint8: 'uint8',
    int8: 'int8',
    uint16: 'uint16',
    int16: 'int16',
    uint32: 'uint32',
    int32: 'int32',
    uint64: 'uint64',
    int64: 'int64',
    float32: 'float32',
    float64: 'float64',
    byteOrder: 'Byte order',
    littleEndian: 'LE',
    bigEndian: 'BE',
    valueInput: (label: string) => `${label} value`,
    invalidHexByte: 'Enter exactly two hex digits',
    invalidAsciiByte: 'Enter one printable ASCII character',
    invalidTextByte: 'Enter one character representable in the selected encoding',
    invalidBinaryByte: 'Enter up to eight binary digits',
    invalidOctalByte: 'Enter a byte-sized octal value',
    invalidInteger: 'Invalid integer',
    invalidValue: 'Invalid value',
    emptyValue: 'Enter a value',
    outOfRange: 'Out of range',
    invalidHexPaste: 'Clipboard does not contain valid hex bytes',
    invalidAsciiPaste: 'Clipboard does not contain printable ASCII',
    invalidTextPaste: 'Clipboard text is not representable in the selected encoding',
    cannotOverwrite: 'Select an existing byte to overwrite',
    insertedByte: 'Inserted 1 byte',
    overwroteByte: 'Overwrote 1 byte',
    overwroteBytes: (count: number) =>
      count === 1
        ? 'Overwrote 1 byte'
        : `Overwrote ${formatNumber(count)} bytes`,
    copiedSelection: (count: number, format: 'hex' | 'utf8') =>
      `Copied ${strings.inspector.byte(count)} as ${
        format === 'hex' ? strings.inspector.asHex : strings.inspector.asText
      }`,
    cutSelection: (count: number) => `Cut ${strings.inspector.byte(count)}`,
    deletedBytes: (count: number) =>
      count === 1
        ? 'Deleted 1 byte'
        : `Deleted ${formatNumber(count)} bytes`,
    pastedBytes: (count: number) =>
      count === 1
        ? 'Pasted 1 byte'
        : `Pasted ${formatNumber(count)} bytes`,
  },
  profiler: {
    label: 'OmegaEdit profiler',
    title: 'Analyzer',
    views: 'Analysis views',
    profile: 'Profile',
    structure: 'Structure',
    show: 'Show',
    collapseSymbol: 'X',
    expand: 'Expand profiler',
    collapse: 'Collapse profiler',
    expandSection: (title: string) => `Expand ${title}`,
    collapseSection: (title: string) => `Collapse ${title}`,
    moveSection: (title: string) => `Move ${title} section`,
    moveSectionTitle: 'Drag or use Arrow Up and Arrow Down to reorder',
    viewport: 'Viewport',
    byteClasses: 'Byte Classes',
    dataProfile: 'Data Profile',
    frequency: 'Frequency',
    history: 'History',
    timing: 'Timing',
    server: 'Server',
    rangeMap: 'Range Map',
    noRangeMap: 'No range map loaded.',
    loadRangeMap: 'Load',
    unloadRangeMap: 'Unload',
    loadRangeMapTitle: 'Load range map',
    unloadRangeMapTitle: 'Unload range map',
    expandRangeMapAllTitle: 'Expand all range map nodes',
    collapseRangeMapAllTitle: 'Collapse all range map nodes',
    expandRangeMapNode: (label: string) => `Expand ${label}`,
    collapseRangeMapNode: (label: string) => `Collapse ${label}`,
    rangeMapNodeTitle: (label: string, offset: string, length: string) =>
      `${label} | ${offset} | ${length}`,
    liveStatus: 'Live Status',
    currentInstance: 'Current Instance',
    hostAndBuild: 'Host and Build',
    details: 'Details',
    status: 'Status',
    pending: 'Pending',
    ok: 'OK',
    warn: 'Warn',
    error: 'Error',
    down: 'Down',
    visibleBytes: 'Visible Bytes',
    selection: 'Selection',
    noBytes: 'No bytes in scope.',
    noProfileData: 'No profile data in scope.',
    profileCapped: (length: string, requestedLength: string) =>
      `Profile capped at ${length} of ${requestedLength}.`,
    frequencyByte: (label: string, count: number) =>
      `${label} count ${formatNumber(count)}`,
    count: 'Count',
    linear: 'Linear',
    log: 'Log',
    switchLinear: 'Switch frequency chart to linear scale',
    switchLog: 'Switch frequency chart to log scale',
    offset: 'Offset',
    buffered: 'Buffered',
    visible: 'Visible',
    rows: 'Rows',
    capacity: 'Capacity',
    coverage: 'Coverage',
    coverageValue: (buffer: string, visible: string) =>
      `${buffer} buffer / ${visible} visible`,
    following: 'Following',
    changes: 'Changes',
    sync: 'Sync',
    fetch: 'Fetch',
    bridge: 'Bridge',
    render: 'Render',
    avgRender: 'Avg Render',
    updated: 'Updated',
    message: 'Message',
    scope: 'Scope',
    bytes: 'Bytes',
    dosEol: 'DOS EOL',
    modeByte: 'Mode',
    ascii: 'ASCII',
    textPrintable: (label: string) => `Printable ${label}`,
    content: 'Content',
    language: 'Language',
    bom: 'BOM',
    bomBytes: 'BOM Bytes',
    oneByteChars: '1B Chars',
    twoByteChars: '2B Chars',
    threeByteChars: '3B Chars',
    fourByteChars: '4B Chars',
    invalid: 'Invalid',
    unique: 'Unique',
    density: 'Density',
    entropy: 'Entropy',
    freqSpread: 'Freq Spread',
    printable: 'Printable',
    longestRun: 'Longest Run',
    undo: 'Undo',
    redo: 'Redo',
    canUndo: 'Can Undo',
    canRedo: 'Can Redo',
    yes: 'Yes',
    no: 'No',
  },
  status: {
    hexPending: (label: string) => `Hex edit: ${label}`,
  },
}

export type WebviewStrings = typeof englishStrings
type LocaleStringOverrides = {
  [Section in keyof WebviewStrings]?: Partial<WebviewStrings[Section]>
}

// Locale overrides may be partial; missing strings fall back to English.
const localeOverrides: Record<string, LocaleStringOverrides> = {
  es: {
    app: {
      missingMountPoint: 'Falta el punto de montaje de la vista web de Svelte',
      failedToStart: (message: string) =>
        `No se pudo iniciar la vista web del editor: ${message}`,
    },
    toolbar: {
      label: 'Barra de herramientas del editor OmegaEdit',
      bytesPerRow: 'Bytes por fila',
      bytesPerRowSelect: 'Bytes/fila',
      bytesPerRowOptions: 'Elegir un valor estandar de bytes por fila',
      bytesPerRowRequired: 'Introduce un valor de bytes por fila',
      bytesPerRowInteger: 'Usa un numero entero',
      bytesPerRowRange: (min: number, max: number) =>
        `Usa un valor de ${formatNumber(min)} a ${formatNumber(max)}`,
      customBytesPerRow: 'Bytes por fila personalizados',
      customBytesPerRowTitle: (min: number, max: number) =>
        `Establecer bytes por fila de ${formatNumber(min)} a ${formatNumber(max)}`,
      offsetRadix: 'Base del desplazamiento',
      hexOffsets: 'Hex',
      decOffsets: 'Dec',
      hexOffsetsTitle: 'Mostrar desplazamientos en hexadecimal',
      decOffsetsTitle: 'Mostrar desplazamientos en decimal',
      insertDirection: 'Direccion de insercion',
      forwardInsert: 'Adelante',
      backwardInsert: 'Atras',
      forwardInsertTitle:
        'Direccion de insercion: adelante. Haz clic para insertar hacia atras.',
      backwardInsertTitle:
        'Direccion de insercion: atras. Haz clic para insertar hacia adelante.',
      searchPanel: 'Buscar',
      showSearchPanelTitle: 'Mostrar buscar y reemplazar',
      hideSearchPanelTitle: 'Ocultar buscar y reemplazar',
    },
    encoding: {
      ascii: 'ASCII',
      windows1252: 'Windows-1252',
      cp437: 'CP437',
      ebcdic037: 'EBCDIC',
      macRoman: 'MacRoman',
      notRepresentable:
        'No representable en la codificacion de texto seleccionada',
      printable: (label: string) => `Imprimible (${label})`,
      inspectorText: (label: string) => `Texto (${label})`,
    },
    navigation: {
      offsetLabel: 'Desplazamiento',
      offsetTitleHex: 'Ir al desplazamiento hexadecimal',
      offsetTitleDec: 'Ir al desplazamiento decimal',
      offsetRequired: 'Introduce un desplazamiento',
      invalidHexOffset: 'Desplazamiento hexadecimal no valido',
      invalidDecimalOffset: 'Desplazamiento decimal no valido',
      noFile: 'No hay archivo cargado',
      offsetOutOfRange: (maxOffset: string) => `Max ${maxOffset}`,
      scrollbarLabel: 'Navegacion del archivo',
      scrollbarDisabled: 'El archivo cabe en la vista',
      scrollbarValue: (offset: string, progress: string) =>
        `${offset} (${progress})`,
    },
    transform: {
      label: 'Accion',
      choose: 'Seleccionar accion...',
      chooseTitle: 'Elegir una accion para el archivo actual',
      calculationsGroup: 'Calculos',
      transformsGroup: 'Transformaciones',
      fileSplicingGroup: 'Union de archivos',
      sessionGroup: 'Sesion',
      createCheckpoint: 'Punto de control',
      rollbackCheckpoint: 'Revertir',
      exportChangeLog: 'Exportar registro',
      applyChangeLog: 'Aplicar registro',
      loading: 'Cargando transformaciones...',
      selectRange: 'Selecciona bytes primero',
      selectRangeFirst: 'Selecciona uno o mas bytes para transformar',
      options: 'Opciones',
      apply: 'Aplicar',
      cancel: 'Cancelar',
      cancelInFlight: 'Cancelar',
      cancelInFlightTitle: 'Cancelar la transformacion en ejecucion',
      cancelling: 'Cancelando transformacion...',
      closeDialog: 'Cerrar opciones de transformacion',
      resultTitle: 'Resultado de transformacion',
      resultDefault: 'Resultado',
      copyResult: 'Copiar',
      resultCopied: 'Copiado',
      resultCopyFailed: 'No se pudo copiar',
      dismissResult: 'Descartar resultado de transformacion',
      completed: 'Transformacion completada',
      calculationCompleted: 'Calculo completado',
      noContentChange:
        'La transformacion termino sin cambios en el contenido',
    },
    search: {
      label: 'Buscar bytes',
      placeholder: 'Buscar texto o hexadecimal',
      replacePlaceholder: 'Reemplazar con texto o hexadecimal',
      hex: 'Hex',
      ignoreCase: 'Ignorar mayusculas',
      forward: 'Adelante',
      reverse: 'Atras',
      directionTitle: 'Direccion de busqueda',
      find: 'Buscar',
      previous: 'Buscar anterior',
      next: 'Buscar siguiente',
      previousTitle: 'Coincidencia anterior',
      nextTitle: 'Coincidencia siguiente',
      replace: 'Reemplazar',
      replaceAll: 'Reemplazar todo',
      noSearch: 'Sin busqueda',
      invalidHex: 'Hexadecimal no valido',
      invalidSearch: 'Busqueda no valida',
      invalidReplacementHex: 'Reemplazo hexadecimal no valido',
      ready: 'Listo',
      searching: 'Buscando...',
      noMatches: 'Sin coincidencias',
      searchComplete: 'Busqueda completada',
      noMatch: 'Sin coincidencia',
      boundedMatchSummary: (index: number, total: number, offset: string) =>
        `${formatNumber(index + 1)} / ${formatNumber(total)} @ ${offset}`,
      replaceSummary: (count: number) =>
        count === 1
          ? 'Se reemplazo 1 coincidencia'
          : `Se reemplazaron ${formatNumber(count)} coincidencias`,
      replacingAll: 'Reemplazando coincidencias...',
    },
    grid: {
      offset: 'Desplazamiento',
      waitingForData: 'Esperando datos',
      emptyFile: 'Archivo vacío',
      preparingFile: 'Preparando archivo...',
      readOnly: 'Solo lectura',
      insertTitle: 'Modo insertar',
      overwriteTitle: 'Modo sobrescribir',
      notPrintable: 'No imprimible',
      printableByte: 'ASCII imprimible',
      controlByte: 'Byte de control',
      highBitByte: 'Byte de bit alto',
      externalHighlightStale:
        'Obsoleto: el contenido cambió; vuelve a analizar para actualizar etiquetas',
    },
    inspector: {
      label: 'Inspector de byte seleccionado',
      title: 'Inspector',
      show: 'Mostrar',
      expand: 'Expandir inspector',
      collapse: 'Contraer inspector',
      selection: 'Seleccion',
      noSelection: 'Sin seleccion',
      byte: (count: number) => `${formatNumber(count)} byte${count === 1 ? '' : 's'}`,
      copying: 'Copiando...',
      copied: 'Copiado',
      cut: 'Cortar',
      insert: 'Insertar',
      overwrite: 'Sobrescribir',
      apply: 'Aplicar',
      asHex: 'hex',
      asText: 'texto',
      byteOrder: 'Orden de bytes',
      emptyValue: 'Introduce un valor',
      invalidValue: 'Valor no valido',
      outOfRange: 'Fuera de rango',
    },
    profiler: {
      label: 'Perfilador OmegaEdit',
      title: 'Analizador',
      views: 'Vistas de analisis',
      profile: 'Perfil',
      structure: 'Estructura',
      show: 'Mostrar',
      expand: 'Expandir perfilador',
      collapse: 'Contraer perfilador',
      viewport: 'Vista',
      byteClasses: 'Clases de bytes',
      dataProfile: 'Perfil de datos',
      frequency: 'Frecuencia',
      history: 'Historial',
      timing: 'Tiempos',
      server: 'Servidor',
      rangeMap: 'Mapa de rangos',
      noRangeMap: 'No hay mapa de rangos cargado.',
      loadRangeMap: 'Cargar',
      unloadRangeMap: 'Quitar',
      loadRangeMapTitle: 'Cargar mapa de rangos',
      unloadRangeMapTitle: 'Quitar mapa de rangos',
      expandRangeMapAllTitle: 'Expandir todos los nodos del mapa de rangos',
      collapseRangeMapAllTitle: 'Contraer todos los nodos del mapa de rangos',
      expandRangeMapNode: (label: string) => `Expandir ${label}`,
      collapseRangeMapNode: (label: string) => `Contraer ${label}`,
      rangeMapNodeTitle: (label: string, offset: string, length: string) =>
        `${label} | ${offset} | ${length}`,
      details: 'Detalles',
      status: 'Estado',
      pending: 'Pendiente',
      ok: 'OK',
      warn: 'Aviso',
      error: 'Error',
      down: 'Inactivo',
      selection: 'Seleccion',
      noBytes: 'No hay bytes en el alcance.',
      noProfileData: 'No hay datos de perfil en el alcance.',
      count: 'Conteo',
      offset: 'Desplazamiento',
      visible: 'Visible',
      rows: 'Filas',
      capacity: 'Capacidad',
      bytes: 'Bytes',
      language: 'Idioma',
      yes: 'Si',
      no: 'No',
    },
    status: {
      hexPending: (label: string) => `Edicion hex: ${label}`,
    },
  },
} satisfies Record<string, LocaleStringOverrides>

function createStringTable(): WebviewStrings {
  return {
    app: { ...englishStrings.app },
    toolbar: { ...englishStrings.toolbar },
    encoding: { ...englishStrings.encoding },
    navigation: { ...englishStrings.navigation },
    transform: { ...englishStrings.transform },
    search: { ...englishStrings.search },
    grid: { ...englishStrings.grid },
    inspector: { ...englishStrings.inspector },
    profiler: { ...englishStrings.profiler },
    status: { ...englishStrings.status },
  }
}

export const strings: WebviewStrings = createStringTable()

function applyLocaleOverrides(overrides?: LocaleStringOverrides): void {
  Object.assign(strings.app, englishStrings.app, overrides?.app)
  Object.assign(strings.toolbar, englishStrings.toolbar, overrides?.toolbar)
  Object.assign(strings.encoding, englishStrings.encoding, overrides?.encoding)
  Object.assign(
    strings.navigation,
    englishStrings.navigation,
    overrides?.navigation
  )
  Object.assign(strings.transform, englishStrings.transform, overrides?.transform)
  Object.assign(strings.search, englishStrings.search, overrides?.search)
  Object.assign(strings.grid, englishStrings.grid, overrides?.grid)
  Object.assign(strings.inspector, englishStrings.inspector, overrides?.inspector)
  Object.assign(strings.profiler, englishStrings.profiler, overrides?.profiler)
  Object.assign(strings.status, englishStrings.status, overrides?.status)
}

export function resolveLanguage(language: string | undefined): string {
  const normalized = normalizeLanguageTag(language ?? '')
  if (!normalized || normalized === DEFAULT_LANGUAGE) {
    return DEFAULT_LANGUAGE
  }
  if (Object.prototype.hasOwnProperty.call(localeOverrides, normalized)) {
    return normalized
  }
  const [baseLanguage] = normalized.split('-')
  return Object.prototype.hasOwnProperty.call(localeOverrides, baseLanguage)
    ? baseLanguage
    : DEFAULT_LANGUAGE
}

export function setLanguage(language: string | undefined): string {
  activeLanguage = resolveLanguage(language)
  applyLocaleOverrides(localeOverrides[activeLanguage])
  return activeLanguage
}

export function getLanguage(): string {
  return activeLanguage
}

export function getSupportedLanguages(): string[] {
  return [DEFAULT_LANGUAGE, ...Object.keys(localeOverrides)]
}
