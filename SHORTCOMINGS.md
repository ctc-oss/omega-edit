# OmegaEdit Current Shortcomings

This is the current actionable backlog. It replaces the older historical audit,
which had grown into a mix of fixed findings, follow-up notes, and a second
prioritized review appended at the bottom.

Items already fixed by recent work have been removed from the open list. In
particular, the transform/change-log/checkpoint audit items that now have
regression coverage are not repeated here. The recent VS Code extension issues
around the initial Find toggle state, auto bytes-per-row overfitting, and the
duplicate Ctrl-Z undo toast are also treated as fixed by the current extension
branch/PR and are not listed as open.

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

1. **Undo performance batch**: implement the low-risk undo pieces first
   (transaction extents, redo batching, snapshot telemetry), then tackle
   in-place inverse undo.
2. **Edit result semantics**: add a unified success predicate or typed result for
   core mutators before more callers rely on mixed return conventions.
3. **Plugin cancellation**: add cooperative cancellation to the transform plugin
   request path and SDK helpers.
4. **Streaming import**: pair existing streaming export with a streaming/chunked
   import path.
5. **Checkpoint caps/dedupe**: add server/API guardrails for unbounded checkpoint
   creation.

The first batch gives a useful blend: high user-visible impact from undo work,
plus lower-risk cleanup that reduces future surprises.

---

## P0 Correctness / Data Integrity

### 1. Mixed edit API success conventions

**Impact:** High
**Risk:** Medium
**Area:** Core C API

Core mutators such as `omega_edit_insert`, `omega_edit_delete`,
`omega_edit_overwrite`, and `omega_edit_replace` return a positive change serial
on success, `0` for no-op/rejected-without-error cases, and `-1` for invalid
arguments. Batch/checkpoint helpers such as
`omega_edit_replace_bytes_checkpointed`, `omega_edit_apply_script`,
`omega_edit_replace_all_bytes`, and `omega_edit_replace_matches_bytes` return
`0` on success and non-zero on failure.

No single success predicate works across the editing surface. A caller can
silently invert success/failure handling by applying the convention from one API
family to another.

Relevant code:
- `core/src/include/omega_edit/edit.h`
- `core/src/lib/edit.cpp`

Suggested fix:
- Add an explicit result type or documented helper predicate for new code.
- Keep existing ABI-compatible functions, but introduce clearer wrappers for
  serial-returning edits and status-returning batch/checkpoint operations.
- Add tests that assert each public mutator's no-op, success, and failure
  return semantics.

### 2. Change-log rollback still compensates through undo

**Impact:** High
**Risk:** Medium to High
**Area:** Core/server/client change-log import

Change-log import is now much safer: it validates fingerprints, applies normal
edit batches transactionally, and rolls back on failure. The remaining weakness
is the rollback primitive itself. AI and VS Code import paths still compensate by
undoing back to the starting change count. If that rollback path itself fails
partway through, the session can still be left in an awkward intermediate state.

Relevant code:
- `packages/ai/src/service.ts`
- `vscode-extension/src/hexEditorProvider.ts`
- `core/src/lib/edit.cpp`

Suggested fix:
- Add a native "restore to change serial/count and discard redo" primitive.
- Use that primitive from AI and VS Code import rollback.
- Cover failure injection around apply and rollback so partial rollback cannot
  be mistaken for success.

---

## P1 High-Impact Work

### 3. Undo still rebuilds the model instead of applying inverse edits

**Impact:** High
**Risk:** High
**Area:** Core undo/redo

Undo pops the trailing change transaction, then rebuilds the computed model to
the remaining change count with `rebuild_model_to_change_count_`. That routine
clones the nearest snapshot and replays forward from it. The current default
snapshot interval is non-zero (`100`), so the worst case is bounded by snapshot
spacing, but a single undo can still replay many changes and full snapshots are
deep clones of the segment tree.

Relevant code:
- `core/src/lib/edit.cpp:655`
- `core/src/lib/edit.cpp:719`
- `core/src/lib/edit.cpp:2162`
- `core/src/lib/impl_/session_def.hpp:45`

