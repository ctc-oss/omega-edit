# OmegaEdit Current Shortcomings

This is the current actionable backlog. It replaces the older historical audit,
which had grown into a mix of fixed findings, follow-up notes, and a second
prioritized review appended at the bottom.

Items already fixed by recent work have been removed from the open list. In
particular, the transform/change-log/checkpoint audit items that now have
regression coverage are not repeated here. The recent VS Code extension issues
around the initial Find toggle state, auto bytes-per-row overfitting, and the
duplicate Ctrl-Z undo toast are also treated as fixed by the current extension
branch/PR and are not listed as open. The redo preservation bug across
transform undo boundaries found by the brutal-testing harness is also fixed by
the current core test branch/PR and is no longer listed as open. The zlib
decompression cap and C++ codec cancellation/base58 guardrail items are also
fixed and no longer listed as open. The profile/character-count scan buffer
issue, search read-failure reporting issue, and unbounded `replace_matches`
materialization issue are also fixed and no longer listed as open. The utility
string-helper issue and the fixed failure-signaling edges for unknown CLI
options and missing session files are likewise no longer listed as open. The
code-quality cleanup for computed-content inspection lock scope,
descriptor-preserving temp-file writes, explicit C-string/named-options APIs, OpenSSL
cipher key scrubbing, shared C plugin option parsing, targeted duplication
extractions, and the replace/save failure-signaling edges is also complete and
no longer listed as open. Mutation-capable transform RPCs still intentionally
serialize the session while a plugin runs because they can modify the current
core model.

Recent core/server/plugin review findings have been folded into the priority
list below rather than kept as a second appended review. A fresh core/server
review pass (edit/session/viewport/search/transform/filesystem/utility plus the
gRPC service, session manager, and server main) added the items marked as new
in this revision.

Priority guide:
- **P0**: correctness, data integrity, or behavior that can mislead callers.
- **P1**: high-impact product, performance, or robustness work.
- **P2**: meaningful API or architecture improvement.
- **P3**: polish, telemetry, or opportunistic cleanup.

Risk guide:
- **Low**: mostly additive, localized, or test-only.
- **Medium**: touches shared behavior but has clear boundaries.
- **High**: broad API, format, or core model changes.

---

## Start Here

1. **Critical deployment boundary**: add optional TLS/mTLS and an authorization
   hook before making any "hardened for production" attestation.
2. **Massive-file pressure caps**: apply a configurable segment-size cap to
   read/classification RPCs.
3. **Undo performance batch**: implement the remaining low-risk undo pieces
   (transaction extents, redo batching, snapshot telemetry).
4. **Streaming import**: pair existing streaming export with a streaming/chunked
   import path.
5. **Checkpoint caps/dedupe**: add server/API guardrails for unbounded checkpoint
   creation.

The first batch now favors deployment hardening, resource caps, and remaining
input-hardening work before larger undo/import architecture changes.

## P0 Critical Hardening

### 1. Server transport has no TLS or authentication path

**Impact:** High for critical or non-local deployments
**Risk:** Medium to High
**Area:** C++ server security/deployment, AI/MCP toolkit

The C++ server only registers insecure gRPC credentials. The loopback-only
default and explicit non-loopback opt-in are good guardrails, but the API can
read and write files with the server process privileges. Critical deployments
need at least optional TLS/mTLS and ideally a narrow authorization hook.

The AI/MCP toolkit surface extends the same trust boundary to the connected
agent: `create_session(filePath)`, `save_session`/`export_range(outputPath)`,
and `apply_change_log(inputPath)` pass caller-supplied paths straight through to
the server/filesystem with no allowlist or workspace confinement. That is
inherent to a file-editing agent tool, but for a hardened deployment it needs the
same explicit trust-boundary decision as the transport.

Relevant code:
- `server/cpp/src/main.cpp:568`
- `server/cpp/src/main.cpp:586`
- `server/cpp/src/main.cpp:593`
- `packages/ai/src/mcp.ts:713`
- `packages/ai/src/service.ts:947`

