// Copyright (c) 2026 Concurrent Technologies Corporation.

// Licensed under the Apache License, Version 2.0.

// https://www.apache.org/licenses/LICENSE-2.0

// Generated from src/api.ts. Do not edit; run npm run compile:extension.

// Copy with omegaEdit.ts into your extension. Only @types/vscode is required.

import type * as vscode from 'vscode';

export declare const OMEGA_EDIT_EXTENSION_PUBLISHER = "ctc-oss";

export declare const OMEGA_EDIT_EXTENSION_NAME = "omega-edit-data-editor";

export declare const OMEGA_EDIT_EXTENSION_ID: "ctc-oss.omega-edit-data-editor";

export declare const OMEGA_EDIT_EXTENSION_API_VERSION = 2;

export type OmegaEditExternalHighlightKind = ExternalHighlightKind;

export type ExternalHighlightKind = 'current' | 'parsed' | 'error' | 'warning' | 'breakpoint' | 'secondary';

export type OmegaEditExternalHighlight = WebviewExternalHighlight;

export interface WebviewExternalHighlight {
    id: string;
    offset: number;
    length: number;
    kind: ExternalHighlightKind;
    label: string;
    source?: string;
    stale?: boolean;
}

export type OmegaEditEditorState = WebviewEditorState;

export interface WebviewEditorState extends WebviewEditorUiState {
    uri: string;
    filePath: string;
    fileSize: number;
    transformInFlight: boolean;
    dirty: boolean;
    canUndo: boolean;
    canRedo: boolean;
    undoCount: number;
    redoCount: number;
    savedChangeDepth: number;
    changeCount: number;
    sessionSyncVersion: number;
    externalHighlights: WebviewExternalHighlight[];
    transformSummaries: Array<{
        id: string;
        name: string;
        description: string;
        operation: number;
        support: number;
        flags: number;
    }>;
    contentSources: WebviewSessionContentInfo[];
}

export interface WebviewEditorUiState {
    visibleOffset: number;
    visibleByteCount: number;
    selectedOffset: number;
    selectionStart: number;
    selectionEnd: number;
    selectionLength: number;
    bytesPerRow: BytesPerRow;
    offsetRadix: OffsetRadix;
    textEncoding: TextEncoding;
    activePane: GridEditPane;
    editMode: WebviewEditMode;
    insertDirection: InsertDirection;
}

export type BytesPerRow = number;

export type OffsetRadix = 'hex' | 'dec';

export type TextEncoding = (typeof TEXT_ENCODING_OPTIONS)[number];

export declare const TEXT_ENCODING_OPTIONS: readonly [
    "ascii",
    "windows-1252",
    "cp437",
    "ebcdic-037",
    "macroman"
];

export type GridEditPane = 'hex' | 'ascii';

export type WebviewEditMode = 'insert' | 'overwrite';

export type InsertDirection = 'forward' | 'backward';

export interface WebviewSessionContentInfo {
    content: WebviewSessionContentSource;
    available: boolean;
    byteLength: number;
    label: string;
}

export type WebviewSessionContentSource = 'original' | 'computed' | 'latestCheckpoint';

export type OmegaEditInsertDirection = InsertDirection;

export type OmegaEditTextEncoding = TextEncoding;

export type OmegaEditAssistantContext = AssistantSessionContext;

export interface AssistantSessionContext {
    version: typeof OMEGA_EDIT_ASSISTANT_CONTEXT_VERSION;
    session: {
        id: string;
        uri: string | null;
        filePath: string | null;
    };
    sizes: {
        computed: number;
        original: number | string | null;
    };
    dirty: boolean;
    selection: {
        offset: number;
        start: number;
        end: number;
        length: number;
    } | null;
    viewport: {
        count: number;
        activeViewportId: string | null;
        visibleOffset: number | null;
        visibleByteCount: number | null;
        bytesPerRow: number | null;
        offsetRadix: OffsetRadix | null;
        activePane: GridEditPane | null;
        editMode: WebviewEditMode | null;
        insertDirection: InsertDirection | null;
        textEncoding: TextEncoding | null;
    };
    history: {
        changeCount: number;
        undoCount: number;
        redoCount: number;
        undoStackDepth: number;
        redoStackDepth: number;
        canUndo: boolean;
        canRedo: boolean;
        checkpointCount: number | null;
        checkpointAvailable: boolean;
        savedChangeDepth: number | null;
        pendingChanges: boolean;
        pendingOperation: 'undo' | 'redo' | null;
        pendingCount: number;
    };
    transforms: {
        inFlight: boolean;
        available: boolean;
        pluginCount: number;
        plugins: AssistantTransformPluginSummary[];
    };
    changeLog: {
        format: 'omega-edit.change-log';
        version: 2;
        exportAvailable: boolean;
        applyAvailable: boolean;
        sourceChangeCount: number;
        completeExportAvailable: boolean;
    };
    commands: AssistantCommandSurfaceEntry[];
}

export declare const OMEGA_EDIT_ASSISTANT_CONTEXT_VERSION = 1;

