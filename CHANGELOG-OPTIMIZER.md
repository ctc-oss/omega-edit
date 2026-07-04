# Change-Log Optimizer

**Status:** Approved design. Supersedes `CHANGELOG-OPTIMIZER.md` and
`CHANGELOG-OPTIMIZER-REVISED.md`.

**Audience:** A software engineer implementing this with AI coding assistants.
Every section that matters for implementation names the real files, functions,
and invariants in this repository so an assistant can be pointed at them
directly. Verify any line numbers before relying on them — the code moves.

---

## 1. What this document is

Two prior designs existed:

- `CHANGELOG-OPTIMIZER.md` (original) proposed an in-core compactor built on
  adjacent-entry pattern matching and an "interruptible scan with atomic vector
  swap". **Do not implement it.** Section 12 explains, with concrete examples,
  why its optimization rules are semantically wrong and why its concurrency
  model doesn't match the core.
- `CHANGELOG-OPTIMIZER-REVISED.md` corrected the model: a coordinate-aware
  planner shared by a non-mutating export mode (ship first) and a later online
  compaction mode. Its constraints section is accurate.

This document keeps the revised architecture, tightens the API, adds the
implementation hints and pitfalls an engineer (and their AI assistant) needs,
and lays out a phased execution plan where every phase lands independently
with tests.

## 2. Problem and use cases

The change-log export pipeline (`packages/ai/src/service.ts`,
`exportChangeLog` / `applyChangeLog`) serializes one `ChangeLogEntry` per
change serial into a JSON `ChangeLogDocument` (hex payloads). Sessions with
tens of thousands of tiny edits (per-keystroke inserts, repeated rewrites of
the same range) produce logs where per-entry overhead dominates, and replay
costs one round of work per entry.

Two use cases, in delivery order:

1. **Optimized export (non-mutating).** Produce a smaller, replayable change
   log that reaches the same final content. Nothing about the session changes.
2. **Online compaction (mutating history, not content).** Reduce a live
   session's in-memory change history — fewer change records, less payload
   retention, shorter undo replay — without changing the current document
   content.

Both are powered by **one shared planner** in the core C++ library. The
TypeScript layer stays thin: routing, JSON formatting, fingerprints,
presentation. No optimization logic in TS.

## 3. Ground truth: how the core actually stores history

These are facts about the current code, not design choices. The design must
respect all of them. (All paths relative to repo root.)

### 3.1 History is split across models

`omega_session_t` (`core/src/lib/impl_/session_def.hpp`) owns `models_`, a
vector of `omega_model_t`. Each model has:

- `change_serial_base` — cumulative change count when the model was created
- `changes` — active changes (`std::vector<const_omega_change_ptr_t>`,
  i.e. `shared_ptr<const omega_change_t>`)
- `changes_undone` — undone changes (redo stack)
- `model_segments` — the piece list the session reads through
- `model_snapshots` — deep clones of `model_segments`, keyed by **change
  count**, taken every `undo_snapshot_interval_` changes
- `file_ptr` / `file_path` — the model's backing content (original snapshot
  copy for the front model, checkpoint file for others)

`models_.back()` is the live model. Every read (`populate_data_segment_` in
`core/src/lib/impl_/internal_fun.cpp`) goes through the back model only.

### 3.2 Serial lookup is index arithmetic

`omega_session_get_change` (`core/src/lib/session.cpp`) resolves a serial via
`index = serial - 1 - model->change_serial_base` against each model's
`changes` vector. **Compaction cannot leave sparse serials.** Compacted
changes must be renumbered contiguously and clients must be told their cached
serials are invalid.

### 3.3 Model segments reference change objects

`omega_model_segment_t` holds a `shared_ptr` to its parent change and reads
payload bytes through it (`omega_change_copy_payload_bytes_` in
`core/src/lib/impl_/change_def.hpp`). Snapshots clone segments and retain the
same change references. **You cannot swap only the `changes` vector.** Online
compaction must install, together and atomically: replacement changes,
replacement segments, cleared/rebuilt snapshots, renumbered serials, and
updated counts.

### 3.4 Undo/redo state is separate, and payloads carry undo data

Undo (`omega_edit_undo_last_change`, `core/src/lib/edit.cpp`) pops active
changes, flips `serial` negative, and pushes them onto `changes_undone`. There
are **no negative serials inside the active vector**. A new change with a
positive serial frees the redo stack (`free_session_changes_undone_`), which
also deletes undone transforms' checkpoint files.

DELETE changes carry the deleted bytes as a payload (inline or file-backed);
OVERWRITE carries the replaced bytes as `inverse_data`. That payload is what
makes undo possible. Any synthesized change that should remain undoable must
have a correct payload — see the shadow-replay hint in §9.3.

### 3.5 Payload destructors delete files

`omega_byte_payload_struct::reset()` (`core/src/lib/impl_/change_def.hpp`)
**removes the payload file from disk** when storage is file-backed. Dropping
the last `shared_ptr` to a change destroys its payloads. Consequences:

- Discarding a change during compaction correctly cleans up its payload file —
  but only after the last reference (old segments, old snapshots) is gone.
- A synthesized merged change must own its own payload (new inline buffer or
  new payload file). Never alias another change's payload file path.

### 3.6 TRANSFORM is a checkpoint-backed model boundary

Transforms materialize their output into a checkpoint file and push a new
model whose first change is the TRANSFORM record
(`promote_checkpoint_file_`, `core/src/lib/edit.cpp`). `update_model_` skips
TRANSFORM changes entirely — they never splice segments. Transforms are
**hard barriers**: never merged, deduplicated, reordered, or synthesized. (Two
"identical" transforms are not provably idempotent; plugin behavior is opaque.)

Plain checkpoints (`omega_edit_create_checkpoint`) also create model
boundaries but add **no** change record.

### 3.7 REPLACE is not a stored change kind

Internal kinds are DELETE(0), INSERT(1), OVERWRITE(2), TRANSFORM(3)
(`core/src/lib/impl_/change_def.hpp`). REPLACE exists only as a script/export
operation (`omega_edit_script_op_t`, applied by `omega_edit_apply_script` as
delete+insert in a transaction). Export may emit REPLACE entries; online
compaction must lower them to the existing kinds.

### 3.8 The core is single-threaded per session

The gRPC server serializes all access to a session through
`SessionInfo::core_mutex` (`server/cpp/src/session_manager.h`), plus
`try_begin_mutation` / `try_begin_transform` operation guards. There is no
concurrent mutation to be "interruptible" against. Online compaction v1 runs
fully serialized like any other mutation RPC. (A low-lock variant is a listed
future extension, §11 — it requires deep-copying change metadata under the
lock, because change objects are mutated in place by undo/redo.)

### 3.9 `omega_visit_changes` only visits the back model

`core/src/lib/visit.cpp` iterates `models_.back()->changes`. Export
enumeration must walk **all models in serial order** to see the full history
(including TRANSFORM records at model boundaries). This is a new internal
helper, not a change to the existing public visitor.

### 3.10 Offsets are state-relative

A change's `offset` is a coordinate in the document **as it existed when the
change was applied**. Later changes shift earlier coordinates. This single
fact invalidates all adjacent-entry pattern matching — see §12.