Suggested fix:
- Add optional TLS and mTLS server credential configuration.
- Preserve the loopback-only insecure default for local tooling.
- Add an authorization hook for file/session operations, or define the
  supported deployment trust boundary explicitly.
- Decide whether the MCP/AI toolkit should confine file paths to an allowlist or
  workspace root, or document that it grants the agent the process's full
  filesystem access.
- Cover secure and insecure startup paths in server tests or integration smoke
  tests.

## P1 High-Impact Work

### 2. Change-detail RPCs materialize file-backed payloads into memory

**Impact:** High for massive files
**Risk:** Low to Medium
**Area:** C++ server change details, core change payload accessor

Deletes and overwrites larger than the inline payload limit (default 64 MiB)
store their captured bytes in a payload file. `fill_change_details` (used by
`GetChangeDetails`, `GetLastChange`, and `GetLastUndo`) calls
`omega_change_get_bytes`, which loads the *entire* file-backed payload into a
heap buffer — and keeps it cached on the change until the change is destroyed.
A single RPC against a multi-gigabyte delete allocates the full payload in
memory, copies it again into the protobuf response, and leaves the cache
resident. There is no size check anywhere on this path, and the server never
configures a send-side message limit (see item 13).

Relevant code:
- `server/cpp/src/editor_service.cpp:842`
- `core/src/lib/change.cpp:45`
- `core/src/lib/change.cpp:56`

Suggested fix:
- Cap the change data returned by detail RPCs (truncate with an explicit
  "data omitted/truncated" indicator, or return storage kind + length only for
  file-backed payloads).
- Avoid populating the permanent payload cache from a one-shot RPC; stream from
  the payload file or use a bounded read.
- Add a test that requests details for a change larger than the inline limit
  and asserts bounded memory/response size.

### 4. Undo snapshot strategy is count-only and memory-blind

**Impact:** High
**Risk:** Medium to High
**Area:** Core undo/redo memory behavior

Snapshots are full deep clones of the model segment tree and are taken only by
change count. This ignores model size, segment count, and memory pressure. The
current default interval is useful, but the policy is still crude for very large
files or very dense edit histories.

Relevant code:
- `core/src/lib/edit.cpp:923`
- `core/src/lib/impl_/session_def.hpp:45`

Suggested fix:
- Make snapshot policy adaptive: change count plus approximate segment/tree
  size or memory budget.
- Consider structural sharing or copy-on-write segment nodes so snapshots are
  cheap references instead of deep clones.
- Surface basic metrics for snapshot count/bytes in tests or debug logs.

### 7. Change-log import is still full-document JSON parsing

**Impact:** High
**Risk:** Medium to High
**Area:** AI service, VS Code extension, change-log format

Change-log export can stream entries to a local file and former hard caps have
been removed. Import still parses the entire JSON document before replay, and
payload bytes are still hex encoded. That means large imports can be memory-heavy
even though export no longer has to be.

Relevant code:
- `packages/ai/src/service.ts`
- `vscode-extension/src/hexEditorProvider.ts`

Suggested fix:
- Introduce a streaming/chunked import reader for the current JSON format, or
  define a v3 chunked/binary format if streaming JSON is too contorted.
- Validate document header/fingerprint before reading all entries.
- Replay entries incrementally while preserving atomic rollback semantics.

### 8. TypeScript live client still has a 2^53 int64 ceiling

**Impact:** High for the "massive files" promise
**Risk:** High
**Area:** TypeScript protobuf/client API

Change-log documents now accept decimal int64 strings, but the generated
protobuf-ts client is still generated with `long_type_number`. The compatibility
wrappers reject unsafe integer values rather than rounding them, which is the
right failure mode, but live TS clients still cannot address offsets, lengths, or
counts beyond `Number.MAX_SAFE_INTEGER`.