export interface AssistantTransformPluginSummary {
    id: string;
    name: string;
    description?: string;
    operation: number;
    operationName?: string;
    support: number;
    supportName?: string;
    flags: number;
    abiVersion?: number;
}

export interface AssistantCommandSurfaceEntry {
    action: string;
    ui?: string;
    vscodeCommands?: string[];
    extensionApis?: string[];
    cliCommands?: string[];
    mcpTools?: string[];
    result: string;
}

export type OmegaEditActionJournalKind = WebviewActionJournalKind;

export type WebviewActionJournalKind = (typeof WEBVIEW_ACTION_JOURNAL_KINDS)[number];

export declare const WEBVIEW_ACTION_JOURNAL_KINDS: readonly [
    "INSERT",
    "DELETE",
    "OVERWRITE",
    "REPLACE",
    "TRANSFORM"
];

export type OmegaEditActionJournalViewport = WebviewActionJournalViewport & {
    sessionId: string;
};

export interface WebviewActionJournalViewport {
    version: 1;
    activeTipSerial: string;
    changeCount: string;
    undoCount: string;
    checkpointCount: string;
    anchorSerial: string;
    capacity: number;
    direction: 'older' | 'newer';
    entries: WebviewActionJournalEntry[];
    hasMore: boolean;
    nextAnchorSerial?: string;
}

export interface WebviewActionJournalEntry {
    index: string;
    firstSerial: string;
    lastSerial: string;
    kind: WebviewActionJournalKind;
    offset: string;
    length: string;
    dataLength: string;
    sizeDelta: string;
    changeCountBefore: string;
    changeCountAfter: string;
    checkpointBefore?: string;
    checkpointAfter?: string;
    transactionId?: string;
    payloadHint: 'none' | 'inline' | 'file-backed' | 'checkpoint-backed';
    transform?: {
        transformId: string;
        optionsJson?: string;
        replacementLength: string;
        computedFileSizeBefore: string;
        computedFileSizeAfter: string;
    };
}

export interface OmegaEditEditorSelector {
    uri?: vscode.Uri | string;
}

export interface OmegaEditOpenOptions {
    offset?: number;
}

export interface OmegaEditRevealOptions extends OmegaEditEditorSelector {
    offset: number;
}

export interface OmegaEditInsertDirectionOptions extends OmegaEditEditorSelector {
    direction?: OmegaEditInsertDirection;
}

export interface OmegaEditExternalHighlightRequest extends OmegaEditEditorSelector {
    highlights: OmegaEditExternalHighlight[];
    reveal?: boolean;
}

export interface OmegaEditRangeMapLoadOptions extends OmegaEditEditorSelector {
    sourceUri?: vscode.Uri | string;
    reveal?: boolean;
    notify?: boolean;
}

export interface OmegaEditRangeMapUnloadOptions extends OmegaEditEditorSelector {
    notify?: boolean;
}

export interface OmegaEditCheckpointOptions extends OmegaEditEditorSelector {
}

export interface OmegaEditActionJournalViewportOptions extends OmegaEditEditorSelector {
    anchorSerial?: string | number | bigint;
    capacity?: number;
    direction?: 'older' | 'newer';
    kinds?: OmegaEditActionJournalKind[];
    transactionId?: string;
}

export interface OmegaEditChangeLogExportOptions extends OmegaEditEditorSelector {
    targetUri?: vscode.Uri | string;
}

export interface OmegaEditChangeLogApplyOptions extends OmegaEditEditorSelector {
    sourceUri?: vscode.Uri | string;
}

export interface OmegaEditChangeLogPreviewOptions extends OmegaEditEditorSelector {
    sourceUri?: vscode.Uri | string;
}

export interface OmegaEditCheckpointResult {
    state?: OmegaEditEditorState;
    checkpointCount: number;
}

export interface OmegaEditRollbackCheckpointResult {
    state?: OmegaEditEditorState;
    rolledBack: boolean;
    checkpointCount: number;
}

export interface OmegaEditRestoreCheckpointResult {
    state?: OmegaEditEditorState;
    restored: boolean;
    checkpointCount: number;
    changeCount: number;
    discardedChangeCount: number;
}

export interface OmegaEditChangeLogDigest {
    pluginId?: string;
    algorithm: string;
    value: string;
}

export interface OmegaEditChangeLogFingerprint {
    byteLength: number | string;
    digest: OmegaEditChangeLogDigest;
}

export interface OmegaEditChangeLogPrimitiveCounts {
    total: number;
    insert: number;
    delete: number;
    overwrite: number;
    replace: number;
    transform: number;
}