Suggested fix:
- Implement in-place inverse application for ordinary changes:
  delete inverse for insert, insert inverse for delete, restore original bytes
  for overwrite/replace.
- Keep checkpoint-backed transform undo on its existing checkpoint path unless
  or until transform changes get a dedicated inverse/replay primitive.
- Use model integrity tests around mixed insert/delete/overwrite/replace
  sequences before replacing the rebuild path.

### 4. Undo snapshot strategy is count-only and memory-blind

**Impact:** High
**Risk:** Medium to High
**Area:** Core undo/redo memory behavior

Snapshots are full deep clones of the model segment tree and are taken only by
change count. This ignores model size, segment count, and memory pressure. The
current default interval is useful, but the policy is still crude for very large
files or very dense edit histories.

Relevant code:
- `core/src/lib/edit.cpp:719`
- `core/src/lib/impl_/session_def.hpp:45`

Suggested fix:
- Make snapshot policy adaptive: change count plus approximate segment/tree
  size or memory budget.
- Consider structural sharing or copy-on-write segment nodes so snapshots are
  cheap references instead of deep clones.
- Surface basic metrics for snapshot count/bytes in tests or debug logs.

### 5. Transform plugins have no cooperative cancellation

**Impact:** High
**Risk:** Medium
**Area:** Core transform plugin SDK/server integration

Plugin execution has progress callbacks and chunked helpers, but
`omega_transform_plugin_request_t` exposes no cancellation token/callback.
Session destroy, checkpoint cleanup, or user cancel cannot politely ask an
in-flight plugin to stop. For third-party plugins that hold external resources
such as database handles, transactions, or file handles, forceful interruption is
not a safe design.

Relevant code:
- `core/src/include/omega_edit/transform.h`
- `core/src/include/omega_edit/transform_plugin_sdk.h`
- `core/src/lib/transform.cpp`

Suggested fix:
- Add a host-owned cancellation callback/token to the plugin request.
- Add SDK helper functions such as `omega_transform_plugin_sdk_is_cancelled`.
- Check cancellation in built-in streaming loops between chunks.
- Document plugin cleanup expectations on cancellation.

### 6. Change-log import is still full-document JSON parsing

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

### 7. TypeScript live client still has a 2^53 int64 ceiling

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

---

## P2 Medium-Impact / Medium-Risk Work

### 8. Transform change replay is metadata-aware but not native-first

**Impact:** Medium to High
**Risk:** Medium to High
**Area:** Core/proto/server/change-log replay

Transform metadata is now carried through core/proto/server/client/export/import,
and import can replay transforms through the server. The remaining gap is that
replay still depends on the target environment having compatible plugin
semantics, and rollback uses the general import compensation path rather than a
dedicated native replay/import primitive.

Suggested fix:
- Define the guarantees expected of portable transform replay.
- Add a native transform replay/import primitive if the server should own the
  operation end to end.
- Keep verifying replayed size/replacement metadata after import.

### 9. File-backed plugin allocation tracking is process-global

**Impact:** Medium
**Risk:** Medium
**Area:** Core transform plugin allocation

Large plugin allocations are tracked in a process-wide map protected by a single
mutex. Unrelated sessions and plugins therefore contend on one global lock, and
ownership boundaries are less clear than they could be.

Relevant code:
- `core/src/lib/transform.cpp:800`

Suggested fix:
- Move allocation ownership to a per-operation, per-session, or per-registry
  structure.
- Keep a narrow compatibility shim for response cleanup.
- Add stress coverage for concurrent transforms that allocate file-backed
  buffers.

### 10. Server checkpoint creation has no cap or dedupe policy

**Impact:** Medium
**Risk:** Medium
**Area:** Core/server/client checkpoint lifecycle

VS Code skips explicit checkpoint creation when the session is clean, but the
server/core API still allows unbounded checkpoint creation. Repeated checkpoint
calls can grow state without a cost signal or cap.

Relevant code:
- `core/src/lib/edit.cpp:2235`
- `proto/omega_edit/v1/omega_edit.proto`
- `server/cpp/src/editor_service.cpp`