Relevant code:
- `packages/client/src/safe_int.ts`
- `packages/client/src/protobuf_ts/generated/omega_edit/v1/omega_edit.ts`
- `buf.gen.yaml`

Suggested fix:
- Plan a BigInt-capable protobuf/client migration.
- Decide whether public TS APIs become BigInt-first, accept `number | bigint`,
  or expose parallel BigInt methods.
- Keep safe-number wrappers for legacy callers during the transition.

### 10. Plugin workers still run with server user privileges

**Impact:** High for any hardening attestation
**Risk:** Medium
**Area:** Transform plugin worker sandboxing, deployment trust boundary

Transform plugins now run through the `omega-transform-plugin-host` worker
process, so a plugin crash fails the transform request without killing the
server. Plugins are classified as production, experimental, or test:
production plugins load by default, experimental plugins require an explicit
startup opt-in, and test plugins require a separate test-only opt-in and are not
part of production packaging. The remaining hardening gap is permission
isolation: workers still run as the same OS user and are launched from
operator-controlled plugin directories. That keeps this as a supply-chain/trust
matter rather than a client-selectable RCE, but a hardened deployment still
needs a clear policy for what extra sandboxing applies.

Relevant code:
- `core/src/tools/transform_plugin_host.cpp`
- `core/src/lib/transform.cpp`
- `server/cpp/src/editor_service.cpp:81`

Suggested fix:
- Define the plugin trust boundary for the attestation (operator-provided,
  reviewed, signed, sandboxed, or disabled).
- Add optional worker permission isolation (`no_new_privs`/seccomp/namespaces or
  platform equivalents), resource limits, and hard timeouts for untrusted
  plugins.

---

## P2 Medium-Impact / Medium-Risk Work

### 11. Transform change replay is metadata-aware but not native-first

**Impact:** Medium to High
**Risk:** Medium to High
**Area:** Core/proto/server/change-log replay

Transform metadata is now carried through core/proto/server/client/export/import,
and import can replay transforms through the server. The remaining gap is that
replay still depends on the target environment having compatible plugin
semantics rather than a dedicated native replay/import primitive.

Suggested fix:
- Define the guarantees expected of portable transform replay.
- Add a native transform replay/import primitive if the server should own the
  operation end to end.
- Keep verifying replayed size/replacement metadata after import.

### 12. Server checkpoint creation has no cap or dedupe policy

**Impact:** Medium
**Risk:** Medium
**Area:** Core/server/client checkpoint lifecycle

VS Code skips explicit checkpoint creation when the session is clean, but the
server/core API still allows unbounded checkpoint creation. Repeated checkpoint
calls can grow state without a cost signal or cap.

Relevant code:
- `core/src/lib/edit.cpp:2620`
- `proto/omega_edit/v1/omega_edit.proto`
- `server/cpp/src/editor_service.cpp:2284`

Suggested fix:
- Add configurable checkpoint count/bytes caps.
- Consider dedupe when the computed content equals the latest checkpoint.
- Return explicit "not needed" or "limit reached" results where appropriate.

### 13. gRPC message-size limits are unconfigured and inconsistent

**Impact:** Medium
**Risk:** Low
**Area:** C++ server transport configuration

`main.cpp` never calls `SetMaxReceiveMessageSize`/`SetMaxSendMessageSize`, so
the server runs with gRPC defaults: a 4 MiB inbound message cap and an
effectively unlimited outbound cap. Two consequences:

- The advertised `--max-change-bytes` default of 64 MiB is unreachable — any
  `SubmitChange` above ~4 MiB is rejected at the transport layer with a
  generic gRPC error before the service's own limit or error message applies.
- Outbound responses are unbounded, which is what makes items 4 and 5 (and
  large `GetSegment` reads) able to produce multi-gigabyte responses.

Relevant code:
- `server/cpp/src/main.cpp:556`
- `server/cpp/src/session_manager.h:43`