export interface OmegaEditChangeLogPreview {
    state?: OmegaEditEditorState;
    uri?: vscode.Uri;
    format: 'omega-edit.change-log';
    version: 2;
    complete: boolean;
    canApply: boolean;
    primitiveCounts: OmegaEditChangeLogPrimitiveCounts;
    before: OmegaEditChangeLogFingerprint;
    after: OmegaEditChangeLogFingerprint;
    current?: OmegaEditChangeLogFingerprint;
    expectedSize: {
        beforeByteLength: string;
        afterByteLength: string;
        deltaBytes: string;
    };
    transformDescriptors: Array<{
        index: number;
        serial?: number | string;
        offset: number | string;
        length: number | string;
        transformId: string;
        optionsJson?: string;
        descriptorSource: 'data';
    }>;
    requiredPlugins: string[];
    missingPlugins: string[];
    unavailablePrimitives: {
        count: number | string;
        serials: Array<number | string>;
    };
    rollbackProtection: {
        available: boolean;
        strategy: 'restore-to-change-count' | 'not-inspected';
        targetChangeCount?: number;
        checkpointCount?: number;
    };
    safetyIssues: Array<{
        severity: 'error' | 'warning';
        code: string;
        message: string;
    }>;
}

export interface OmegaEditChangeLogResult {
    state?: OmegaEditEditorState;
    uri?: vscode.Uri;
    changeCount: number;
    appliedCount?: number;
    sourceChangeCount?: number;
    complete?: boolean;
    before?: OmegaEditChangeLogFingerprint;
    after?: OmegaEditChangeLogFingerprint;
    unavailableChangeCount?: number;
    unavailableChangeSerials?: Array<number | string>;
    cancelled?: boolean;
    preview?: OmegaEditChangeLogPreview;
    rollback?: {
        attempted: boolean;
        succeeded?: boolean;
        rolledBack?: boolean;
        targetChangeCount?: number;
        error?: string;
    };
    finalFingerprint?: OmegaEditChangeLogFingerprint;
}

export interface OmegaEditRangeMapLoadResult {
    state?: OmegaEditEditorState;
    sourceUri?: vscode.Uri;
    source?: string;
    nodeCount: number;
    highlightCount: number;
    selectedPath?: string;
    selectedRange?: {
        offset: number;
        length: number;
    };
    cancelled?: boolean;
    message?: string;
}

export interface OmegaEditRangeMapUnloadResult {
    state?: OmegaEditEditorState;
    unloadedCount: number;
    highlightCount: number;
}

export interface OmegaEditExtensionApi {
    /**
     * Stable VS Code extension id expected by dependent extensions.
     */
    readonly extensionId: typeof OMEGA_EDIT_EXTENSION_ID;
    /**
     * Version of this activation API contract, independent of package version.
     */
    readonly version: typeof OMEGA_EDIT_EXTENSION_API_VERSION;
    readonly onDidChangeEditorState: vscode.Event<OmegaEditEditorState>;
    open(uri: vscode.Uri, options?: OmegaEditOpenOptions): Promise<OmegaEditEditorState | undefined>;
    reveal(uriOrOptions: vscode.Uri | string | OmegaEditRevealOptions, offset?: number): Promise<OmegaEditEditorState | undefined>;
    getEditorState(options?: vscode.Uri | string | OmegaEditEditorSelector): OmegaEditEditorState | undefined;
    getAssistantContext(options?: vscode.Uri | string | OmegaEditEditorSelector): OmegaEditAssistantContext | undefined;
    getActionJournalViewport(options?: OmegaEditActionJournalViewportOptions): Promise<OmegaEditActionJournalViewport | undefined>;
    setExternalHighlights(request: OmegaEditExternalHighlightRequest): Promise<OmegaEditEditorState | undefined>;
    clearExternalHighlights(options?: vscode.Uri | string | OmegaEditEditorSelector): OmegaEditEditorState | undefined;
    loadRangeMap(options?: vscode.Uri | string | OmegaEditRangeMapLoadOptions): Promise<OmegaEditRangeMapLoadResult | undefined>;
    unloadRangeMap(options?: vscode.Uri | string | OmegaEditRangeMapUnloadOptions): OmegaEditRangeMapUnloadResult | undefined;
    setInsertDirection(directionOrOptions?: OmegaEditInsertDirection | vscode.Uri | string | OmegaEditInsertDirectionOptions, options?: vscode.Uri | string | OmegaEditEditorSelector): OmegaEditEditorState | undefined;
    createCheckpoint(options?: vscode.Uri | string | OmegaEditCheckpointOptions): Promise<OmegaEditCheckpointResult | undefined>;
    rollbackCheckpoint(options?: vscode.Uri | string | OmegaEditCheckpointOptions): Promise<OmegaEditRollbackCheckpointResult | undefined>;
    restoreCheckpoint(options?: vscode.Uri | string | OmegaEditCheckpointOptions): Promise<OmegaEditRestoreCheckpointResult | undefined>;
    exportChangeLog(options?: vscode.Uri | string | OmegaEditChangeLogExportOptions): Promise<OmegaEditChangeLogResult | undefined>;
    previewChangeLog(options?: vscode.Uri | string | OmegaEditChangeLogPreviewOptions): Promise<OmegaEditChangeLogPreview | undefined>;
    applyChangeLog(options?: vscode.Uri | string | OmegaEditChangeLogApplyOptions): Promise<OmegaEditChangeLogResult | undefined>;
}

