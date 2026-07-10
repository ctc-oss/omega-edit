# Checkpoint Timeline Production Plan

**Status:** Active implementation backlog

**Canonical source:** This document is the source of truth for productionizing
the interactive checkpoint timeline requested by GitHub issue #1527. GitHub
issues and pull requests should link here rather than duplicate the technical
design.

**Related documents:**

- `wiki/Change-Log-Optimizer.md` defines the coordinate-aware optimizer.
- `SHORTCOMINGS.md` tracks repository-wide shortcomings, including streaming
  import and checkpoint resource limits.
- `vscode-extension/docs/svelte-ai-migration-requirements.md` documents the
  webview architecture and quality expectations.

**GitHub execution tracker:**

- [#1531 — Productionize checkpoint timeline with storage-backed optimized
  history](https://github.com/ctc-oss/omega-edit/issues/1531)
- [#1534 — WP0: specification
  hardening](https://github.com/ctc-oss/omega-edit/issues/1534)
- [#1533 — WP1: shared streaming change-log
  codec](https://github.com/ctc-oss/omega-edit/issues/1533)
- [#1535 — WP2: coordinate-aware ranged optimized
  export](https://github.com/ctc-oss/omega-edit/issues/1535)
- [#1532 — WP3: atomic checkpoint interval
  storage](https://github.com/ctc-oss/omega-edit/issues/1532)
- [#1537 — WP4: failure-atomic timeline navigation and Auto
  Save](https://github.com/ctc-oss/omega-edit/issues/1537)
- [#1536 — WP5: production hardening and release
  attestation](https://github.com/ctc-oss/omega-edit/issues/1536)

**Scope:** Deliver an elegant, storage-backed, non-destructive checkpoint
timeline for the VS Code data editor that works with Auto Save, massive files,
manual checkpoints, transform-created checkpoints, undo/redo, branching, and
crash recovery. Include the optimizer's non-mutating export phase. Do not
include online live-history compaction or automatic compaction policy in this
feature; those remain later optimizer phases.

---

## 1. Why this plan exists

The timeline prototype proves the interaction model:

- the user can reveal a slider from the editor title bar or Command Palette;
- checkpoint zero represents the content as opened;
- the cursor can rewind and fast-forward among checkpoints;
- forward history remains available until a content mutation creates a new
  branch;
- replay fingerprints detect incorrect reconstruction;
- Save and Auto Save do not rebase the native OmegaEdit session;
- the last-saved position is distinct from checkpoint position.

The prototype is not yet production-safe for OmegaEdit's massive-file use
case because it retains replayable `ParsedChangeRecord[]` payloads in memory.
It also duplicates change-log parsing and writing already present in
`packages/ai`, and the current import paths parse a complete JSON document into
memory before replay. This plan replaces the in-memory archive with atomic,
indexed, optimized interval logs stored on disk.

The production feature must never trade data integrity for convenience. When
history cannot be captured, verified, or replayed, navigation across the
affected boundary must be disabled with a precise explanation. It must never
guess, silently discard forward history, or show a cursor position that does
not match native session content.

## 2. Current implementation map

### 2.1 VS Code timeline prototype

Relevant files:

- `vscode-extension/src/constants.ts`
  - `OMEGA_EDIT_SHOW_CHECKPOINT_TIMELINE_COMMAND`
- `vscode-extension/src/extension.ts`
  - command registration
- `vscode-extension/src/hexEditorProvider.ts`
  - `CheckpointTimelineEntry`
  - `CheckpointTimelineState`
  - `showCheckpointTimeline`
  - `navigateToCheckpoint`
  - `postCheckpointTimeline`
  - `recordCheckpointTimelineEntry`
  - `truncateCheckpointTimelineFuture`
  - `createSessionCheckpoint`
  - save, rollback, transform, replace-all, undo, and redo integration
- `vscode-extension/src/webviewProtocol.ts`
  - host/webview timeline messages and validation
- `vscode-extension/webview-ui/src/components/CheckpointTimeline.svelte`
  - slider, previous/next buttons, markers, saved-position display
- `vscode-extension/webview-ui/src/App.svelte`
  - timeline state and message routing
- `vscode-extension/tests/suite/extension.integration.test.js`
  - repeated rewind/fast-forward, Save/Auto Save semantics, original-content
    recovery, and branching scenario

The in-memory field that must be eliminated is:

```ts
changes: ParsedChangeRecord[]
```

The production entry should retain metadata and a durable interval reference,
not payloads.

### 2.2 Existing change-log export/import implementations

There are currently two implementations with overlapping responsibilities:

- `packages/ai/src/types.ts`
  - public change-log document and entry types
- `packages/ai/src/service.ts`
  - normalization, validation, streaming file export, full-document import,
    preview, replay, rollback, and fingerprint checks
- `vscode-extension/src/hexEditorProvider.ts`
  - parallel normalization, validation, streaming file export,
    full-document import, preview, replay, rollback, and fingerprint checks

Both use `omega-edit.change-log` version 2. Local-file export is already
written incrementally and committed through a temporary file. Import still
uses `readFile` plus `JSON.parse`, which is not bounded for large histories.

### 2.3 Native history facts that constrain the design

The ground truth in `wiki/Change-Log-Optimizer.md` applies in full. The timeline
depends especially on these facts:

- history spans multiple native models;
- plain checkpoints create model boundaries without change records;
- transforms create checkpoint-backed model boundaries and a TRANSFORM
  change;
- change offsets are relative to the document state at application time;
- payloads can be file-backed and are deleted when their last owner dies;
- serial lookup assumes contiguous native serials;
- the C++ server serializes access to each session;
- Save writes computed content atomically but does not rebase native history.

No TypeScript code may attempt to optimize changes with adjacent-entry rules.
All semantic optimization belongs in the coordinate-aware core planner.

---

## 3. Product contract and invariants

These are release-blocking invariants.

### 3.1 Navigation

1. Timeline cursor zero is the immutable content snapshot from session open.
2. Cursor `N` is byte-identical to the content captured by checkpoint `N`.
3. Rewinding does not destroy the ability to fast-forward.
4. Repeating any back/forward cycle is idempotent.
5. Jumping across multiple checkpoints produces the same result as stepping
   through them one at a time.
6. A normal Save or Auto Save never removes checkpoint history.
7. A new content mutation while behind the tip removes only the future branch.
8. Undo, redo, inspection-only transforms, search, scrolling, selection, Save,
   and Auto Save are not branch-creating mutations.
9. A destructive legacy action such as explicit checkpoint rollback may
   truncate history, but it must update the manifest and UI atomically.

### 3.2 Content correctness

1. Every interval has a `before` and `after` fingerprint.
2. Fast-forward verifies the current content against `before` before applying
   any entry.
3. Replay completes only when the resulting content matches `after`.
4. A failed replay restores the exact pre-replay state or reports a fatal
   consistency failure if rollback itself fails.
5. TRANSFORM entries preserve plugin id, options, range, and size metadata.
6. Synthetic optimized entries never claim an original change serial.

### 3.3 Storage and memory

1. Replay payloads are not retained in the extension heap after interval
   commit.
2. Export and import memory remain bounded independently of total history
   size. One bounded entry/chunk plus parser metadata is the target.
3. Files are committed through write-temporary, flush, close, rename, and
   manifest-last ordering.
4. A committed manifest never references a missing, partial, or unverified
   interval.
5. Branch cleanup and session cleanup remove owned files but never user files.
6. Quotas prevent runaway checkpoint creation from exhausting storage.

### 3.4 Saved and dirty state

1. “Last saved” is independent of timeline cursor.
2. Saved identity is a content fingerprint, not only a change count.
3. Returning to the saved fingerprint makes the VS Code document clean.
4. Leaving the saved fingerprint makes it dirty.
5. Auto Save at any cursor updates the saved marker without rebasing or
   truncating the timeline.
6. After branching, a saved state that belonged to the deleted future is
   represented as off-branch until another Save occurs.

### 3.5 Failure behavior

1. If interval capture fails after a native checkpoint was created, that
   boundary is marked unavailable and rewind across it is disabled until a
   valid archive exists.
2. The UI must never enable forward navigation across a missing, corrupt,
   incompatible, or plugin-blocked interval.
3. Failed optimization falls back to the verified raw interval; it does not
   fail checkpoint creation merely because optimization failed.
4. Cancellation leaves no committed manifest entry and no temporary file.
5. Startup recovery removes or quarantines unreferenced temporary files.

---

## 4. Architectural decisions

### 4.1 Use interval logs, not cumulative checkpoint logs

Store one independently replayable change-log document for each transition:

```text
opened content -- interval 1 --> checkpoint 1
checkpoint 1   -- interval 2 --> checkpoint 2
checkpoint 2   -- interval 3 --> checkpoint 3
```

A cumulative log per checkpoint would consume O(checkpoints × history)
storage and repeatedly rewrite the entire session. Interval logs keep storage
O(total archived history) and make stepping forward naturally incremental.

### 4.2 Retain change-log version 2 for interval files

An interval file remains a standard `omega-edit.change-log` version 2
document so existing tools can inspect and replay it. Interpret fields as:

- `before`: fingerprint of the previous checkpoint, or opened content for
  interval 1;
- `after`: fingerprint of the checkpoint this interval creates;
- `changeCount`: emitted entry count;
- `sourceChangeCount`: raw changes consumed by optimization for this interval;
- `unavailableChangeCount`: must be zero for a navigable interval;
- `changes`: replay-time entries, with synthetic serials omitted.

Raw interval exports should also omit serials. Native serials are session-local
provenance and are not required for replay. Omitting them avoids pretending
that interval-relative files retain global serial identity.

The timeline manifest has its own internal version. Do not add timeline-only
fields to the public change-log document unless they are generally useful.

### 4.3 Share one codec

Move format types, normalization, validation, serialization, streaming write,
and streaming read into a shared module consumed by both AI tooling and the
VS Code extension. Put the environment-neutral codec in
`packages/client/src/changeLog/` because both callers already depend on
`@omega-edit/client`; put Node filesystem adapters in
`packages/client/src/changeLog/node/` so importing pure types/normalizers does
not pull Node built-ins into browser bundles.

The codec API should separate format logic from filesystem logic:

```ts
interface ChangeLogHeader { /* v2 metadata except changes */ }

interface ChangeLogSink {
  writeHeader(header: ChangeLogHeader): Promise<void>
  writeEntry(entry: ChangeLogEntry): Promise<void>
  commit(): Promise<void>
  abort(error?: unknown): Promise<void>
}

interface ChangeLogSource {
  readHeader(): Promise<ChangeLogHeader>
  entries(): AsyncIterable<ChangeLogEntry>
}
```

Provide a Node local-file implementation with atomic commit. Keep pure
normalizers usable in browser-safe or test contexts. Do not make the generated
protobuf layer depend on Node streams.

### 4.4 Stream import as well as export

The current version 2 JSON array remains supported. Implement an incremental
parser that:

1. reads and validates the document header before yielding entries;
2. yields one normalized entry at a time;
3. enforces maximum nesting, token length, entry count, and string length;
4. rejects trailing data, duplicate critical header fields, and malformed
   Unicode;
5. computes file checksum while reading;
6. supports cancellation and closes descriptors on every exit path.

Do not replay before the `before` fingerprint and required plugin set are
validated. Replay can proceed incrementally after preflight, protected by the
existing restore-to-change-count rollback strategy.

### 4.5 Use only optimizer Phase 1

Implement the non-mutating coordinate-aware planner and optimized export.
Defer candidate installation, serial renumbering, live compaction events, and
automatic policy. Those later features may consume the same planner but are
not prerequisites for the timeline.

### 4.6 Raw capture is the reliability fallback

Checkpoint creation must not depend on optimizer success:

1. capture a complete raw interval to a temporary file;
2. validate raw header, entry count, and fingerprints;
3. attempt optimized export to a second temporary file;
4. validate optimized replay equivalence;
5. retain the smaller verified file;
6. atomically rename the winner;
7. remove the loser;
8. commit the manifest entry last.

The core planner should guarantee that optimized operation count is no larger
than raw operation count by falling back per span. Actual JSON byte size is a
storage-layer decision based on the completed temporary files.

### 4.7 Storage belongs to the extension, not the edited file's directory

Use VS Code workspace storage when available and global extension storage as
the fallback. Do not place timeline files beside the user's document and do
not reuse native checkpoint directories whose lifecycle is owned by the core.

Extend the provider's `ExtensionContext` dependency to include the required
storage URIs. The provider owns a storage manager; individual editor sessions
own session directories through that manager.

---

## 5. On-disk format

### 5.1 Layout

```text
<storage-root>/checkpoint-history/
  index.json
  <session-key>/
    manifest.json
    intervals/
      00000001.json
      00000002.json
    temp/
      <operation-id>.raw.tmp
      <operation-id>.optimized.tmp
```

`session-key` is 128 random bits from `crypto.randomBytes`, encoded as 22
unpadded base64url characters. Operation ids use the same construction. Never
derive a directory name from a user path. Store only SHA-256 of the normalized
document URI plus an optional display basename; the full URI is unnecessary
because timelines are not restored after close.

`index.json` has its own versioned schema:

```ts
interface CheckpointTimelineIndexV1 {
  format: 'omega-edit.checkpoint-timeline-index'
  version: 1
  updatedAt: string
  sessions: Record<string, {
    instanceId: string
    lastHeartbeatAt: string
    state: 'active' | 'pendingDelete'
    byteLength: string
    reservedBytes: string
  }>
}
```

All persisted file references are relative basenames validated against the
expected generated-name grammar. Before open, rename, or deletion, resolve the
candidate and prove it remains below the canonical storage root. Use `lstat`;
never follow symlinks or junctions anywhere below `checkpoint-history`.

### 5.2 Manifest schema

Initial internal schema:

```ts
interface CheckpointTimelineManifestV1 {
  format: 'omega-edit.checkpoint-timeline'
  version: 1
  sessionKey: string
  document: {
    uriSha256: string
    displayName?: string
  }
  openedAt: string
  updatedAt: string
  original: {
    fingerprint: ChangeLogFingerprint
  }
  saved: {
    fingerprint: ChangeLogFingerprint
    checkpoint?: number
    offBranch: boolean
  }
  cursor: number
  tip: number
  nextGeneration: number
  intervals: CheckpointIntervalManifestEntryV1[]
}

interface CheckpointIntervalManifestEntryV1 {
  checkpoint: number
  generation: number
  before: ChangeLogFingerprint
  after: ChangeLogFingerprint
  sourceChangeCount: string
  createdAt: string
  boundaryKind: 'plain' | 'transform'
  transformPluginIds: string[]
  state: 'ready' | 'unavailable'
  archive?: {
    file: string
    byteLength: string
    sha256: string
    emittedChangeCount: string
    optimized: boolean
  }
  error?: {
    code: string
    message: string
  }
}
```

Rules:

- `intervals` are ordered and checkpoint numbers are contiguous from 1.
- `interval[N].before` equals `interval[N-1].after`.
- `cursor` is between zero and `tip`.
- a `ready` entry has `archive`, has no `error`, and references an existing
  verified regular file;
- an `unavailable` entry has `error`, has no `archive`, and never enables
  traversal across that boundary in either direction;
- `boundaryKind` records whether replay of the interval is itself expected to
  create the timeline boundary; a plain boundary requires an explicit native
  checkpoint after replay, while a transform boundary must be created by the
  final checkpoint-producing transform;
- `transformPluginIds` is sorted, unique, and complete for preflight;
- `generation` prevents stale async work from committing after a branch;
- counts and byte lengths are decimal strings where int64 range matters;
- unknown future fields are ignored, but unknown manifest versions are not.

### 5.3 Atomic manifest commit

Commit with:

1. serialize canonical JSON to `manifest.<operation-id>.tmp`;
2. flush file contents;
3. close;
4. rename over `manifest.json` atomically;
5. sync the parent directory where supported.

If directory sync is unavailable through Node on a platform, document the
weaker crash guarantee and cover recovery with tests. Never modify the live
manifest in place.

`index.json` uses the same temp/flush/close/rename/directory-sync sequence.
Every index read-modify-write, quota reservation, and cleanup decision is
serialized across extension processes by exclusive creation of
`checkpoint-history/.lock` (`open` with `wx`, mode `0600`). The lock contains
an instance UUID, random lock token, and acquisition timestamp. Metadata work
under the lock must finish within two seconds and must never include export,
hashing, replay, or recursive deletion. A lock older than two minutes is
recovered only by atomically renaming it to a unique `.stale-lock.<token>`;
exactly one contender can win that rename. Release verifies the token before
unlinking. Contenders retry with bounded jitter for five seconds, then fail
the operation safely with `TIMELINE_STORAGE_BUSY`.

Long writers reserve quota in 16 MiB increments. Before writing bytes outside
the persisted `reservedBytes`, acquire the metadata lock, reconcile the
session's current file sizes, extend the reservation without exceeding either
quota, and commit the index. This makes total quota enforcement work across
multiple VS Code windows without holding a lock during I/O. Release unused
reservation in the next metadata transaction. Startup discards reservations
only for expired owners and always recomputes actual byte usage first.

### 5.4 Quotas and retention policy

Add settings with fixed production defaults:

```jsonc
"omegaEdit.checkpointHistory.maxBytesPerSession": 1073741824,
"omegaEdit.checkpointHistory.maxBytesTotal": 5368709120,
"omegaEdit.checkpointHistory.maxCheckpoints": 1000,
"omegaEdit.checkpointHistory.staleRetentionDays": 7
```

`maxBytesPerSession` and `maxBytesTotal` count every owned regular file,
including manifests, intervals, temporary files, quarantine metadata, and
pending-delete files. The total applies per VS Code storage root. Native core
checkpoint files and explicitly exported user logs are not owned by this
manager and are not counted. Byte settings are decimal integer bytes, must be
at least 1 MiB, and must not exceed JavaScript's safe integer range;
`maxBytesTotal` must be at least `maxBytesPerSession`. `maxCheckpoints` is an
integer in `[1, 1000000]`. `staleRetentionDays` is an integer in `[1, 365]`.
Invalid configuration disables new capture with a settings error; it never
falls back to unlimited storage.

Quota is enforced on actual bytes, not only estimates:

1. Reconcile the index with file metadata before capture and establish an
   operation reservation under the storage-manager lock.
2. Stream the raw candidate through a counting writer. Abort and remove the
   temp immediately if either byte quota would be exceeded.
3. Once raw is complete and verified, its exact size is the committed-size
   reservation for the interval.
4. Attempt optimization only when a second temporary reservation is
   available. Cap that candidate at the raw byte length; if it reaches the
   raw length, cancel it, remove it, and keep raw because it cannot win.
5. Replace the two temporary reservations with the winner's exact committed
   size in the same critical section that publishes the manifest.
6. Release every reservation on cancellation, failure, stale generation, or
   process cleanup. Startup recomputes usage from disk, so leaked in-memory
   reservations cannot become persistent accounting errors.

The optional optimized attempt may be skipped for temporary-quota pressure;
the verified raw checkpoint still succeeds. If the raw candidate itself does
not fit:

- leave the native session and existing timeline intact;
- report the required and available sizes;
- offer documented choices: raise quota, remove older checkpoints, export a
  permanent log, or cancel;
- never silently prune history.

Disk-full errors follow the same behavior.

Never silently prune an active timeline to make room. Branch deletion may
free already-unreferenced future intervals. Startup cleanup may remove only
expired, non-active session directories under §7.8. If total usage remains
over quota afterward, existing timelines remain readable but new captures are
disabled until the user raises the quota or closes/removes history.

---

## 6. Resolved optimizer contract for timeline integration

These decisions are mirrored in `wiki/Change-Log-Optimizer.md` and are prerequisites
for coding the planner. A change to them requires updating both documents and
the WP0 regression matrix in the same review.

### 6.1 Add ranged export

Whole-session optimized export is insufficient. Add a range to export options:

```c
typedef struct {
    uint32_t flags;
    int64_t first_change_serial; /* 0 = first active change */
    int64_t last_change_serial;  /* 0 = current active tip, inclusive */
    int64_t max_span_bytes;
    int64_t max_entries;
    int prefer_overwrite_form;
} omega_changelog_export_options_t;
```

These names and semantics are the v1 contract:

- bounds refer to active serials at export start;
- invalid, undone, sparse, or reversed bounds fail before callbacks;
- the planner reconstructs the range's input state without mutating the live
  session;
- offsets emitted are valid when replay begins from that input state;
- model and TRANSFORM barriers inside the range remain barriers;
- plain checkpoint model boundaries are retained as planner boundaries even
  though they emit no entry;
- `max_entries` overflow fails atomically rather than emitting a partial log.
- zero-change intervals are emitted by the storage layer without calling the
  core range API.

Input reconstruction is fixed as follows: when the range starts at a leading
TRANSFORM, seed from the prior model tip and emit that transform; otherwise
seed from the containing model's checkpoint backing and replay only its
non-transform prefix through `first_change_serial - 1`. A plain checkpoint
inside the range emits nothing and re-anchors the planner. A TRANSFORM emits
exactly once and re-anchors following edits to its output checkpoint. The
worked examples and edge tests are normative in `wiki/Change-Log-Optimizer.md` §4.4.

The server request mirrors the range with optional int64 fields. The timeline
requests exactly the raw change range between adjacent checkpoint fingerprints.

### 6.2 Define the piece-table data structure

Use an implicit AVL rope with subtree byte length, subtree node count, and
height. Each node is a base slice or payload slice. Split, join, remove, and
splice are worst-case O(log n); adjacent contiguous slices from the same
source are coalesced. All length arithmetic is checked int64 arithmetic.
A vector-backed piece table and randomized balancing are out of scope because
they do not provide deterministic worst-case behavior.

Tests must include adversarial alternating edits that would force O(n²)
behavior in a vector implementation. The 100k-change performance gate applies
to that adversarial pattern as well as sequential typing.

### 6.3 Define `max_span_bytes`

`max_span_bytes` is the sum of unique span-input base bytes touched plus all
forward INSERT/OVERWRITE payload bytes accepted by a planning subspan. The
base component is an interval union; the payload component is conservative
and remains counted even if later deleted. Split immediately before the next
change would exceed the limit. A single oversized change becomes a one-change
raw subspan. `0` means 64 MiB; negative values are invalid.

### 6.4 Bound streamed entry size

A merged plan entry can contain a payload much larger than a safe gRPC
message. The core exposes a pull-based payload source rather than a contiguous
payload allocation. The server copies it into frames whose `data` is at most
262144 bytes:

```protobuf
message ChangeLogEntryHeader {
  string entry_index_decimal = 1;
  /* kind plus decimal-string offsets/lengths and transform data */
}
message ChangeLogPayloadChunk {
  string entry_index_decimal = 1;
  string chunk_offset_decimal = 2;
  bytes data = 3;
  bool final_chunk = 4;
}
```

The server must cap `data` per message, preserve backpressure, honor
cancellation, and never leave a half-entry committed by a consumer.
Entry indexes and chunk offsets are contiguous. Exactly one final chunk ends
at the declared payload length; zero-length payloads have no chunks. A final
stream frame carries counts and SHA-256 over logical payload bytes in entry
order, independent of chunk boundaries. The client validates all framing
before atomically committing its temp output.

Every unbounded serial, offset, length, and count in the RPC is a canonical
unsigned decimal string, not protobuf int64, because the generated TypeScript
client currently maps int64 to unsafe JavaScript numbers. Reject signs,
leading zeroes, whitespace, exponents, empty strings, and values above signed
int64 max. The exact messages are normative in `wiki/Change-Log-Optimizer.md` §8.1.

Transform entry headers cap the UTF-8 plugin id at 4096 bytes and UTF-8
options JSON at 1 MiB. Oversize metadata fails with `RESOURCE_EXHAUSTED` and
is never truncated. Together with bounded decimal text, this keeps every
header below the 4 MiB default rather than solving payload framing while
leaving metadata unbounded.

The server defaults to a 1,000,000-entry and 1 GiB spool cap, configurable by
operator flags/environment. A request may lower but never raise either cap;
the counting spool writer rejects the frame that would cross it with
`RESOURCE_EXHAUSTED`. The timeline lowers the request cap to the smaller of
its remaining per-session and total quota headroom; the client counting writer
still enforces actual encoded JSON bytes, which can exceed spool bytes.

### 6.5 Correct the size guarantee

The core can cheaply guarantee:

- emitted operation count is no greater than raw operation count; and
- content is identical.

It cannot guarantee smaller pretty-printed JSON without observing actual
encoding. The file storage consumer compares verified raw and optimized
temporary file sizes and retains optimized only when it is strictly smaller;
ties retain raw. This is the optimizer exit criterion.

### 6.6 Clarify stream locking

The server writes a complete length-delimited frame stream to an exclusive
`0600` server-managed temporary spool while holding the per-session core lock.
It flushes and closes the spool, releases the lock, then streams the immutable
spool to the client. A scope guard removes it on every terminal path. No
borrowed core pointer survives lock release, and a slow client never blocks
session edits. Cancellation is checked during planning, payload copying,
spool reads, and network writes.

### 6.7 Fix document provenance wording

The optimizer status now states that the consolidated document supersedes the
two earlier proposals formerly stored as separate historical drafts. It does
not claim to supersede itself.

---

## 7. Lifecycle algorithms

### 7.1 Session open

1. Create a native editor session and viewport normally.
2. Compute the opened-content fingerprint.
3. Allocate a random timeline session key and directory.
4. Create a manifest with cursor/tip zero and saved fingerprint equal to the
   opened fingerprint.
5. Commit the empty manifest atomically.
6. Publish timeline state to the webview.

If storage initialization fails, open the editor without destructive timeline
navigation and show a persistent, actionable degraded-mode indicator. Basic
editing must remain available.

### 7.2 Manual checkpoint creation

1. Serialize against other session mutations.
2. Determine the previous archived change boundary.
3. Query current native change count and fingerprint.
4. If content/change range is identical to the current tip, report “No changes
   since checkpoint N”; Save/Auto Save dirty state is irrelevant.
5. Capture the raw interval to a temporary file.
6. Validate completeness and `before`/`after` fingerprints.
7. Create the native checkpoint.
8. Attempt optimized ranged export; validate it.
9. Select the smaller valid file, atomically install it, and remove the loser.
10. Commit the manifest entry last.
11. Reset extension-local undo grouping as required without changing saved
    fingerprint state.
12. Publish one timeline update.

If native checkpoint creation fails, delete interval temporaries. If archive
commit fails after native checkpoint creation, mark the boundary unavailable
and disable rewind across it. Provide a retry action that reconstructs the
archive while native history is still available.

### 7.3 Transform-created checkpoint

Transforms can create a checkpoint before the extension can pre-capture its
interval.

1. Record pre-transform native change count and fingerprint.
2. Apply the transform.
3. Wait for session synchronization.
4. Confirm checkpoint count advanced as expected.
5. Capture the interval including the TRANSFORM entry.
6. Verify plugin metadata and after fingerprint.
7. Optimize only across legal spans; TRANSFORM remains exact.
8. Commit interval then manifest.

On capture failure, retain an unavailable manifest boundary and block
destructive navigation across it. Never pretend the transform can be recreated
without its verified descriptor and required plugin.

### 7.4 Rewind

Before changing the native stack:

1. Validate every interval needed to return to the current tip:
   - manifest entry is ready;
   - file exists and length matches;
   - checksum matches;
   - header fingerprints chain correctly;
   - required transform plugins are available.
2. If validation fails, stop before native mutation.
3. Use native checkpoint destruction/restoration to reach the requested
   earlier snapshot.
4. Verify resulting fingerprint equals the target checkpoint.
5. Commit cursor update to the manifest.
6. Publish viewport, dirty/saved, and timeline state.

This preflight is what makes destructive native rewind safe: forward material
is proven durable before native checkpoint files are removed.

### 7.5 Fast-forward

For each interval from cursor + 1 through target:

1. Revalidate interval checksum if it has not been validated during this
   process lifetime.
2. Verify current fingerprint equals interval `before`.
3. Start rollback protection at current native change count/checkpoint count.
4. Stream and normalize entries.
5. Preflight required plugins before applying the first entry.
6. Replay plain entries in transactions and transforms through their native
   plugin path.
7. Create a plain native checkpoint when replay itself did not create the
   expected checkpoint.
8. Verify fingerprint equals interval `after`.
9. Commit the cursor after each successful interval so crash recovery reflects
   the native state reached.

On failure, restore the pre-interval state. Do not continue to later
intervals. Report the failing checkpoint, entry index, rollback result, and
whether the interval remains retryable.

### 7.6 Branch creation

A branch is created only immediately before a successful content mutation
while `cursor < tip`.

1. Increment manifest generation.
2. Remove future entries from a candidate manifest in memory.
3. Commit the shortened manifest atomically.
4. Apply the mutation.
5. If mutation fails/no-ops, restore the previous manifest when safe; ideally
   defer manifest truncation until the mutation reports a positive serial.
6. Delete unreferenced future interval files asynchronously after manifest
   commit.

Inspection-only transforms, Save, Auto Save, navigation, undo with no active
transaction, search, and UI operations never create a branch.

Async optimization tasks carry the generation they started under. They must
discard their result if manifest generation changed before commit.

### 7.7 Save and Auto Save

1. Save computed content through the existing atomic native Save path.
2. Compute/obtain the saved content fingerprint.
3. Update manifest saved fingerprint.
4. Resolve `saved.checkpoint` only when a manifest checkpoint has the same
   fingerprint; change count alone is insufficient after branching.
5. Set `offBranch` when no current timeline node matches.
6. Reconcile VS Code dirty state against saved fingerprint.
7. Preserve interval files, tip, and cursor.

Auto Save may occur at any cursor. Saving a rewound state does not delete the
future. Fast-forwarding away from it makes the document dirty again. Returning
to it makes the document clean.

### 7.8 Close, crash, and stale cleanup

Timeline storage is ephemeral because the matching native checkpoint stack is
not recoverable after session destruction. It is not a substitute for an
explicit user export.

Each index entry carries an extension-instance UUID and `lastHeartbeatAt`.
The owning instance refreshes it at most once per minute while the editor is
open. A PID alone is never treated as proof of ownership because PIDs are
reused. Cleanup must not touch a directory with a non-expired heartbeat from
another extension instance.

Normal close is exact:

1. stop capture/navigation and await or cancel owned operations;
2. close interval readers/writers and release reservations;
3. dispose the native session;
4. remove the complete timeline session directory;
5. remove its index entry last;
6. if deletion fails, mark the entry `pendingDelete`, report a warning in the
   output channel, and retry on next activation.

Explicitly exported user logs are outside the storage root and are never
deleted by this lifecycle.

After a crash, do not offer timeline restoration: interval logs alone cannot
recreate the native checkpoint stack required for safe rewind. Keep the
orphan directory only for the configured seven-day stale window to avoid
racing another VS Code window and to permit diagnostics. On activation and
once per 24 hours:

- parse `index.json` and manifests defensively with size/depth limits;
- recompute byte usage from filesystem metadata rather than trusting index
  counters;
- retry `pendingDelete` entries when their heartbeat is expired;
- remove expired session directories whose `lastHeartbeatAt` is older than
  `staleRetentionDays`;
- within a non-active expired directory, remove `.tmp` and orphan interval
  files before removing the directory;
- quarantine an invalid manifest by renaming only that known session
  directory to `<session-key>.quarantine.<timestamp>`; never recursively
  delete a path obtained from manifest content;
- count quarantine bytes against total quota and expire quarantines on the
  same seven-day policy;
- report scanned, removed, quarantined, failed, and reclaimed-byte counts in
  the debug log.

Cleanup follows the same root-containment and no-symlink traversal checks as
normal deletion. When ownership or containment is ambiguous, leave data in
place, count it against quota, and report the exact path and reason.

---

## 8. Work packages and pull-request sequence

Keep these independently reviewable. A stacked branch is acceptable, but each
package should be a coherent commit/PR with green tests.

### WP0 — Specification hardening

**Deliverables:**

- [x] Apply §6 amendments to `wiki/Change-Log-Optimizer.md`.
- [x] Resolve ranged-export reconstruction semantics with concrete model
      examples for plain and transform checkpoints.
- [x] Define payload chunk size and cancellation behavior.
- [x] Define quota defaults and clean-close retention policy.
- [x] Add this tracker and link it from `SHORTCOMINGS.md` items for streaming
      import and checkpoint limits.

**Exit gate:** No open correctness decision blocks implementation. Remaining
choices are tuning values, not semantics.

### WP1 — Shared change-log codec and streaming import

**Likely files:**

- `packages/client/src/changeLog/` (new environment-neutral codec)
- `packages/client/src/changeLog/node/` (atomic Node file adapter)
- `packages/client/src/index.ts`
- `packages/client/src/tests/` or existing Vitest suite
- `packages/ai/src/types.ts`
- `packages/ai/src/service.ts`
- `vscode-extension/src/hexEditorProvider.ts`

**Tasks:**

- [x] Move shared v2 types/normalizers without breaking public AI types.
- [x] Implement header-first streaming reader and atomic streaming writer.
- [x] Preserve decimal-string int64 safety.
- [x] Support entries with omitted synthetic serials.
- [x] Migrate AI export/import to shared codec.
- [x] Migrate extension export/import to shared codec.
- [x] Delete duplicated validators only after parity tests pass.
- [x] Add cancellation, malformed input, token-limit, checksum, and
      disk-exhaustion cleanup tests (deterministic output-limit injection here;
      real ENOSPC/tmpfs coverage remains in WP5).

**Exit gate:** Existing v2 fixtures produce equivalent results through AI and
extension surfaces; importing a large log has bounded resident memory.

**Implementation evidence:** `packages/client/tests/specs/changeLogCodec.spec.ts`
pins inline/stream parity, nested duplicate rejection, hostile UTF-8/int64 and
resource limits, transform descriptors, cancellation, atomic cleanup,
no-clobber behavior, checksum, file replacement detection, and a 20,000-entry
bounded-buffer scan. Run it independently of native server packaging with
`yarn workspace @omega-edit/client test:codec`. AI dry-run tests exercise the
same shared types and file preflight; VS Code extension unit/integration tests
exercise the migrated provider surface.

### WP2 — Core planner and optimized ranged export

**Likely files:**

- `core/src/include/omega_edit/changelog.h` (new)
- `core/src/lib/changelog.cpp` (new)
- `core/src/lib/changelog_planner.cpp` (optional split)
- `core/src/lib/impl_/` internal planner headers
- `core/src/tests/changelog_test_support.hpp` (new)
- `core/src/tests/changelog_tests.cpp` (new)
- `proto/omega_edit/v1/omega_edit.proto`
- `server/cpp/src/editor_service.h`
- `server/cpp/src/editor_service.cpp`
- generated TypeScript protobuf bindings
- `packages/client/src/session.ts`

**Tasks:**

- [x] Build all-model serial enumerator with explicit boundaries.
- [x] Implement balanced coordinate-aware piece sequence.
- [x] Implement deterministic range reconstruction.
- [x] Emit replay-coordinate DELETE/INSERT/OVERWRITE/REPLACE operations.
- [x] Preserve TRANSFORM exactly and omit synthetic serials.
- [x] Add per-span raw fallback.
- [x] Add chunked server-streaming RPC with cancellation.
- [x] Add client async iterator with bounded buffering.
- [x] Implement PR-tier differential fuzzing and failure reproduction files.

**Exit gate:** Raw and optimized ranged exports replay to identical
fingerprints; planner is deterministic, idempotent, non-mutating, bounded, and
within performance gates.

**Implementation evidence:** `core/src/tests/changelog_tests.cpp` pins
same-offset insertion order, identity elimination, delete/overwrite folding,
prefix/suffix trimming, overwrite extension at EOF, checkpoint range
reconstruction, transform barriers, summary content sources, span splitting,
atomic entry limits, determinism, and replay equality. The optimizer is also
wired into `core/src/tests/differential_fuzz_tests.cpp`, whose existing JSONL
serializer, replay mode, failure dump, and shrinker now cover optimized export.
The PR tier passes 12 fixed scripts × 96 mixed operations, while the focused
planner matrix passes 11,765 assertions including 64 deterministic scripts ×
120 edits. `ExportChangeLog` spools complete length-delimited frames under the
session lock, releases the lock before network writes, caps payload frames at
256 KiB, and deletes its `0600` spool on every exit. The client iterator pauses
at four queued frames, resumes at two, validates every decimal, frame boundary,
count, and SHA-256, and can atomically stream the result directly to v2 JSON.

### WP3 — Timeline storage manager

**Likely files:**

- `vscode-extension/src/checkpointTimelineStorage.ts` (new)
- `vscode-extension/src/changeLogReplay.ts` (optional extraction)
- `vscode-extension/src/hexEditorProvider.ts`
- `vscode-extension/src/api.ts`
- `vscode-extension/package.json` settings

**Tasks:**

- [x] Implement storage root, session keys, manifest schema, atomic commits.
- [x] Implement raw and optimized interval capture.
- [x] Replace `ParsedChangeRecord[]` with interval metadata/reference.
- [x] Implement checksums, file-length verification, and plugin metadata.
- [x] Implement quota accounting and actionable failures.
- [x] Implement manifest generation and stale async result rejection.
- [x] Implement clean-close and startup cleanup.
- [x] Add test-only fault injection at every commit boundary.

**Exit gate:** Heap use does not grow with archived payload bytes; every ready
manifest entry is independently replayable and verified.

**Implementation evidence:** `checkpointTimelineStorage.ts` owns a random
128-bit session directory beneath the VS Code storage root, a versioned
manifest/index, token-verified cross-process locking with stale-lock rename,
atomic fsync/rename commits, SHA-256 and file-length preflight, sorted plugin
metadata, generation rejection, 16 MiB incremental reservations, configured
per-session/total quotas, heartbeats, pending-delete recovery, and quarantine
of expired invalid manifests. Raw and optimized ranged RPC exports are written
as separate candidates; only the strictly smaller verified candidate is
installed, and optimization failure retains raw. The provider now keeps only
interval metadata and streams archive entries from disk during replay.
`checkpointTimelineStorage.test.js` covers candidate selection, raw fallback,
quota overflow, every storage commit family, stale generation and lock races,
corruption, symlink replacement, reservation extension, pending-delete retry,
and hostile-manifest quarantine. The extension unit suite passes 24 tests and
the native-server VS Code integration suite passes 23 tests (one observation
demo intentionally pending), including repeated Save/checkpoint rewind and
fast-forward cycles.

### WP4 — Timeline navigation integration

**Tasks:**

- [x] Rewind preflight proves all required forward intervals durable.
- [x] Fast-forward streams intervals and commits cursor incrementally.
- [x] Branch truncation occurs only after a positive mutation result.
- [x] Manual and transform checkpoint capture use the storage manager.
- [x] Checkpointed replace-all is archived and replayed.
- [x] Legacy rollback/restore actions reconcile manifest state.
- [x] Save/Auto Save use fingerprint-based saved/dirty state.
- [x] Undo/redo never destroys archived forward history accidentally.
- [x] UI exposes unavailable boundaries and useful error details.
- [x] Timeline strings move into webview localization tables.

**Exit gate:** All product invariants in §3 pass through the real VS Code
extension and native server.

**Implementation evidence:** `hexEditorProvider.ts` preflights every recovery
interval before destructive rewind, rolls failed multi-interval navigation
back to its starting cursor, commits forward cursor movement one verified
interval at a time, and branches only after a positive mutation result.
Checkpointed replace-all is stored as a bounded semantic replay primitive so
it remains replayable without materializing all matches in extension memory.
Saved and current content are compared by SHA-256 fingerprint, including Save
before checkpoint and off-branch saved states. Corrupt archives are persisted
as unavailable boundaries and disable unsafe navigation. The localized Svelte
timeline exposes saved, unavailable, rewind, and fast-forward states with
keyboard and screen-reader labels. The extension suite passes 25 unit tests;
the real VS Code/native-server suite passes 23 tests (one observation demo
intentionally pending), including repeated rewind/forward, Original-to-tip,
Auto-Save-equivalent Save-before-checkpoint, no-op branching, corruption
preflight, and checkpointed replace-all replay.

### WP5 — Production hardening and attestation

**Tasks:**

- [x] Cross-platform integration suite with Linux, Windows, and macOS native
      servers.
- [x] ASan+UBSan planner/fuzz suite and TSan server-streaming cancellation
      coverage.
- [ ] Disk-full, read-only directory, corrupt log, missing plugin, crash,
      cancellation, and rollback-failure tests.
- [x] 100k/1M-entry memory and performance benchmarks.
- [ ] 24-hour optimizer soak with committed regression corpus.
- [ ] Accessibility review: keyboard, focus, screen-reader value text, high
      contrast, reduced motion.
- [ ] Documentation and screenshots in `vscode-extension/README.md`.
- [ ] Manual three-way comparison: raw replay, optimized replay, timeline
      replay all byte-identical.

**Exit gate:** Definition of Done in §11 is fully checked with linked evidence.

**Implementation status:** Cross-platform VS Code/native integration now
includes macOS alongside Linux and Windows. The dedicated hardening workflow
adds cross-platform differential fuzz, ASan+UBSan, TSan core and instrumented
server cancellation/replay, a hard 100k planner benchmark, a bounded-RSS
1M-entry codec benchmark, and five seed-disjoint scheduled soak shards.
`CHECKPOINT-TIMELINE-ATTESTATION.md` is the evidence ledger and deliberately
keeps cross-platform, 24-hour, and manual assistive-technology results pending
until their jobs or reviews actually run.

### Deferred — Online history compaction

Do not silently fold `wiki/Change-Log-Optimizer.md` Phases 2–4 into these work
packages. Track candidate building, live compaction, compaction events, and
automatic policy in separate issues after optimized export is stable. Timeline
archives must respond to a future compaction event by invalidating serial-based
capture state, but no current interval should rely on native serial identity
after it is committed.

---

## 9. Test matrix

### 9.1 Functional scenarios

- [ ] zero checkpoints; timeline opens disabled at Original
- [ ] manual checkpoint after an unsaved edit
- [ ] manual checkpoint immediately after Save
- [ ] manual checkpoint immediately after Auto Save
- [ ] multiple Auto Saves between checkpoints
- [ ] Save while rewound; future retained
- [ ] fast-forward away from saved point becomes dirty
- [ ] return to saved fingerprint becomes clean
- [ ] three or more repeated rewind/forward cycles
- [ ] jump Original → tip and tip → Original
- [ ] branch at every checkpoint, including Original
- [ ] no-op attempted edit does not branch
- [ ] undo/redo while rewound does not truncate future
- [ ] transform checkpoint with options and file-backed payload
- [ ] ranged export starts/ends before, on, and after plain and transform
      model boundaries using the §6.1 worked examples
- [ ] checkpointed replace-all
- [ ] empty-file and delete-entire-file intervals
- [ ] same-offset insert ordering
- [ ] interval whose net result is identity
- [ ] missing required transform plugin disables only affected direction
- [ ] multiple editors/sessions never share storage paths or state

### 9.2 Storage fault injection

Inject failure after each operation:

- [ ] temporary raw file creation
- [ ] raw header write
- [ ] raw entry write
- [ ] raw flush/close
- [ ] optimized file creation/write
- [ ] optimized validation
- [ ] winner rename
- [ ] loser removal
- [ ] manifest temporary write
- [ ] manifest rename
- [ ] branch manifest commit
- [ ] orphan cleanup
- [ ] quota reservation
- [ ] cross-process index lock acquisition/release
- [ ] stale-lock atomic rename race with two contenders
- [ ] index commit and reservation extension at every 16 MiB boundary
- [ ] clean-close directory deletion and `pendingDelete` retry
- [ ] heartbeat refresh and expired-owner cleanup

For every failure assert:

- current content and native model remain valid;
- cursor/tip match reachable native state;
- no manifest references partial data;
- retry either succeeds or produces the same deterministic error;
- temporary file leakage is bounded and startup cleanup removes it.

Quota boundary matrix:

- [ ] raw file is one byte below, exactly at, and one byte above remaining
      per-session quota
- [ ] same matrix for total quota with two extension processes reserving
      concurrently
- [ ] raw fits but a second optimizer reservation does not: checkpoint commits
      raw successfully
- [ ] optimized encoded output reaches raw byte length: cancel optimized and
      retain raw
- [ ] configured limits at minimum, maximum, unsafe integer, total below
      per-session, and malformed setting values
- [ ] expired reservations are recovered; a live heartbeat's reservation is
      never stolen

### 9.3 Corruption and hostile input

- [ ] truncated JSON at every token boundary
- [ ] checksum mismatch
- [ ] valid checksum but wrong `before` fingerprint
- [ ] correct `before`, wrong `after`
- [ ] duplicate or missing checkpoint numbers
- [ ] `ready` entry without archive, `ready` with error, `unavailable` with
      archive, and `unavailable` without error
- [ ] path traversal in manifest interval filename
- [ ] symlink/reparse-point escape from storage root
- [ ] oversized strings, nesting, entry count, and payload chunks
- [ ] unsafe int64 numbers and malformed decimal strings
- [ ] unknown format/version
- [ ] transform descriptor mismatch
- [ ] corrupt/missing/duplicate payload frame and incorrect final
      count/payload digest
- [ ] server spool cap and entry cap at one below, exact, and one above limit

### 9.4 Scale and performance

Hard initial gates, adjustable only with recorded evidence:

| Scenario | Gate |
| --- | --- |
| 100k typing edits, optimized ranged export | < 1 second core planning |
| 100k typing edits, interval file commit | < 2 seconds excluding disk fsync variance |
| 1M-entry raw import | bounded RSS; no full-document allocation |
| forward one typical checkpoint | UI remains responsive; progress/cancel available after 250 ms |
| timeline with 1,000 checkpoints | panel interaction < 16 ms per local UI update |
| disabled/hidden timeline edit overhead | no measurable regression beyond one predictable branch |

Record benchmark hardware, filesystem, compiler, build type, raw/optimized
sizes, peak RSS, and p50/p95/p99 duration.

### 9.5 Platform matrix

- Linux: ext4 plus CI workspace filesystem
- macOS: APFS, case-sensitive and default case-insensitive where available
- Windows: NTFS, open-file deletion semantics, long paths, antivirus-friendly
  retry behavior
- WSL is useful developer coverage but does not replace native Windows/Linux
  integration runs

---

## 10. Observability and diagnostics

Add debug-level structured events without including file content:

- timeline session created/destroyed;
- checkpoint capture start/finish/failure;
- raw/optimized counts and byte sizes;
- optimizer duration and fallback reason;
- replay checkpoint/index/duration/result;
- branch generation and removed interval count;
- cleanup removed bytes/files;
- quota refusal;
- checksum/fingerprint/plugin validation failure.

Never log payload bytes, transform secret options, full user paths at info
level, or change-log contents. Errors shown to users should include a stable
code suitable for support and tests.

Stable v1 error codes:

```text
TIMELINE_STORAGE_UNAVAILABLE
TIMELINE_STORAGE_BUSY
TIMELINE_QUOTA_EXCEEDED
TIMELINE_EXPORT_LIMIT
TIMELINE_INTERVAL_INCOMPLETE
TIMELINE_INTERVAL_CORRUPT
TIMELINE_BEFORE_MISMATCH
TIMELINE_AFTER_MISMATCH
TIMELINE_PLUGIN_MISSING
TIMELINE_REPLAY_FAILED
TIMELINE_ROLLBACK_FAILED
TIMELINE_BRANCH_COMMIT_FAILED
```

---

## 11. Definition of Done

The feature is production-ready only when every item is checked and linked to
test output, benchmark output, a PR, or an explicit approved exception.

### Architecture and implementation

- [x] Timeline archive payload memory is storage-backed.
- [x] Shared codec replaces duplicated AI/extension format logic.
- [x] Import is streaming and bounded.
- [x] Optimized ranged export is core-owned and coordinate-correct.
- [x] Large entry payloads are chunked/bounded over gRPC.
- [x] Raw verified fallback exists for every optimizer failure.
- [x] Manifest/file commits and branching are failure-atomic.
- [x] Saved and dirty identity uses fingerprints.
- [x] Quotas and cleanup are implemented.

### Correctness

- [ ] All §3 invariants have automated coverage.
- [ ] Differential fuzz PR tier passes on all platforms.
- [ ] 24-hour soak reports zero failures.
- [x] Raw, optimized, and timeline replay outputs compare byte-identical.
- [x] Transform and plain checkpoint boundaries are covered.
- [x] Auto Save scenarios pass through real VS Code integration tests.
- [ ] Every fault-injection point proves recoverability and file hygiene.

### Quality

- [ ] Lint, compile, unit, integration, sanitizer, and packaging checks pass.
- [ ] Memory and performance gates pass.
- [ ] Accessibility and localization reviews pass.
- [x] User documentation explains Save, Original, Last Saved, branching,
      quotas, and unavailable checkpoints.
- [ ] No unresolved P0/P1 finding in this document remains.

---

## 12. Decision log

Record material decisions here so future work does not reopen them without
evidence.

| Date | Decision | Rationale | Status |
| --- | --- | --- | --- |
| 2026-07-09 | Repository document is canonical; GitHub issue is an umbrella tracker. | Detailed invariants and implementation guidance need versioned review beside code. | Accepted |
| 2026-07-09 | Store adjacent checkpoint intervals, not cumulative logs. | Avoid O(checkpoints × history) storage and enable incremental replay. | Accepted |
| 2026-07-09 | Reuse public change-log v2 for interval files. | Existing tooling can inspect/replay files; timeline metadata stays in a separate manifest. | Accepted |
| 2026-07-09 | Include optimized export only; defer online compaction. | Solves timeline storage without serial-renumbering and undo-semantics risk. | Accepted |
| 2026-07-09 | Raw verified capture is mandatory fallback. | Optimizer availability/performance must not determine checkpoint correctness. | Accepted |
| 2026-07-09 | Saved state is fingerprint-based. | Change counts can identify different content after branching. | Accepted |
| 2026-07-09 | Ranged export reconstructs from the containing checkpoint backing, except a leading TRANSFORM starts from the prior model tip. | This emits transforms exactly once while allowing a range that starts after a transform to use its materialized output without rerunning the plugin. | Accepted |
| 2026-07-09 | The planner uses an implicit AVL rope and a 64 MiB touched-base-plus-forward-payload span budget. | This gives deterministic worst-case logarithmic edits and a monotonic, testable resource bound. | Accepted |
| 2026-07-09 | Export payload frames are capped at 256 KiB and are fully spooled under the session lock before network streaming. | Payload memory stays bounded and network backpressure cannot block editing or outlive borrowed core state. | Accepted |
| 2026-07-09 | Optimized output wins only when its verified encoded file is strictly smaller; ties and optimizer failure retain raw. | Core operation count does not predict JSON byte size, and checkpoint correctness cannot depend on optimization. | Accepted |
| 2026-07-09 | Timeline quota defaults are 1 GiB/session, 5 GiB/storage root, 1000 checkpoints, and seven stale days. Clean close deletes ephemeral history. | Bounds disk use without silently pruning active history; native checkpoint stacks do not survive session close. | Accepted |
| 2026-07-09 | Shared codec lives in `packages/client/src/changeLog/`, with Node adapters below `changeLog/node/`. | AI and extension callers share format behavior without adding Node dependencies to browser-safe code. | Accepted |
| 2026-07-09 | New streaming RPC uses canonical decimal strings for every unbounded serial, offset, length, and count. | The generated TypeScript client maps protobuf int64 to `number`; decimal strings preserve massive-file values without rounding. | Accepted |
| 2026-07-09 | Local v2 import uses two passes over one stable file identity and checksum. | The first pass validates the complete header, entries, plugin set, limits, and checksum before replay; the second yields one normalized entry at a time and detects replacement or mutation. | Accepted |
| 2026-07-09 | Streaming replay batches at most 1024 ordinary entries and flushes around TRANSFORM entries. | Keeps replay memory bounded while retaining transactional rollback and transform checkpoint semantics. | Accepted |
| 2026-07-09 | Atomic local export uses a `0600` same-directory temporary, file fsync, no-clobber hard link or overwrite rename, and parent-directory sync where supported. | Prevents partial committed documents and closes overwrite races while cleaning temporary files on cancellation, limits, callback failure, and filesystem errors. | Accepted |
| 2026-07-09 | Non-file VS Code URI providers use a 64 MiB/10,000-entry capped fallback. | VS Code's generic filesystem API has no streaming handle; a hard cap preserves bounded memory instead of pretending those providers can stream. | Accepted |
| 2026-07-09 | Core ranged export exposes one generalized raw/optimized entrypoint with a borrowed before/after content summary; the design-named optimized function remains as a wrapper. | Raw and optimized streams now share identical all-model range validation, while the server can fingerprint exact interval boundaries without copying or mutating session content. | Accepted |
| 2026-07-09 | OVERWRITE planning removes only the bytes that exist after its offset, then inserts the full forward payload. | OmegaEdit permits overwrite payloads to extend at EOF; treating payload length as the removal length loses valid history and was caught by the serialized fuzz corpus. | Accepted |

---

## 13. Newly discovered work

Add findings here immediately rather than relying on chat or personal notes.
Promote them into a work package once understood.

| ID | Priority | Finding | Owner/PR | Status |
| --- | --- | --- | --- | --- |
| TL-001 | P0 | Ranged optimizer reconstruction semantics across transform-created model boundaries are fixed in §6.1 and `wiki/Change-Log-Optimizer.md` §4.4, with a required model-edge test matrix. | WP0 / #1534 | Resolved |
| TL-002 | P1 | AI and local-file extension imports now use shared two-pass streaming; non-file VS Code providers are hard-capped because their API exposes only whole-file reads. | WP1 / #1533 | Resolved |
| TL-003 | P1 | Current timeline prototype retains replay payloads in extension memory. | WP3 | Resolved |
| TL-004 | P1 | Current saved marker begins with change-count identity and must migrate to fingerprint identity. | WP4 | Resolved |
| TL-005 | P1 | Full native VS Code integration requires platform-matched packaged server artifacts in developer/CI environments. | WP5 | Open |

When adding an item, include impact, reproduction, relevant code, and the test
that will prove it fixed. Do not delete completed items until their resolution
is captured in the decision log or linked PR history.