Suggested fix:
- Configure receive/send message sizes explicitly and derive them from (or
  validate them against) `max_change_bytes` and the segment/search caps.
- Fail startup or log prominently when the configured limits are mutually
  inconsistent.
- Add an integration test that submits a change just under and just over the
  effective limit and asserts the intended error text.

### 20. Viewport dirty state uses a negative-capacity sentinel

**Impact:** Medium
**Risk:** Low to Medium
**Area:** Core viewport internals

Viewport data dirtiness is encoded by negating `data_segment.capacity`, while
public capacity reads hide that with `abs`. This couples a state flag to a size
field and requires every internal user to remember the convention. The
"negate capacity + notify" idiom is also copy-pasted at six call sites
(`update_viewports_`, `notify_checkpoint_restore_`, `promote_checkpoint_file_`,
`mark_all_viewports_changed_`, `omega_edit_clear_changes`,
`omega_edit_destroy_last_checkpoint`) even though
`mark_all_viewports_changed_` exists for exactly this purpose.

Relevant code:
- `core/src/lib/edit.cpp:588`
- `core/src/lib/edit.cpp:950`
- `core/src/lib/edit.cpp:1070`
- `core/src/lib/edit.cpp:1522`
- `core/src/lib/viewport.cpp:122`

Suggested fix:
- Add an explicit dirty flag to the viewport/data-segment structure.
- Keep capacity non-negative internally.
- Route all mark-dirty-and-notify call sites through one helper.
- Update tests that currently force dirty state by negating capacity.

---

## P3 Low-Risk / Opportunistic Work

### 23. Snapshot allocation failure silently degrades undo speed

**Impact:** Low to Medium
**Risk:** Low
**Area:** Core undo telemetry

When snapshot allocation fails, the snapshot is erased and undo performance can
fall back to longer replay distances without any visible signal.

Relevant code:
- `core/src/lib/edit.cpp:928`

Suggested fix:
- Emit a debug/warn log or session diagnostic event when snapshot capture fails.
- Add a test hook or allocator-failure test if the existing harness supports it.

### 24. Transaction-boundary scan is linear per undo

**Impact:** Low to Medium
**Risk:** Low to Medium
**Area:** Core undo performance

Undo scans backward to find the current transaction extent each time. For very
large transactions this is a repeated tail scan.

Relevant code:
- `core/src/lib/edit.cpp:2551`

Suggested fix:
- Store transaction extents or cached transaction change counts.
- Reuse the same metadata for redo batching.

### 25. Redo still replays one change at a time

**Impact:** Low to Medium
**Risk:** Low to Medium
**Area:** Core redo performance

Redo loops through `changes_undone` and calls `update_` one change at a time,
paying repeated checks and per-change update overhead.

Relevant code:
- `core/src/lib/edit.cpp:2596`

Suggested fix:
- Batch redo by transaction.
- Reuse notification batching and viewport-update coalescing where possible.

### 30. Content detection feeds untrusted bytes to third-party parsers

**Impact:** Low to Medium
**Risk:** Low
**Area:** C++ server content/language detection

`GetContentType` and `GetLanguage` hand segment bytes to libmagic and CLD3.
libmagic has a long history of parser CVEs, and both run in-process. Access is
serialized and bounded to the requested segment, so this is a dependency-currency
and isolation concern rather than a code defect.

Relevant code:
- `server/cpp/src/libmagic_content_detector.cpp:129`
- `server/cpp/src/cld3_language_detector.cpp:132`

Suggested fix:
- Move content-type and language guessing behind detector/inspect plugins that
  run through the existing transform-plugin worker boundary instead of calling
  libmagic/CLD3 in the server process.
- Keep `GetContentType` and `GetLanguage` as compatibility RPCs that dispatch
  to configured detector plugins, or introduce plugin-backed replacement RPCs
  and deprecate the in-process implementations.