## 4. Design overview

```
                       ┌────────────────────────────┐
                       │  History enumerator        │
                       │  (all models, serial order)│
                       └─────────────┬──────────────┘
                                     │ raw changes + barriers
                                     ▼
                       ┌────────────────────────────┐
                       │  Span partitioner          │
                       │  barriers: TRANSFORM,      │
                       │  model boundary, high-water│
                       │  tail (compaction only)    │
                       └─────────────┬──────────────┘
                                     │ spans of plain edits
                                     ▼
                       ┌────────────────────────────┐
                       │  Coordinate-aware planner  │
                       │  (piece table per span)    │
                       └───────┬───────────┬────────┘
                               │           │
                 plan entries  │           │  plan entries
                               ▼           ▼
                ┌──────────────────┐  ┌───────────────────────┐
                │ EXPORT consumer  │  │ COMPACTION consumer   │
                │ visitor callback │  │ candidate model build │
                │ (non-mutating)   │  │ + validate + install  │
                └──────────────────┘  └───────────────────────┘
```

One planner, two consumers. Export ships first and de-risks the planner; the
compaction consumer reuses it unchanged.

### 4.1 Spans

An **optimization span** is a maximal run of active, non-transform changes
that may be planned together. Spans never cross:

- TRANSFORM entries (preserved exactly, emitted as-is)
- model boundaries (v1; content-equivalent merging across plain-checkpoint
  boundaries is a future extension)
- the protected high-water tail (online compaction only)
- redo state (compaction v1 requires empty redo)

### 4.2 The planner

Per span, replay the span's changes **in order** into a lightweight piece
table over the span's input document:

- Pieces are either *base* (range of the span input) or *insert* (payload
  bytes of a raw change, referenced not copied).
- INSERT splices an insert piece at the current-coordinate offset.
- DELETE removes a current-coordinate range (splitting pieces as needed).
- OVERWRITE is planned as delete + equal-length insert.

At span end, **diff the piece sequence against identity**: walk the pieces,
and for every region that is not "base piece i covering exactly its original
range in order", emit a minimal op. Trim common prefixes/suffixes of
replacement regions against base bytes (this needs actual base bytes — read
them lazily and only for candidate regions). Emission produces a compact
script in replay coordinates (offsets valid at replay time, front to back):

- nothing, when the span nets out to identity
- DELETE when the replacement is empty
- INSERT when the removed range is empty
- OVERWRITE when lengths match (optional; callers may prefer REPLACE form)
- REPLACE otherwise

Complexity: piece count is O(#changes in span), not O(file size). Memory is
bounded by piece metadata plus payload references; `max_span_bytes` splits
oversized spans into subspans as a safety valve (correct, just less optimal).

### 4.3 What each consumer does with plan entries

- **Export** serializes them through a visitor callback; TS wraps them into
  the existing `ChangeLogDocument` format. Non-mutating; borrowed pointers
  valid only during the callback.
- **Compaction** lowers them into real core changes, rebuilds the model, and
  atomically installs the candidate (§7).

## 5. Correctness rules (the invariants tests must pin)

1. **Content identity.** After replaying an optimized export into a fresh
   session over the same base content — or after online compaction of a live
   session — the computed file size and content bytes are identical to the
   unoptimized result. Verify with `omega_edit_save_segment_to_bytes` for
   small tests and the fingerprint digest for large ones.
2. **Transform preservation.** TRANSFORM entries appear in the output exactly
   once each, unmodified, in order, with all metadata
   (`transform_id`, `options_json`, `replacement_length`,
   `computed_file_size_before/after`).
3. **Serial honesty.** Synthetic export entries carry **no** `serial` (or
   explicit provenance metadata later); they must not impersonate original
   serials. After online compaction, active serials in the compacted model
   are contiguous from `change_serial_base + 1`, and the compaction event
   reports `first_invalid_serial`.
4. **Undo safety (compaction).** The high-water tail (last N active changes)
   keeps its exact change records — same granularity, same payloads. Changes
   older than the tail may be coalesced into fewer, coarser undo units, but
   undo through them must still restore correct content (guaranteed by the
   shadow-replay lowering, §9.3).
5. **No mutation on export.** Export takes a `const omega_session_t *` and
   must compile that way.
6. **Failure atomicity (compaction).** Any failure — allocation, validation,
   precondition — leaves the session exactly as it was.

## 6. Public core API

New header: `core/src/include/omega_edit/changelog.h`. New source:
`core/src/lib/changelog.cpp` (planner + consumers; split into
`changelog_planner.cpp` if it grows). Follow the existing header conventions
(C linkage, Doxygen comments, `omega_edit_` prefix, status-code returns —
note `omega_edit_status_result_is_success` treats `0` as success).

### 6.1 Plan entry (shared by export visitor)

```c
typedef enum {
    OMEGA_CHANGELOG_PLAN_DELETE = 1,
    OMEGA_CHANGELOG_PLAN_INSERT = 2,
    OMEGA_CHANGELOG_PLAN_OVERWRITE = 3,
    OMEGA_CHANGELOG_PLAN_REPLACE = 4,
    OMEGA_CHANGELOG_PLAN_TRANSFORM = 5
} omega_changelog_plan_kind_t;

typedef struct {
    omega_changelog_plan_kind_t kind;
    int64_t offset;              /* replay-time document offset */
    int64_t length;              /* delete/overwrite/remove length */
    const omega_byte_t *bytes;   /* borrowed; valid only during callback */
    int64_t bytes_length;        /* insert/overwrite/replacement length */

    /* TRANSFORM only; borrowed during callback. */
    const char *transform_id;
    const char *options_json;
    int64_t replacement_length;
    int64_t computed_file_size_before;
    int64_t computed_file_size_after;
} omega_changelog_plan_entry_t;
```

### 6.2 Optimized export (Phase 1)

```c
typedef int (*omega_changelog_plan_visitor_cbk_t)(
    const omega_changelog_plan_entry_t *entry, void *user_data);

typedef struct {
    uint32_t flags;              /* reserved; 0 for v1 */
    int64_t max_span_bytes;      /* 0 = default; splits oversized spans */
    int64_t max_entries;         /* 0 = uncapped */
    int prefer_overwrite_form;   /* emit OVERWRITE instead of equal-length REPLACE */
} omega_changelog_export_options_t;

/** Non-mutating. Returns 0 on success, non-zero on error or when the
 *  visitor callback returns non-zero (propagated). */
int omega_edit_export_changelog_optimized(
    const omega_session_t *session_ptr,
    const omega_changelog_export_options_t *options, /* NULL = defaults */
    omega_changelog_plan_visitor_cbk_t cbk,
    void *user_data);
```

### 6.3 Online compaction (Phase 3)

```c
typedef struct {
    uint32_t high_water_count;      /* protected tail; default 20 */
    uint32_t flags;                 /* reserved */
} omega_changelog_compact_options_t;

typedef struct {
    int64_t change_count_before;
    int64_t change_count_after;
    int64_t removed_change_count;
    int64_t first_invalid_serial;   /* clients invalidate serials >= this */
    int64_t preserved_tail_count;
} omega_changelog_compact_result_t;

/** Compacts active history of the current (back) model only, preserving the
 *  high-water tail. Content is unchanged. Returns:
 *    0  success (including no-op)
 *   -1  invalid argument / internal error (session preserved)
 *   -2  blocked: open transaction, redo state present, changes paused,
 *       or nothing eligible
 *   -3  candidate validation failed (session preserved)          */
int omega_edit_compact_changes(
    omega_session_t *session_ptr,
    const omega_changelog_compact_options_t *options, /* NULL = defaults */
    omega_changelog_compact_result_t *result);        /* NULL ok */
```

### 6.4 Session event (Phase 3)

Add to `omega_session_event_t` in `core/src/include/omega_edit/fwd_defs.h`.
The highest bit currently used is `SESSION_EVT_RESTORE_CHECKPOINT = 1 << 18`,
so:

```c
SESSION_EVT_CHANGELOG_COMPACTED = 1 << 19
```

Event payload is `omega_changelog_compact_result_t` (same struct; passed as
the notify pointer). Emit exactly **one** event after install — no EDIT/UNDO
events, because content did not change. Mark all viewports dirty via the
existing `mark_all_viewports_changed_` helper pattern (offsets unchanged).

Client obligations on receipt: re-read change count; invalidate cached serials
`>= first_invalid_serial`; fingerprints and content-derived caches are
unaffected.

## 7. Online compaction commit model (Phase 3)

Compaction is a **mutation of history, not content**, executed fully
serialized like any other mutation.

**Preconditions (return `-2` when violated):**

- no transaction open or in progress (`omega_session_get_transaction_state`)
- no redoable changes in the back model (`changes_undone` empty)
- changes not paused (`omega_session_changes_paused`)
- at least one eligible change beyond the high-water tail

**Build candidate (no session mutation yet):**

1. Partition the back model's active changes: `[0, scan_limit)` eligible,
   `[scan_limit, end)` protected tail, where
   `scan_limit = changes.size() - high_water_count` (skip the leading
   TRANSFORM record if the model is a transform checkpoint — it stays as-is).
2. Run the planner over the eligible range (single span in practice, since
   transforms end models).
3. **Lower via shadow replay** (§9.3): apply the plan through the normal edit
   primitives against a scratch model seeded from the back model's backing
   file. This produces correct changes (with undo payloads), segments, and
   serials for free.
4. Replay the protected tail's existing change records on top (reusing the
   same `shared_ptr`s; their `serial` fields get renumbered during install).