Suggested fix:
- Add configurable checkpoint count/bytes caps.
- Consider dedupe when the computed content equals the latest checkpoint.
- Return explicit "not needed" or "limit reached" results where appropriate.

### 11. C-string and byte edit APIs encode different zero-length semantics

**Impact:** Medium
**Risk:** Low to Medium
**Area:** Core C API

The C-string helpers infer length with `strlen` when the length argument is zero,
while `_bytes` variants treat length zero as an explicit no-op. The headers warn
about this now, but the API shape is still easy to misuse with embedded NULs or
when callers expect zero to mean the same thing everywhere.

Relevant code:
- `core/src/include/omega_edit/edit.h`

Suggested fix:
- Add safer, clearly named APIs for inferred-length text edits.
- Keep byte APIs explicit-only.
- Add examples that steer binary callers to `_bytes` variants.

### 12. Long positional argument lists remain hard to use safely

**Impact:** Medium
**Risk:** Low to Medium
**Area:** Core C API ergonomics

Search/replace and viewport APIs still use long positional lists and `int`
booleans for options such as floating, ordering, and overwrite mode. Argument
swaps are easy to miss at call sites.

Relevant code:
- `core/src/include/omega_edit/edit.h`
- `core/src/include/omega_edit/viewport.h`

Suggested fix:
- Add options-struct APIs for new callers.
- Preserve existing positional APIs for ABI compatibility.
- Use enum/boolean-like typed fields in the options structs.

### 13. Viewport dirty state uses a negative-capacity sentinel

**Impact:** Medium
**Risk:** Low to Medium
**Area:** Core viewport internals

Viewport data dirtiness is encoded by negating `data_segment.capacity`, while
public capacity reads hide that with `abs`. This couples a state flag to a size
field and requires every internal user to remember the convention.

Relevant code:
- `core/src/lib/edit.cpp:1443`
- `core/src/lib/edit.cpp:2155`
- `core/src/lib/edit.cpp:2259`
- `core/src/lib/viewport.cpp:122`

Suggested fix:
- Add an explicit dirty flag to the viewport/data-segment structure.
- Keep capacity non-negative internally.
- Update tests that currently force dirty state by negating capacity.

---

## P3 Low-Risk / Opportunistic Work

### 14. Snapshot allocation failure silently degrades undo speed

**Impact:** Low to Medium
**Risk:** Low
**Area:** Core undo telemetry

When snapshot allocation fails, the snapshot is erased and undo performance can
fall back to longer replay distances without any visible signal.

Relevant code:
- `core/src/lib/edit.cpp:724`

Suggested fix:
- Emit a debug/warn log or session diagnostic event when snapshot capture fails.
- Add a test hook or allocator-failure test if the existing harness supports it.

### 15. Transaction-boundary scan is linear per undo

**Impact:** Low to Medium
**Risk:** Low to Medium
**Area:** Core undo performance

Undo scans backward to find the current transaction extent each time. For very
large transactions this is a repeated tail scan.

Relevant code:
- `core/src/lib/edit.cpp:2176`

Suggested fix:
- Store transaction extents or cached transaction change counts.
- Reuse the same metadata for redo batching.

### 16. Redo still replays one change at a time

**Impact:** Low to Medium
**Risk:** Low to Medium
**Area:** Core redo performance

Redo loops through `changes_undone` and calls `update_` one change at a time,
paying repeated checks and per-change update overhead.

Relevant code:
- `core/src/lib/edit.cpp:2220`

Suggested fix:
- Batch redo by transaction.
- Reuse notification batching and viewport-update coalescing where possible.

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
- Service-wide transform plugin execution locking; server plugin calls now
  snapshot registry metadata under a short lock and execute under session/content
  guards.
- Missing explicit undo-to-baseline reset path.
- Session/viewport subscription lock ordering, handoff, queue closure, and
  ordered callback delivery.
- Desired ID/path validation and default host/port duplication.
- Core memory ownership issues around `omega_data_t`, reverse visitor cleanup,
  const-cast destruction, and allocation failure boundaries.
- Transform option regex hardening.
- Event mask signed `ALL_EVENTS` ambiguity.
- Output collision suffix range and deprecated protobuf generator dependencies.