- Treat libmagic/CLD3-backed detectors as optional operator-selected plugins,
  with the same production/experimental support levels, cancellation, resource
  limits, and worker sandboxing policy as transform plugins.
- Track and update bundled detector plugin dependencies as part of the release
  process, and document the plugin trust boundary for deployments.

### 31. Text pane and Data Inspector only expose ASCII-oriented byte display

**Impact:** Low
**Risk:** Low
**Area:** VS Code hex editor text pane, Data Inspector, text search

The TEXT pane currently treats bytes as ASCII-ish printable characters with a
placeholder for non-printable values. Other hex editors let users switch that
view among common single-byte character sets such as ASCII, Windows ANSI
code pages, DOS/OEM code pages, EBCDIC, and Macintosh/MacRoman. The Data
Inspector should expose the same byte-to-character interpretations so a selected
byte or range can be inspected without mentally translating high-bit bytes.
Text search should use the selected text encoding when converting the query to
bytes, while hex search should remain byte-literal and unaffected.

Important product detail: "ANSI" and "DOS" are families, not one universal
mapping. The UI should pick explicit defaults such as Windows-1252 and CP437,
while leaving room for additional code pages later.

Suggested fix:
- Add a text encoding selector for the TEXT pane, initially covering ASCII,
  Windows-1252, CP437, EBCDIC, and MacRoman.
- Add matching Data Inspector fields for the selected byte/range so high-bit
  bytes can be interpreted in the same supported character sets.
- Route text search query encoding through the selected character set, keep
  match offsets byte-native, and make charset changes invalidate/re-run any
  active text search window.
- Keep the core byte model unchanged; this should be display/inspection-layer
  decoding unless a later API need emerges.
- Cover printable ASCII identity, high-byte divergence across encodings,
  EBCDIC alphabet bytes, non-printable placeholder behavior, and text-search
  byte encoding for each supported character set in tests.

## Testing Gaps For Attestation

These are not separate product shortcomings, but they are worth closing before
claiming production hardening:

- Save durability: add fault-injection coverage around interrupted saves beyond
  the current atomic/durable publishing coverage.
- Change-detail payload bounds: request details for a change larger than the
  inline payload limit and assert bounded memory/response behavior.
- Same-session availability under long scans: run a slow operation (large
  transform or computed-content fingerprint) and assert non-mutating RPCs on
  that session complete promptly once the long scan paths release `core_mutex`
  more aggressively.
- gRPC message-size boundaries: submit changes just under/over the effective
  transport and `max_change_bytes` limits and assert the intended error paths.
- Transform/mutation concurrency: add real-thread coverage for
  `try_begin_transform` returning `MUTATION_IN_PROGRESS` and for transform vs.
  mutation mutual exclusion.
- Source mutation immunity: assert sessions continue reading from their private
  original snapshot after the user truncates or rewrites the source file.
- Plugin fuzzing: fuzz the format inspectors and text/decimal codecs, especially
  base58, for hangs, unbounded output, and decode round-trips.
- Plugin cancellation: assert every bundled plugin honors cooperative
  cancellation partway through a large selection.

---

## Reviewed And Not Open

- The stack-allocated `omega_segment_t data_segment` in
  `omega_search_next_match` is not an uninitialized-read issue; the struct uses
  non-static data member initializers, so default initialization covers the
  fields read by `populate_data_segment_`.
- The xxhash streaming ring-buffer arithmetic in `common_checksums.cpp` is
  bounds-safe, and the streaming checksums honor cancellation via
  `for_each_chunk`.
- `omega_find` (Boyer-Moore-Horspool) and its 256-entry skip table are
  byte-indexed and bounds-checked; the search core operates on segment buffers
  bounded by the max segment length.
- `omega_session_*` count/segment/BOM entry points validate offset/length via
  `safe_add_int64_` and tolerate null segments; `ABORT` is `std::abort()`
  (noreturn), so switch defaults that reach it are not fall-through UB.