5. Validate: computed file size equals pre-compaction size;
   `omega_check_model`-style integrity on the candidate; optional content
   fingerprint in paranoid/debug builds. On failure return `-3`, discard.

**Atomic install:**

1. Re-check preconditions (cheap; nothing ran concurrently, but guard against
   event-handler reentrancy).
2. Move candidate `changes`, `model_segments` into the back model; clear
   `model_snapshots` (they are keyed by change count, which just changed —
   let the normal snapshot interval rebuild them).
3. Renumber serials contiguously from `change_serial_base + 1` (tail change
   objects are mutated in place, mirroring how undo flips signs).
4. Mark viewports dirty; emit `SESSION_EVT_CHANGELOG_COMPACTED`.

Old change objects (and their file-backed payloads) are released when the
last references from the old segments/snapshots drop — which is exactly at
install. That is the desired cleanup (§3.5).

## 8. Server and TypeScript integration

### 8.1 gRPC (service `EditorService`, `proto/omega_edit/v1/omega_edit.proto`)

Export must be **server-streaming** — the server never configures message-size
limits and currently inherits gRPC's 4 MiB inbound default and unlimited
outbound (see `SHORTCOMINGS.md` item 15); a unary export response is exactly
the kind of unbounded message that document flags.

```protobuf
rpc ExportChangeLog(ExportChangeLogRequest)
    returns (stream ExportChangeLogResponse);

message ExportChangeLogRequest {
    string session_id = 1;
    bool optimize = 2;
}

message ExportChangeLogResponse {
    ChangeLogEntry entry = 1;   // new message mirroring plan entries
}

rpc CompactChanges(CompactChangesRequest) returns (CompactChangesResponse);

message CompactChangesRequest {
    string session_id = 1;
    optional uint32 high_water_count = 2;
}

message CompactChangesResponse {
    string session_id = 1;
    int64 change_count_before = 2;
    int64 change_count_after = 3;
    int64 removed_change_count = 4;
    int64 first_invalid_serial = 5;
    int64 preserved_tail_count = 6;
}
```

Server implementation notes (`server/cpp/src/editor_service.cpp`):

- `CompactChanges` follows the standard mutation prologue used by
  `UndoLastChange`/`ClearChanges`: `session_manager_.try_begin_mutation(...)`,
  then `lock_session(...)`, then the core call, mapping `-2` to
  `FAILED_PRECONDITION` and `-1`/`-3` to `INTERNAL`.
- `ExportChangeLog` is read-only: `lock_session` only. The visitor writes one
  streamed response per entry; honor `context->IsCancelled()` between writes.
  Note the core lock is held for the duration — the same availability caveat
  as other whole-content reads (`SHORTCOMINGS.md` items 3/16 apply; keep the
  per-entry work small and let the stream apply backpressure).
- Forward `SESSION_EVT_CHANGELOG_COMPACTED` through the existing session event
  subscription plumbing (`session_event_callback` in
  `server/cpp/src/session_manager.cpp` — add the payload fields to
  `SessionEventData` the same way transform progress was added).

### 8.2 TypeScript (`packages/ai/src/service.ts`, `packages/ai/src/mcp.ts`)

The TS layer keeps its current responsibilities: `ChangeLogDocument` JSON
shape (`packages/ai/src/types.ts`), streaming to file, before/after
fingerprints, replay validation, CLI/MCP presentation.

- `exportChangeLog(...)` (service.ts) gains `optimize?: boolean`; when set it
  consumes the streaming RPC instead of per-serial `getChangeDetails`.
  Synthetic entries are written **without** `serial`.
- `applyChangeLog(...)` keeps its behavior: transactional batches for plain
  entries, plugin replay for transforms. It already replays entries in order
  with replay-time offsets, which is exactly what the planner emits. (A batch
  `ApplyScript` RPC is a separate optimization, out of scope here.)
- MCP: `omega_edit_export_change_log` gains an `optimize` parameter; add
  `omega_edit_compact_changes` returning the compact result fields.

## 9. Implementation hints (read before writing code)

### 9.1 Reuse map — functions that already do what you need