- The floating-viewport offset-adjustment arithmetic clamps on `int64`
  overflow via `safe_add_int64_` rather than wrapping, and dirty-read
  repopulation re-validates lengths.
- The transform plugin allocator's file-backed (mmap) allocations are tracked
  in an allocation store; unclaimed allocations are released after apply and
  response-owned buffers are promoted to the global store and freed by
  `omega_transform_plugin_response_clear`, so no leak path was found.
- The server event queues are bounded (drop-oldest with logged drop counts),
  closed on unsubscribe/destroy, and cleared to release retained payloads;
  subscriber streams exit on cancellation or queue closure.
- The schema-regex safety pre-check plus 4 KiB pattern cap and bounded cache in
  `transform.cpp` reasonably mitigate ReDoS in plugin option validation, and
  the hand-rolled JSON parser enforces a 256-level nesting cap.
- Session/viewport ID validation (charset + 128-byte cap), path control-byte
  rejection, and shared-session attachment counting in the session manager are
  sound; UUIDv7 generation is mutex-guarded and monotonic.

---

## Recently Fixed And Removed From The Open List

These areas were in the old document but are no longer open backlog items:

- Transform no-op/content-changed accuracy and client-side no-op undo.
- Transform identity/history metadata in VS Code and change-log export/import.
- Checkpoint rollback/restore naming and true restore-to-latest-checkpoint.
- Atomic fingerprinted change-log apply with rollback compensation.
- Change-log version enforcement, serial/group validation, completeness metadata,
  and status-code-based missing-detail handling.
- Former hard change-log entry/byte caps on export/import.
- Unbounded `SearchSession` unary responses; the server now enforces a
  configurable `max_search_matches` policy and returns `RESOURCE_EXHAUSTED`
  instead of silently truncating when a search would exceed it.
- Unbounded `GetSegment`, `GetContentType`, and `GetLanguage` allocations; the
  server now applies a configurable read/classification segment limit that
  defaults to the viewport capacity and can be disabled with `0`.
- Service-wide transform plugin execution locking; server plugin calls now
  snapshot registry metadata under a short lock and execute under session/content
  guards.
- Missing explicit undo-to-baseline reset path.
- Mixed edit API success conventions; serial-returning and status-returning core
  APIs now have explicit success predicates.
- Undo-based change-log rollback; AI and VS Code imports now use a native
  restore-to-change-count primitive that discards redo.
- Clear-changes now discards stacked checkpoint/transform models, resets change
  serial bookkeeping to the original model, and marks viewports dirty.
- Session creation and session/viewport subscription paths now avoid holding the
  global session-map mutex across core session creation or per-session
  `core_mutex` acquisition.
- Shared file-backed session creation now reserves the file-path mapping in the
  same critical section that observes no existing session, so concurrent authors
  attach to one session instead of racing into adjacent reservations.
- Session/viewport subscription lock ordering, handoff, queue closure, and
  ordered callback delivery.
- Desired ID/path validation and default host/port duplication.
- Core memory ownership issues around `omega_data_t`, reverse visitor cleanup,
  const-cast destruction, and allocation failure boundaries.
- Transform option regex hardening.
- Transform plugin cooperative cancellation in the core request ABI, SDK helper,
  server gRPC/session-destroy cancellation paths, and bundled plugin polling
  loops, with TypeScript client, AI/MCP, and VS Code webview cancellation wired
  through to the same RPC cancellation path.
- Large-search navigation now keeps anchor-based next/previous lookup bounded,
  then decorates the active viewport with a separately bounded neighbor match
  window that handles reverse navigation, overlaps, viewport boundaries, and
  external range-map/debugger highlight overlays independently.
- Near-`INT64_MAX` overflow coverage now exercises public C APIs and raw server
  RPC boundaries for search, replace, segment, and viewport ranges.
- Event mask signed `ALL_EVENTS` ambiguity.
- Output collision suffix range and deprecated protobuf generator dependencies.