| Need | Reuse | Where |
| ---- | ----- | ----- |
| Enumerate all history in serial order | iterate `session_ptr->models_`, each model's `changes` (bases are ordered) | `session_def.hpp`, `model_def.hpp` |
| Read change payload bytes safely | `omega_change_copy_payload_bytes_` / `omega_change_write_payload_bytes_` | `impl_/change_def.hpp` |
| Change kind / transaction bit | `omega_change_get_kind_`, `omega_change_get_transaction_bit_` | `impl_/change_def.hpp` |
| Read base content ranges (for prefix/suffix trim) | `omega_session_get_segment` on a scratch `omega_segment_t`, or `omega_util_read_file_segment` against the model's backing file | `session.cpp`, `filesystem.cpp` |
| Build changes with correct payload capture | `omega_edit_insert_bytes` / `omega_edit_delete` / `omega_edit_overwrite_bytes` (they call `capture_session_range_payload_` internally) | `edit.cpp` |
| Batch-apply a script in one transaction | `omega_edit_apply_script` | `edit.cpp` |
| Rebuild segments by replaying changes | pattern in `rebuild_model_to_change_count_` (`initialize_model_segments_` + `update_model_` loop) | `edit.cpp` |
| Validate candidate integrity | `omega_check_model` (session-level; adapt its checks for a single candidate model) | `check.cpp` |
| Mark viewports dirty + notify | `mark_all_viewports_changed_` pattern | `edit.cpp` |
| Overflow-safe arithmetic | `safe_add_int64_`, `valid_nonnegative_range_` | `impl_/safe_math.hpp` |
| Content fingerprint for tests | `GetSessionFingerprint` RPC / digest plugin, or `omega_edit_save_segment_to_bytes` + any hash for unit tests | server + `edit.cpp` |

### 9.2 Gotchas — each of these has bitten a prior design

1. **Same-offset inserts reverse.** `INSERT@5 "AB"` then `INSERT@5 "CD"`
   yields `CDAB` at offset 5, not `ABCD`. Any "concatenate adjacent inserts"
   shortcut is wrong; only the piece-table replay is safe.
2. **Payload file deletion on destruction** (§3.5). Never construct a
   candidate change that stores another change's `file_path`. When a merged
   change needs file-backed storage, write a **new** payload file in the
   session's checkpoint directory (`create_payload_file_` pattern in
   `edit.cpp`).
3. **Snapshots are keyed by change count.** After renumbering, every existing
   snapshot key is wrong. Clear them; do not try to remap.
4. **`omega_visit_changes` sees only the back model.** Write a new internal
   enumerator; do not "fix" the public visitor (its semantics are relied on).
5. **Transform records are inside checkpoint models** as `changes.front()`
   (see `checkpoint_snapshot_change_count_`). When compacting the back model
   of a transform checkpoint, the TRANSFORM record is not eligible history —
   skip index 0.
6. **`update_` frees redo state** on any new positive-serial change. The
   shadow replay must run against a *scratch* model, never the live one, or
   you will destroy the user's redo stack before the install decision.
7. **Event interest is a signed 32-bit mask** combined in
   `session_manager.cpp` (`combine_event_interest`); `1 << 19` is fine, but
   update any `ALL_EVENTS`-style masks and the proto `SessionEventKind`
   mapping together.
8. **Inline payload limit.** Changes above
   `OMEGA_CHANGE_INLINE_PAYLOAD_LIMIT` (64 MiB default, `config.h`) are
   file-backed. Merged spans can cross that threshold in either direction;
   let the edit primitives decide storage (another reason for shadow replay).
9. **`0` is success for status APIs** (`omega_edit_status_result_is_success`).
   Do not return positive "count" values from the status-returning compact
   API; counts go in the result struct.
10. **The scratch/shadow session must not fire events.** Create it with a
    null event callback and zero interest, and give it the same checkpoint
    directory so payload files land in the managed location.

### 9.3 The shadow-replay lowering trick (strongly recommended)

Hand-constructing `omega_change_t` records, segments, serials, and undo
payloads is the highest-risk part of compaction. Avoid all of it:

1. Open the back model's backing file (`model->file_path`) read-only in a
   scratch model/session (same code path as `create_session_with_backing_file_`,
   or a private helper that builds a bare `omega_model_t`).
2. Apply the plan entries through the ordinary edit primitives
   (`omega_edit_delete` / `insert_bytes` / `overwrite_bytes`, REPLACE via
   delete+insert) — each op gets correct payload capture (undo data), correct
   segment splicing, and sequential serials automatically.
3. Replay the protected tail: for each preserved change record, re-apply it
   via `update_model_`-style splicing using the *existing* change object (the
   candidate's `changes` vector pushes the same `shared_ptr`).
4. Steal the scratch model's `changes` + `model_segments` as the candidate;
   fix up `change_serial_base` and renumber.

This reduces "lowering" to a replay loop over machinery that is already
heavily tested, and it makes validation almost tautological (the scratch
session's computed size/content *is* the candidate's).

### 9.4 Working with AI assistants on this codebase

- **Feed the constraints, not just the task.** When prompting for planner or
  compaction code, paste §3 (ground truth) and §9.2 (gotchas) into context;
  most plausible-looking generated code violates gotchas 1, 2, or 6.
- **Test-first per rule.** Have the assistant write the Catch2 cases from
  §10.1–§10.2 before the planner logic; the same-offset-insert case in particular
  kills the naive implementation immediately.
- **Small, landable diffs.** Each phase below is one PR-sized unit with its
  own tests; do not let a session sprawl across phases.
- **Verify against the real headers.** Assistants will invent field names
  (`session_ptr->changes_` from the superseded doc is wrong — history lives
  under `models_`). Ground every struct access in
  `impl_/session_def.hpp` / `impl_/model_def.hpp` / `impl_/change_def.hpp`.
- **Build/test loop:** configure with the existing CMake presets; core tests
  are Catch2 under `core/src/tests/` (`omegaEdit_tests.cpp` shows the
  conventions — `MAKE_PATH`, fixture files, session lifecycle patterns).

## 10. Testing strategy (brutal by design)

The optimizer rewrites history behind the user's back. The bar is therefore
not "the tests pass" — it is **bulletproof and invisible**. Pin the
visibility contract first; every test below enforces some clause of it.

**The invisibility contract.** After optimized export replay or online
compaction, an end user may observe exactly two things:

1. A smaller change count / renumbered serials (announced via
   `SESSION_EVT_CHANGELOG_COMPACTED`).
2. Coarser undo/redo steps for history **older than `highWaterCount`** —
   undoing past the protected tail jumps in span-sized units instead of
   per-edit units.

Everything else is a bug. Concretely, a user must **never** observe:

- any content difference, at any offset, at any file size
- viewport data changes or offset shifts at the moment of compaction
- undo/redo behaving differently **within** the protected tail
- undo producing content that never existed in the pre-compaction timeline
- spurious EDIT/UNDO/TRANSFORM events, missing or duplicated COMPACTED events
- stalls of unrelated RPCs, crashes, leaked or prematurely deleted
  payload/checkpoint files, or error-log noise during routine compaction

### 10.1 Harness first: oracles and invariant checkers

Build these as reusable helpers in `core/src/tests/changelog_test_support.hpp`
**before** any optimizer code. Every subsequent test composes them; an AI
assistant should be asked to write and review these first, because every
other test inherits their strictness.

| Oracle | Checks | How |
| ------ | ------ | --- |
| `assert_content_equal(a, b)` | byte-identical content | `omega_edit_save_segment_to_bytes` compare for small sessions; `omega_edit_save` to temp + `omega_util_compare_files` above `OMEGA_MEMORY_BUFFER_LIMIT` |
| `assert_model_valid(s)` | segment contiguity, change-ref integrity, size consistency | `omega_check_model` (`core/src/lib/check.cpp`) — run after **every** mutation in fuzz runs |
| `capture_undo_trajectory(s)` | full undo timeline | undo to zero, hashing content at each step; restore via redo; used by §10.4 |
| `EventRecorder` | exact event sequence | session/viewport callbacks appending `(event, payload)` to a vector; assert against expected traces |
| `CheckpointDirAudit` | filesystem hygiene | snapshot file list of `omega_session_get_checkpoint_directory()` before/after; diff must match expectation exactly (no strays, no missing) |
| `assert_serials_contiguous(s)` | serial arithmetic | walk models; verify `omega_session_get_change(serial)` round-trips for every serial |

Two cheap knobs make the harness vastly more punishing — set them in most
tests:

- `omega_session_set_change_inline_payload_limit(session, 8)` forces
  file-backed payloads for nearly every edit, exercising payload-file
  ownership (§3.5) constantly instead of only in rare >64 MiB tests.
- `omega_session_set_undo_snapshot_interval(session, k)` with k ∈ {0, 1, 7}
  shakes snapshot interactions (disabled / every change / prime stride).

### 10.2 Planner unit tests (`core/src/tests/changelog_tests.cpp`)

Pin the coordinate semantics first:

| Case | Expected optimized output |
| ---- | ------------------------- |
| empty session / single change | passthrough (0 or 1 entries) |
| `INSERT@5 "AB"`, `INSERT@5 "CD"` | one INSERT@5 `"CDAB"` |
| `INSERT@5 "AB"`, `INSERT@7 "CD"` | one INSERT@5 `"ABCD"` |
| `INSERT@0 "abc"`, `DELETE@0 len 3` | nothing (identity span) |
| `DELETE@10 len 3`, `DELETE@10 len 2` | one DELETE@10 len 5 |
| `OVERWRITE@4 "xxxx"`, `OVERWRITE@4 "yyyy"` | one OVERWRITE@4 `"yyyy"` |
| `DELETE@8 len 4`, `INSERT@8 "zz"` | one REPLACE@8 remove 4 insert `"zz"` |
| overlapping rewrites of the same region N times | single op bounded to the net-changed range (prefix/suffix trimmed) |
| edits interleaved around a TRANSFORM | two independent spans; TRANSFORM preserved verbatim between them |
| span exceeding `max_span_bytes` | split into subspans; content still correct |

Then the adversarial edge matrix — every row runs against empty, 1-byte,
odd-sized, and multi-gigabyte-sparse base documents:

- ops at offset 0, at EOF, and spanning the exact EOF boundary
- whole-document delete followed by rebuild from empty
- inserts into an empty session; delete-everything as the only history
- payload sizes exactly at, one below, and one above the inline/file-backed
  threshold (use the lowered limit from §10.1)
- spans that begin/end exactly at a TRANSFORM or model boundary
- a span whose net effect is identity except for one byte in the middle
  (prefix/suffix trim must not over-trim)
- degenerate `max_span_bytes` (1) — pathological subspan splitting must
  still be correct, merely unoptimal
- **determinism**: same input planned twice (and on Windows/Linux/macOS CI)
  yields byte-identical output
- **idempotence**: exporting, replaying, and re-exporting optimized output
  reproduces the same entries (a fixpoint after one pass)

### 10.3 Differential fuzzing (the workhorse)

```text
for seed in many:
    base   = random bytes (0..N)
    ses_a  = session(base); apply script = generate(seed, k ops)
    log    = export(ses_a, optimize=true)
    ses_b  = session(base); replay(log)
    assert_content_equal(ses_a, ses_b)
    assert entries(log) <= raw_entries(ses_a)
    assert_model_valid(ses_a); assert_model_valid(ses_b)
```

**Generator spec** (weights per profile; all sizes/offsets from mixed
distributions — clustered hot-spot, sequential "typing", uniform random):

| Op | typing | bulk | adversarial |
| -- | ------ | ---- | ----------- |
| small INSERT (1–16 B) | 60% | 10% | 20% |
| DELETE (1 B–128 KiB) | 15% | 20% | 20% |
| OVERWRITE | 10% | 30% | 20% |
| undo / redo burst (1–50) | 10% | 2% | 20% |
| transaction begin/end pair | 3% | 5% | 10% |
| builtin TRANSFORM | 1% | 3% | 5% |
| checkpoint create/destroy | 1% | 0% | 5% |

Rules of engagement:

- The op script is **serialized to a replay file** (JSON, one op per line)
  in the scratch directory whenever an assertion fails, and the seed is
  printed; a test-binary flag replays a saved script verbatim. A fuzz
  failure that cannot be reproduced deterministically is a harness bug.
- Shrinking: on failure, bisect the op script (drop halves, then individual
  ops) until minimal; assistants are good at writing this — demand it.
- Three modes: **PR** (≈2 min, fixed seed set + last N regression scripts),
  **nightly** (≈1 h, random seeds), **soak** (≥24 h before any attestation,
  zero failures required). Iterations controlled by env var.
- Every historical failure's minimized script is committed as a named
  regression case. The fuzz corpus only grows.

### 10.4 Undo/redo equivalence (the one permitted visible change)

This is the clause users will actually notice if we get it wrong, so it gets
its own oracle. For a session with `C` changes compacted with tail `H`:

1. **Within the tail — bit-exact.** Record `capture_undo_trajectory` for the
   last `H` steps before compaction. After compaction, the first `H` undo
   steps must produce the **identical content sequence**, step by step.
2. **Past the tail — coarse but truthful.** Each further undo step must land
   exactly on a content state that existed in the pre-compaction trajectory
   (assert membership in the recorded hash set), in the same order; the
   final full-undo state equals the span input / base content.
3. **Round-trip.** Undo all the way down, redo all the way up: content
   equals the pre-compaction tip; `omega_session_get_num_changes` and
   `num_undone_changes` are consistent at every step; `assert_model_valid`
   passes at every step.
4. **Branching.** Undo past the tail, apply a fresh edit (this frees redo
   state — §3.4), continue editing, compact again. All oracles hold.
5. **Transform boundaries.** Undo across a TRANSFORM after compaction still
   routes through `undo_transform_checkpoint_` correctly (checkpoint model
   pop, file retained for redo).

### 10.5 Compaction correctness, fault injection, and resource abuse

Baseline (every case ends with all §10.1 oracles):

- no-op when everything is inside the high-water tail; `-2` for open
  transaction / redo present / paused changes; result struct accurate
- serial contiguity and lookup after install; snapshots cleared and later
  rebuilt at the normal interval
- compaction twice in a row: second pass removes ~nothing and is harmless

Fault injection — add an internal, test-only failure-point hook to the
candidate builder (enumerated points, settable from tests): planner
allocation, scratch-model creation, payload-file creation, tail replay,
validation compare, pre-install precondition recheck. For **every** point:

- the session is byte-identical to before the attempt (content, change
  count, undo trajectory, serials)
- no event was emitted; no viewport was dirtied
- `CheckpointDirAudit` shows zero new files left behind

Environmental abuse, in the same spirit:

- checkpoint directory made read-only (payload/scratch creation fails
  cleanly); on Linux, a near-full tmpfs quota for genuine disk-full
- an old change's payload file deleted out from under the session before
  compaction (must fail cleanly, not crash, session still readable)
- histories of 100k and 1M changes (soak tier); a single span whose merged
  payload crosses the file-backed threshold both directions
- compaction of a session whose history is 100% incompressible (removal
  ratio ≈ 0) — correct no-op-ish result, no pathological memory

### 10.6 Invisibility at the server boundary

- **Viewport freeze-frame.** Create viewports across the document (including
  one floating, one at EOF), snapshot `omega_viewport_get_data` bytes and
  offsets, compact, re-fetch: offsets identical, bytes identical, exactly one
  `VIEWPORT_EVT`-level dirtying cycle, no data churn.
- **Event discipline.** `EventRecorder` over a compaction: exactly one
  `SESSION_EVT_CHANGELOG_COMPACTED` with a correct payload; zero EDIT, UNDO,
  TRANSFORM, or CLEAR events; subscribed gRPC event streams receive exactly
  one message.
- **Concurrency hammer (TSan build mandatory).** While a driver thread
  compacts in a loop, N client threads hammer viewport reads, `GetSegment`,
  `SearchSession`, and heartbeats on the *same and different* sessions. Pass
  criteria: no deadlock, no data race reported, every read returns either
  the (identical) content, and p99 stall of unrelated-session RPCs stays
  under a set budget (this doubles as a regression test for the
  global-mutex findings in `SHORTCOMINGS.md` item 3).
- **Destruction races.** `DestroySession` issued while the sweeper holds the
  compaction guard; sweeper ticking during server shutdown; both must
  resolve without crash, leak, or orphaned checkpoint directory.
- gRPC mapping: `-2` → `FAILED_PRECONDITION`, `-1`/`-3` → `INTERNAL`, result
  fields faithfully copied.
- TS round-trip: `exportChangeLog({optimize:true})` → `applyChangeLog` →
  fingerprints match; synthetic entries carry no `serial`.

### 10.7 Filesystem hygiene and platform matrix

`CheckpointDirAudit` runs in every compaction test: after compaction, the
only file-count changes permitted are payload files belonging to dropped
changes disappearing and new candidate payload files appearing; after
session destroy, the managed directory is empty. Platform notes to encode as
CI matrix legs, not comments:

- **Windows:** open files cannot be deleted — payload cleanup order matters;
  CRLF-rich content in the fuzz corpus; path length near `FILENAME_MAX`.
- **macOS/Linux:** clonefile/FICLONE snapshot paths; case-sensitive vs
  insensitive checkout of fixture files.
- All three run the PR fuzz tier; nightly soak runs at least Linux + Windows.

### 10.8 Performance gates (hard CI thresholds)

| Metric | Gate |
| ------ | ---- |
| plan + export, 100k-change session | < 1 s |
| online compaction, 100k changes (incl. validation) | < 2 s |
| export memory | O(#changes); measured peak < 2× raw-entry metadata size |
| edit-path overhead with policy **disabled** | zero (compiled-out or single branch); benchmarked, not asserted by eye |
| edit-path overhead with sweeper enabled | < 1% on the keystroke benchmark |
| streaming export of a 1M-entry log | bounded resident memory (no full-log buffering) |

### 10.9 CI matrix and the definition of bulletproof

Sanitizer legs: ASan+UBSan on all core tests; TSan on the server concurrency
hammer; debug builds run the paranoid content-fingerprint validation inside
the differential fuzz loop. Coverage gate on `changelog*.cpp`: no merge
below agreed branch coverage; every fuzz-found bug lands with its minimized
regression script.

Ship/attestation checklist (all must be true):

- [ ] all §10.2 unit + edge matrices green on all three platforms
- [ ] 24 h soak fuzz (typing + bulk + adversarial profiles), zero failures
- [ ] undo/redo equivalence suite green with tail ∈ {0, 1, 20, > history}
- [ ] every fault-injection point proves atomic rollback + zero file litter
- [ ] TSan hammer clean; unrelated-RPC stall budget met
- [ ] performance gates met; disabled-path overhead confirmed zero
- [ ] a human has diffed a real edited file: raw export replay vs optimized
      export replay vs compacted session — three identical files

## 11. Phased execution plan

Each phase is independently landable with tests; later phases do not modify
earlier public APIs.

### Phase 1 — Planner + optimized export (non-mutating)

*Scope:* `changelog.h`, `changelog.cpp` (enumerator, span partitioner,
piece-table planner, diff emitter), `omega_edit_export_changelog_optimized`,
streaming `ExportChangeLog` RPC, TS `exportChangeLog optimize` flag, MCP
parameter.

*Tests:* §10.1 harness helpers land here, then the §10.2 unit/edge matrices
and the §10.3 differential fuzz in export mode, TS round-trip, streaming RPC
cancellation.

*Exit:* optimized export is never larger than raw export, replays to an
identical fingerprint, and provably performs no session mutation
(const-correct API + a test asserting change count/content unchanged).

### Phase 2 — Candidate builder (no install)

*Scope:* internal candidate engine — shadow-replay lowering (§9.3), tail
replay, serial renumbering, validation helpers. No public API change; exposed
only to tests via an internal header.

*Tests:* §10.5 candidate-only subset (content equality, serial contiguity,
integrity checks, every fault-injection point) without ever installing.

*Exit:* the same planner output drives both export and a validated candidate
model; failure paths leave the source session untouched.

### Phase 3 — Online compaction

*Scope:* `omega_edit_compact_changes`, `SESSION_EVT_CHANGELOG_COMPACTED`,
atomic install, `CompactChanges` RPC with mutation guard, event forwarding
through the server subscription plumbing, TS/MCP/CLI surface.

*Tests:* full §10.4 (undo/redo equivalence), §10.5 (fault injection), §10.6
(server-boundary invisibility, TSan hammer), §10.7 (hygiene audits); the
§10.9 attestation checklist gates the release.

*Exit:* a live session compacts old history with unchanged content, valid
model integrity, working undo/redo semantics, and correct client
invalidation signaling.

### Phase 4 (optional) — Compaction policy

Automatic triggering is **policy, not core mechanism**. The core has no
timers and is single-threaded per session, so "quiet period" logic does not
belong there. Phase 4 ships a server-side policy engine that decides *when*
to call the Phase 3 mechanism (`omega_edit_compact_changes`), plus the same
policy shape exposed to clients that prefer to drive compaction themselves.
Ship only if Phase 3 usage shows real demand; measure first. Everything in
this subsection is additive — the core API does not change.

#### Phase 4.1 Where policy runs: a sweeper thread, not the edit path

Run policy in a background **compaction sweeper** thread inside
`EditorServiceImpl`, mirroring the existing `reaper_loop`
(`server/cpp/src/editor_service.cpp`) — same start/stop lifecycle, same
condition-variable shutdown. Rejected alternatives, for the record:

- *In-core trigger on change insertion* (the original doc's design): the core
  has no clock or threads, and compacting synchronously inside
  `omega_edit_insert_bytes` would add unbounded latency to an interactive
  keystroke. Rejected.
- *Post-RPC inline trigger* (compact at the end of a mutation RPC): simple,
  but the triggering RPC pays the full compaction latency, and the "quiet
  period" cannot be observed from inside the burst that crossed the
  threshold. Acceptable fallback; the sweeper is better.

Sweeper loop shape (per tick, default every `sweepIntervalMs`):

```text
ids = session_manager.snapshot_session_ids()        // under mutex_, copy, release
for sid in ids (bounded by maxSessionsPerSweep):
    if !should_compact(policy, counters[sid], now): continue
    guard = session_manager.try_begin_mutation(sid) // same guard as any edit RPC
    if !guard: continue                             // busy — try next sweep
    locked = session_manager.lock_session(sid)
    if !locked: continue
    rc = omega_edit_compact_changes(session, opts, &result)
    record_outcome(counters[sid], rc, result, now)  // feeds thrash guard
```

Hard rules, tied to earlier findings:

- The sweeper must **never** hold the global `SessionManager::mutex_` while
  waiting on a per-session `core_mutex` or while compacting (that is exactly
  the stall pattern flagged in `SHORTCOMINGS.md` item 3). Snapshot ids, then
  operate per session with the normal guard + lock sequence.
- A `-2` (blocked) result is not an error — the session was busy or had redo
  state; the counters stay armed and the next sweep retries.
- Policy needs a **mutation clock, not an activity clock**. `last_activity`
  on `SessionInfo` is touched by reads (viewport polling would keep the quiet
  period from ever expiring). Add a separate `last_mutation_time`, updated
  only where `try_begin_mutation`/`try_begin_transform` succeed, and an
  `eligible_change_hint` refreshed from `omega_session_get_num_changes` at
  guard release.

#### Phase 4.2 Proposed policy schema

One canonical shape, surfaced at three layers that override in order:
**server defaults (flags/env) → policy file → per-session override (RPC)**.
All layers use the same field names so an AI assistant can generate the
plumbing mechanically.

Canonical JSON (this is also the `--compact-policy-file` format):

```jsonc
{
  "enabled": false,             // master switch; default OFF
  "minEligibleChanges": 5000,   // eligible = active changes − highWaterCount
  "quietPeriodMs": 2000,        // no mutation for this long before compacting
  "sweepIntervalMs": 1000,      // sweeper tick
  "highWaterCount": 20,         // forwarded to omega_changelog_compact_options_t
  "minRemovalRatio": 0.10,      // thrash guard threshold (see 4.3)
  "cooldownMs": 30000,          // minimum time between compactions per session
  "maxCooldownMs": 600000,      // backoff cap for the thrash guard
  "maxSessionsPerSweep": 1      // bound sweep work per tick
}
```

Field reference and validation (reject the whole file on violation — the
server already fails fast on bad flag values in `main.cpp`):

| Field | Type | Default | Constraint | Meaning |
| ----- | ---- | ------- | ---------- | ------- |
| `enabled` | bool | `false` | — | Nothing runs unless true. |
| `minEligibleChanges` | int64 | `5000` | `>= 1` | Minimum changes past the high-water tail before a session is considered. |
| `quietPeriodMs` | int64 | `2000` | `>= 0` | Required mutation-free interval. `0` = compact even mid-burst (bulk-load profile). |
| `sweepIntervalMs` | int64 | `1000` | `>= 100` | Sweeper tick period. |
| `highWaterCount` | uint32 | `20` | `>= 0` | Protected undo tail; passed straight to the core options. |
| `minRemovalRatio` | double | `0.10` | `[0.0, 1.0]` | If a compaction removes less than this fraction of eligible changes, engage backoff. |
| `cooldownMs` | int64 | `30000` | `>= 0` | Per-session floor between compaction attempts. |
| `maxCooldownMs` | int64 | `600000` | `>= cooldownMs` | Cap for exponential backoff. |
| `maxSessionsPerSweep` | int | `1` | `>= 1` | At most this many compactions per tick, so sweeps never monopolize the server. |

CLI / environment mapping (follows the existing `main.cpp` conventions —
every flag has an `OMEGA_EDIT_*` env twin, flags win over env, both win over
the policy file):

| Flag | Env | Maps to |
| ---- | --- | ------- |
| `--auto-compact` | `OMEGA_EDIT_AUTO_COMPACT` | `enabled = true` |
| `--auto-compact-min-changes <n>` | `OMEGA_EDIT_AUTO_COMPACT_MIN_CHANGES` | `minEligibleChanges` |
| `--auto-compact-quiet-ms <ms>` | `OMEGA_EDIT_AUTO_COMPACT_QUIET_MS` | `quietPeriodMs` |
| `--auto-compact-high-water <n>` | `OMEGA_EDIT_AUTO_COMPACT_HIGH_WATER` | `highWaterCount` |
| `--auto-compact-cooldown-ms <ms>` | `OMEGA_EDIT_AUTO_COMPACT_COOLDOWN_MS` | `cooldownMs` |
| `--compact-policy-file <path>` | `OMEGA_EDIT_COMPACT_POLICY_FILE` | whole document |

Per-session override RPC (optional, second PR of the phase; lets a client
like the VS Code extension tune one session without redeploying the server):

```protobuf
message CompactionPolicy {
    optional bool enabled = 1;
    optional int64 min_eligible_changes = 2;
    optional int64 quiet_period_ms = 3;
    optional uint32 high_water_count = 4;
    optional double min_removal_ratio = 5;
    optional int64 cooldown_ms = 6;
}

rpc GetCompactionPolicy(GetCompactionPolicyRequest)
    returns (GetCompactionPolicyResponse);   // effective (merged) policy
rpc SetCompactionPolicy(SetCompactionPolicyRequest)
    returns (SetCompactionPolicyResponse);   // per-session override; unset
                                             // fields inherit server policy
```

All fields `optional` so an override sets only what it means to set; the
effective policy is server defaults overlaid with the session override.
`SetCompactionPolicy` is a metadata write — guard it like other lightweight
session RPCs (`lock_session` only; it does not mutate history).

#### Phase 4.3 Decision function and thrash guard

Per-session sweeper state:
`last_mutation_time`, `last_compact_time`, `current_cooldown_ms`
(starts at `cooldownMs`), `last_removal_ratio`.

```text
should_compact(policy, s, now):
    if !policy.enabled:                                   return false
    eligible = num_changes(session) - policy.highWaterCount
    if eligible < policy.minEligibleChanges:              return false
    if now - s.last_mutation_time < policy.quietPeriodMs: return false
    if now - s.last_compact_time  < s.current_cooldown_ms: return false
    return true

record_outcome(s, rc, result, now):
    s.last_compact_time = now
    if rc == -2:  return                       // busy; keep cooldown as-is
    if rc != 0:   log warn; s.current_cooldown_ms = policy.maxCooldownMs; return
    removed  = result.removed_change_count
    eligible = result.change_count_before - result.preserved_tail_count
    s.last_removal_ratio = eligible > 0 ? removed / eligible : 0
    if s.last_removal_ratio < policy.minRemovalRatio:
        // History doesn't compress (e.g. random-offset edits): back off
        // exponentially instead of rescanning every threshold crossing.
        s.current_cooldown_ms = min(s.current_cooldown_ms * 2, policy.maxCooldownMs)
    else:
        s.current_cooldown_ms = policy.cooldownMs          // reset on success
```

The thrash guard matters because compaction cost is O(history) even when it
removes nothing: a session of random single-byte overwrites across a large
file compresses poorly, and without backoff the sweeper would re-plan the
same history every `minEligibleChanges` changes.

Telemetry: log one structured line per compaction
(`session, before, after, removed, ratio, duration_ms, rc`) and consider a
`compaction_count`/`compacted_changes_total` pair on `GetHeartbeat` later.

#### Phase 4.4 Worked examples

**Example A — interactive editor (VS Code), default profile.** User types
~12,000 single-byte inserts into a log file over ten minutes, mostly
appending, occasionally correcting. Policy: defaults with `enabled: true`.

| t | Event | Sweeper decision |
| --- | ----- | ---------------- |
| 0–600 s | Keystroke mutations arrive | `quietPeriodMs` never satisfied → defer (matches the "user actively editing" row of the old design, without any core involvement) |
| 602 s | User pauses; 12,014 active changes, 20 protected | eligible = 11,994 ≥ 5,000, quiet ≥ 2 s → compact |
| 602 s | `omega_edit_compact_changes` | typed runs coalesce; result: `before=12,014`, `after=31` (≈10 net REPLACE/INSERT ops + tail 20 + transform record), `removed=11,983`, ratio ≈ 1.0 |
| 602 s | `SESSION_EVT_CHANGELOG_COMPACTED` | extension drops cached serials ≥ `first_invalid_serial`, re-reads change count; undo still steps through the last 20 keystrokes one by one |

**Example B — agent bulk import, aggressive profile.** An MCP agent replays a
50k-entry change log via `applyChangeLog`. Interactivity doesn't matter;
memory does. Policy file:

```json
{
  "enabled": true,
  "minEligibleChanges": 20000,
  "quietPeriodMs": 0,
  "cooldownMs": 5000,
  "minRemovalRatio": 0.25,
  "highWaterCount": 0
}
```

`quietPeriodMs: 0` lets the sweeper compact between transaction batches
mid-import (the mutation guard makes each attempt safe — if a batch is in
flight, `try_begin_mutation` fails and the sweeper just retries next tick);
`highWaterCount: 0` because nobody will interactively undo an agent import.

**Example C — thrash guard engaging.** A fuzzing client scatters random
single-byte overwrites across a 4 GiB session. First compaction: eligible =
5,000, removed = 130, ratio 0.026 < 0.10 → cooldown doubles 30 s → 60 s →
120 s → … capped at 600 s. The session keeps working; the server stops
burning CPU re-planning incompressible history. One later compaction with
ratio ≥ 0.10 resets the cooldown to 30 s.

**Example D — client-side policy instead of server policy.** A deployment
leaves the server sweeper disabled and lets the VS Code extension decide:

```jsonc
// VS Code settings.json
"omegaEdit.autoCompact": {
  "enabled": true,
  "minEligibleChanges": 5000,
  "quietPeriodMs": 2000        // evaluated against the extension's own
}                               // edit stream, then calls CompactChanges
```

The extension already knows when the user is idle; it simply calls the
public `CompactChanges` RPC. Both modes can coexist — the mutation guard and
cooldown make duplicate triggers a cheap no-op (`-2` or ratio ≈ 0).

*Scope:* sweeper thread + counters in `EditorServiceImpl`/`SessionInfo`,
policy parsing (flags/env/file) in `main.cpp` following its existing
`parse_*` helpers, optional `Get/SetCompactionPolicy` RPCs, telemetry log
line, VS Code setting.

*Tests:* policy unit tests for `should_compact`/`record_outcome` (threshold,
quiet period, cooldown, backoff sequence, ratio math); a server test that a
busy session (guard held) is skipped and retried; a config test rejecting
invalid policy files; an end-to-end test that a quiet session above threshold
gets compacted exactly once and emits one event.

*Exit:* with policy disabled, zero behavior change; with defaults enabled,
Example A's timeline reproduces in an integration test, and Example C's
backoff is observable in the telemetry log.

## 12. Why the original design was rejected (do not resurrect)

Kept short, with the concrete counterexamples an implementer needs:

1. **Adjacent pattern rules ignore coordinate shift.** Its merge table said
   `INSERT@O A` + `INSERT@O B` → `INSERT@O AB`; the document actually contains
   `BA` (§9.2#1). Its "dead-write" rule for same-offset INSERTs deletes user
   data (both inserts' bytes remain in the document). Its no-op rule
   (`INSERT D` then `DELETE |D|` at `offset+|D|`) deletes the *wrong range* —
   the inserted bytes live at `[offset, offset+|D|)`.
2. **"Interruptible scan + atomic vector swap" solves a nonexistent problem.**
   The core is single-threaded per session (§3.8); nothing can dirty the
   vector mid-scan, and the server's `core_mutex` already serializes. The
   design's retry loop, `-2` livelock code, and microsecond "read-only
   window" analysis modeled concurrency the core does not have.
3. **Swapping only `changes` corrupts the session.** Segments and snapshots
   hold `shared_ptr`s into the change vector (§3.3); serial lookup is index
   arithmetic (§3.2); undone changes live in a separate vector (§3.4). A
   changes-only swap breaks reads, undo, and `omega_session_get_change`.
4. **Transform dedup is unsafe.** Plugins are opaque; two identical-looking
   transforms are not provably idempotent. Transforms are barriers, period.
5. **It assumed a stored REPLACE kind and a flat `session_ptr->changes_`
   member.** Neither exists (§3.7, §3.1).

The revised document fixed all of the above; this document additionally
specifies the emission diff, the shadow-replay lowering, payload-file
ownership rules, the concrete server/TS integration points, and the
test-first execution plan.

## 13. Open decisions (defaults chosen)

| Decision | Default |
| -------- | ------- |
| Synthetic export serials | Omit `serial` entirely on synthetic entries. |
| Compaction scope | Back model only in v1. |
| Transform handling | Hard barrier; preserved exactly; no dedup. |
| Redo state | Blocks compaction (`-2`). |
| Snapshots after compaction | Cleared; rebuilt by the normal interval. |
| Event | `SESSION_EVT_CHANGELOG_COMPACTED = 1 << 19`, one per compaction. |
| OVERWRITE vs REPLACE emission | `prefer_overwrite_form` option; default REPLACE. |
| Auto-compaction | Phase 4 server sweeper + policy schema (§Phase 4.2); disabled by default. |

## 14. Out of scope for initial delivery

- Transform deduplication or replay-based transform folding.
- Compaction across model/checkpoint boundaries.
- Sparse-serial lookup redesign (compaction renumbers instead).
- Low-lock compaction via deep-copied history snapshots (design sketch lives
  in the revised doc §7.4; revisit only if serialized compaction shows up in
  profiles).
- A batch `ApplyScript` RPC for cheaper replay (worthwhile, but independent).
