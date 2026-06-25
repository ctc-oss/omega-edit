# OmegaEdit — Shortcomings, Bugs, Gaps & Missed Opportunities

Living backlog of issues found while reviewing the `codex/checkpoint-change-log-actions`
work, the follow-up audit, and the surrounding transform / change-log / checkpoint code.
Grouped by theme, roughly prioritized within each group. File:line references point at the
offending code.

Status notes:
- `Fixed` means the current `codex/fix-transform-content-changed` branch addresses the
  item directly.
- `Partially fixed` means the branch reduces the risk but leaves a larger design gap.
- `New` means the item is validated against the current tree but has not been addressed.

---

## A. Transforms (correctness — "sometimes don't run / don't create changes")

This is the reported bug. Root causes are spread across all three layers.

1. **`content_changed` is inferred, never confirmed against the core.**
   `server/cpp/src/editor_service.cpp:1834` sets
   `content_changed = operation_replaces && (effective_length > 0 || replacement_length > 0)`.
   It does **not** check whether `omega_edit_replace_bytes` actually recorded a change
   (no change-serial / change-count delta is consulted). A replace whose replacement is
   byte-identical to the source, or a core replace that no-ops, still reports
   `content_changed = true` — and the reverse can happen too. The server should report
   change-happened based on the core change count before/after, not arithmetic on lengths.
   **Status: Fixed.** The server now reports `content_changed` from observed session
   change/checkpoint/file-size deltas around the transform operation.

2. **Core silently treats "no replacement" as success with no change.**
   `core/src/lib/transform.cpp:1001-1006`: when `requested_length == 0 && replacement_length == 0`
   the code returns `0` (success) without recording any change. The plugin "ran" but nothing
   happened, and nothing upstream can distinguish that from a real edit. There is no
   change-count/serial returned from the apply call to disambiguate.
   **Status: Fixed.** Replace/inspect plugins must now set the no-content-change response
   flag for intentional zero-length no-ops; ambiguous zero-length replace responses fail.

3. **Client-side no-op detection *undoes* real work and is silently size-gated.**
   `vscode-extension/src/hexEditorProvider.ts:2296-2322`. After a successful transform the
   extension re-reads the range, compares bytes, and if equal calls `undo()`. Problems:
   - The comparison is only performed when both sides are `<= MAX_TRANSFORM_NOOP_COMPARE_BYTES`
     (1 MiB, line 145). Above that, `canCompareNoOp` is false, the change is *kept* even if it
     is a true no-op — so behavior flips based on size (a "limit" leaking into correctness).
   - When it *does* fire, it issues an `undo()` to roll back the just-applied change. If the
     plugin legitimately replaced bytes with equal bytes (e.g. idempotent normalize), the user
   sees "nothing happened" even though the operation was valid. This is almost certainly a
   contributor to "transforms don't create changes when they should."
   - The undo is a second async round-trip gated on `waitForSessionSync`; if sync versioning
     races, the wrong change can be undone.
   **Status: Fixed.** The extension no longer performs the post-transform byte compare or
   undoes a completed transform as a client-side no-op.

4. **Transform is recorded only as a generic `REPLACE` in local history, losing identity.**
   `vscode-extension/src/hexEditorProvider.ts:2324-2333` records the transform result as a
   `REPLACE` change record with raw replacement bytes. The plugin id and options are dropped.
   See gap G1 below (first-class Transform change kind).

5. **Whole-replacement is buffered in memory as hex.**
   The extension reads the entire replacement back via `getSegment` and stores it hex-encoded
   in the in-memory change log (2× the byte size). For large transforms this is a latent OOM
   and conflicts with the large-file promise. (Same hex-doubling appears in the AI change log.)
   **Status: Partially fixed.** Large transform replacements are no longer read back into
   local VS Code history above the splice cap; general hex/in-memory change-log storage remains.

6. **No surfaced reason when a transform genuinely does nothing.**
   When `content_changed` is false there is no message explaining *why* (schema mismatch vs.
   inspect-only plugin vs. true no-op). The webview just shows the transform "completed" with
   no change. Users read this as "the transform didn't run."
   **Status: Fixed.** The webview/toast path now distinguishes inspect-only calculations from
   true no-content-change transforms, and bitwise/case-change identity paths report
   no-content-change from the server.

7. **Transform concurrency guard returns INTERNAL, not a typed state.**
   `editor_service.cpp:1739` funnels "transform already in progress" through
   `status_for_session_operation_start`, which can surface as a generic error string the UI
   only pattern-matches on. Easy to misclassify as a failure.
   **Status: Fixed.** The server operation-start guard maps transform/mutation busy states to
   `FAILED_PRECONDITION`, and transform precondition rejection is now covered by client
   integration coverage.

---

## B. Atomicity / transactions (first-class, reversible operations)

8. **`applyChangeLog` is not atomic (AI).**
   `packages/ai/src/service.ts` applies entries in a bare `for` loop of `insert/del/overwrite/replace`
   with no transaction and no rollback. A failure midway leaves a partially-applied session
   and no record of how far it got. Should wrap in a begin/end transaction (core supports
   transaction state — see `omega_session_get_transaction_state` usage in the server) or, at
   minimum, checkpoint before and restore on failure.
   **Status: Partially fixed.** AI change-log apply now runs non-empty logs inside a server
   transaction; explicit checkpoint rollback / applied-count reporting on failure is still open.

9. **`applyChangeLog` is not atomic (extension).**
   `vscode-extension/src/hexEditorProvider.ts` `applyChangeLogEntries` has the same
   sequential, non-transactional shape.
   **Status: Partially fixed.** Extension import now applies non-empty logs inside one server
   transaction and records the applied entries as one local undo/redo transaction; explicit
   rollback on mid-apply failure is still open.

10. **Transforms are not atomic/first-class.** (User-requested flag — see G1.)
    A transform that internally expands/shrinks/replaces is recorded as one opaque `REPLACE`
    instead of a reversible, replayable `Transform` operation. Undo works by byte-replacement,
    not by re-running/inverting the transform, so the change log cannot reproduce the transform
    on a *different* file (the whole point of a portable change log).

11. **Checkpoint rollback names must not promise snapshot restore semantics.**
    The checkpoint operation calls `destroyLastCheckpoint`; there is no snapshot/restore
    semantics here, just rollback of the current checkpoint model.
    **Status: Fixed.** The AI toolkit/CLI/MCP tool, VS Code command/API/webview protocol,
    toolbar, progress, and toasts now use rollback-checkpoint naming throughout.

12. **Checkpoint creation is unconditional and unbounded.**
    No cap on number of checkpoints, no dedupe, no "checkpoint only if dirty since last."
    Repeated `createCheckpoint` calls grow state without feedback on cost.
    **Status: Partially fixed.** VS Code now skips explicit checkpoint creation when the
    session has no dirty changes and reports that no checkpoint was needed; server/API caps and
    dedupe remain open.

---

## C. UX / notifications

13. **Checkpoint & change-log confirmations land in the results pull-down, not a toast.**
    (User-requested flag.) `hexEditorProvider.postSessionActionComplete` posts
    `sessionActionComplete`, and `App.svelte:2124-2137` writes it into `transformFeedback`
    (the transform/results feedback strip, rendered at `App.svelte:2147`). For
    `rollbackCheckpoint` / session rollback the confirmation should pop as a VS Code toast
    (`showInformationMessage`) instead of (or in addition to) the inline strip.
    Note the host already fires a toast for some actions, so the two paths are inconsistent:
    some actions toast + strip, some strip-only. Pick one rule and apply it uniformly.
    **Status: Fixed.** Session action completions now rely on host toasts and no longer
    populate the transform/results feedback strip; the Recent Transform Results control is
    result-history only and no longer borrows transient status text.

14. **Inconsistent "rollback" vs "restore" vocabulary across the codebase.**
    The checkpoint path previously mixed rollback and restore vocabulary for closely-related
    concepts, confusing users and future maintainers.
    **Status: Fixed.** The checkpoint command/API/protocol/tooling path now consistently uses
    rollback terminology; remaining restore wording is limited to unrelated backup restore and
    future true snapshot-restore work.

15. **Cancelled actions are reported as success-ish.**
    `exportChangeLog` cancel returns `{ cancelled: true }` but still posts a
    `sessionActionComplete` that the webview renders as feedback text; easy to misread.
    **Status: Fixed.** Cancelled session actions now clear inline feedback instead of rendering
    success-like completion text.

16. **No progress for `exportChangeLog`.**
    `collectChangeLogEntries` loops `getChangeDetails` serial-by-serial (one RPC per change,
    up to 100k). For large sessions this is a long, silent, blocking operation with no progress
    notification (apply has a progress bar; export does not).
    **Status: Fixed.** VS Code export now wraps change-detail collection in a progress
    notification.

---

## D. The "remove limits" promise (hard caps that betray the mission)

17. **JS `Number.isSafeInteger` ceiling (2^53) on every offset/length.**
    `packages/client/src/safe_int.ts` throws on any offset/length/count beyond 2^53 on both
    input and output. The core is 64-bit (`int64_t`). Any file or offset past ~9 PB is
    unreachable from the TS client. Defensible today, but it is a real ceiling that contradicts
    "remove limits." Consider `BigInt` on the boundaries that can legitimately exceed 2^53.

18. **Change-log entry/byte caps.**
    AI: `MAX_CHANGE_LOG_ENTRIES = 100_000`, `MAX_CHANGE_LOG_ENTRY_BYTES = 32 MiB`,
    `MAX_CHANGE_LOG_BYTES = 96 MiB` (`packages/ai/src/service.ts`). Extension mirrors these
    (`hexEditorProvider.ts:146-148`). A session with >100k changes simply cannot export a log,
    and `foldedChangeCount` silently hides the dropped ones (see E20). For a tool whose pitch is
    massive files, a 100k-change ceiling is low.

19. **In-memory hex doubling everywhere.**
    Change-log data is stored/transported as hex strings (2× bytes) in both AI and extension,
    and transform replacements are fully materialized client-side. Streaming / chunked /
    file-backed change logs would honor the large-file promise.

---

## E. Change-log fidelity & format

20. **Export is lossy and silently so.**
    `exportChangeLog` reconstructs entries from `getChangeDetails`, which only yields
    INSERT/DELETE/OVERWRITE — never REPLACE or Transform. Changes absorbed into a checkpoint
    baseline are dropped and only counted in `foldedChangeCount`. The exported log therefore
    cannot faithfully reproduce a session that used checkpoints or transforms. This is presented
    in the README as a feature ("portable…apply to a fleet of files"), which overstates fidelity.

21. **No schema validation / versioning enforcement on import.**
    `normalizeChangeLogEntries` accepts an array *or* `{changes:[...]}` but does not check
    `format`/`version` fields it itself writes. A v2 document or a foreign JSON array would be
    applied (or partially applied) without a compatibility gate.
    **Status: Fixed.** Wrapped imports must now match the OmegaEdit change-log format and
    version; the legacy bare-array form is still accepted.

22. **`groupId` and `serial` are carried but not honored.**
    Import preserves `serial`/`groupId` (`service.ts` normalize) but apply ignores them — no
    grouping/transaction reconstruction, serials are not validated for monotonicity or gaps.
    **Status: Fixed.** AI and VS Code imports now reject partial, non-contiguous, or gapped
    serial metadata; `groupId` metadata is validated for contiguous groups and preserved on
    applied VS Code history records while the import remains one atomic server transaction.

23. **Error sniffing by string match.**
    `isMissingChangeDetailsError` matches `'NOT_FOUND'` / `'change not found'` substrings
    (AI and extension). Brittle: depends on server message wording, not gRPC status codes.
    **Status: Fixed.** `getChangeDetails` preserves the original gRPC error as `cause`, and
    AI/extension importers now classify missing change details by gRPC status code only.

24. **`getChangeDetails` request sends dummy fields.**
    `packages/client/src/protobuf_ts/change.ts` fills `sessionEventKind`, `computedFileSize`,
    `changeCount`, `undoCount` with zeros just to satisfy the shared request message. Harmless
    now but couples a read to an event-shaped message; a stricter server could reject it.

---

## F. Testing / build confidence

25. **No test asserts the transform-no-op / content_changed path.**
    The reported bug area (A1–A3, A6) has no regression test. Add coverage for: identical-bytes
    replace, inspect-only plugin, >1 MiB replace (no-op gate flips), and content_changed accuracy.
    **Status: Fixed.** Added regression coverage for identical-byte transforms,
    bitwise/case-change identity transforms, inspect-only/no-content-change reporting, and a
    >1 MiB no-op transform to guard the former client-side size gate.

26. **Branch could not be type-checked/tested here.**
    Node is v22 in this environment; repo requires 24, deps not installed. CI must run
    `yarn workspace @omega-edit/ai test`, vscode-extension build+tests, and `yarn lint` before merge.
    **Status: Fixed.** Local checks now run through `nvm` on Node 24; PR CI is queued.

27. **`applyChangeLog` round-trip test only covers the happy path.**
    `packages/ai/tests/specs/toolkit.spec.ts` exercises a single OVERWRITE. No test for
    multi-entry logs, REPLACE entries, partial-failure/atomicity, or the entry/byte caps.
    **Status: Partially fixed.** Added malformed wrapped-change-log import coverage; multi-entry,
    REPLACE, partial-failure, and cap tests remain open.

---

## G. Gaps / future work (noted, not to implement now)

- **G1 — First-class `Transform` change kind.** (User-requested.) Treat Transform as a peer of
  Insert/Delete/Overwrite/Replace: a change record `{ kind: 'TRANSFORM', offset, length,
  pluginId, optionsJson }` carrying exactly the arguments needed to *re-run* the transform,
  so the change log can reproduce it on another file rather than baking in resulting bytes.
  Requires: core/proto change-kind support, server to record transform-as-change, client wrapper,
  AI + extension change-log encode/decode, and undo-by-inverse-or-rerun semantics.
- **G2 — True checkpoint restore** (snapshot + restore-to), distinct from drop-last-checkpoint.
- **G3 — Streaming / file-backed change logs** to drop the in-memory and entry-count caps.
- **G4 — BigInt offsets/lengths** at the TS boundary to lift the 2^53 ceiling.
- **G5 — Transactional `applyChangeLog`** (begin/end transaction or checkpoint-guarded) for atomicity.
- **G6 — gRPC status-code based error handling.** **Status: Fixed.** Missing change-detail
  handling now follows preserved gRPC status codes instead of message text.

---

## H. Concurrency / lock ordering

28. **Session event subscription lock order can deadlock against core callbacks.**
    `server/cpp/src/session_manager.cpp:417-460` builds session event notifications while
    taking `session_subscription_mutex`. Core mutations call into the session event callback
    while the handler already holds `core_mutex` through `lock_session`, so that path is
    effectively `core_mutex -> session_subscription_mutex`. Subscription management takes the
    reverse order: `subscribe_session_events` takes `session_subscription_mutex` and then
    `core_mutex` to update event interest (`session_manager.cpp:963-982`), and the targeted
    unsubscribe path does the same (`session_manager.cpp:1011-1034`). A concurrent edit event
    plus subscribe/unsubscribe can therefore park each thread on the other's lock. The session
    event path needs one consistent lock order, or the core event-interest update needs to be
    split so subscription bookkeeping is never held while acquiring `core_mutex`.
    **Status: New.**

29. **Transform progress publishing relies on an implicit core lock.**
    `server/cpp/src/session_manager.cpp:777-816` reads `omega_session_get_computed_file_size`,
    `omega_session_get_num_changes`, and `omega_session_get_num_undone_changes` from
    `info->session` without taking `core_mutex`. Today `ApplyTransformPlugin` calls it while a
    `LockedSession` is alive (`editor_service.cpp:1742-1865`), but the method is exposed on
    `SessionManager` with no contract enforcing that precondition. A future caller could race
    session mutation or destruction and make progress reporting touch the non-thread-safe core
    session outside its guard.
    **Status: New.**

---

## I. Session / subscription lifecycle

30. **Managed checkpoint root can be left behind on per-session directory creation failure.**
    `create_managed_checkpoint_directory` creates and stores `managed_server_root_`, then creates
    a per-session checkpoint directory under it (`session_manager.cpp:361-395`). If the server
    root succeeds but the per-session directory creation fails, `create_session` erases the
    pending session and returns (`session_manager.cpp:580-586`) without calling
    `cleanup_managed_server_root_if_empty`. That can strand an empty managed root until a later
    cleanup pass or process exit.
    **Status: Fixed.** Session creation now attempts managed-root cleanup after erasing the
    pending session when per-session checkpoint directory creation fails.

31. **Viewport recreation drops the old subscription before the new one is confirmed.**
    `packages/client/src/subscriptions.ts:224-247` cancels the current viewport subscription
    before `subscribeViewportEvents` for the replacement viewport has succeeded. The caller
    already documents the consequence in `editor_scoped_session.ts:232-242`: if
    `setViewportId` fails, the newly-created viewport is destroyed, but the old viewport stream
    has already been cancelled and the editor is left without active viewport events until
    another recreation succeeds. The handoff should keep the old subscription live until the new
    stream is confirmed.
    **Status: Fixed.** Client viewport subscription handoff now keeps the active stream alive
    until the replacement stream subscribes successfully.

32. **Explicit viewport unsubscribe clears but does not close the active queue.**
    `SessionManager::unsubscribe_viewport_events` clears the viewport event queue and disables
    core interest, but leaves the queue open (`session_manager.cpp:1060-1075`). The streaming RPC
    only exits when the client context is cancelled or the queue closes
    (`editor_service.cpp:2071-2116`), while the explicit `UnsubscribeToViewportEvents` RPC just
    calls that clear-only path (`editor_service.cpp:2127-2135`). A client that uses explicit
    unsubscribe while a stream is still open can leave the old stream blocked, and a later
    resubscribe reuses the same queue so multiple readers can compete for events.
    **Status: Fixed.** Viewport event streams now use per-subscription queues; explicit
    unsubscribe closes active viewport queues, while stream cleanup removes only the queue for
    that stream.

33. **Subscription callbacks have no backpressure or sequential delivery contract.**
    `packages/client/src/subscriptions.ts:147-161` schedules every incoming event handler through
    a detached promise. Errors are routed to `onError`, so they are not silently swallowed, but
    async `onEvent` work is not awaited before the next event is dispatched. Callers that do
    asynchronous model or UI work can observe overlapping callbacks and out-of-order completion
    even though the underlying stream delivered events in order.
    **Status: Fixed.** Subscription event callbacks now run through a per-stream promise chain,
    preserving delivery order and avoiding overlapping async handler execution.

---

## J. Validation / configuration hygiene

34. **Caller-provided IDs and paths are only minimally validated.**
    Desired session IDs and viewport IDs are accepted so long as they do not contain the `:`
    separator (`session_manager.cpp:552-563`, `session_manager.cpp:848-866`), and most other
    RPCs accept `session_id` strings directly for map lookups and error messages. The client
    wrappers also pass `filePath`, `sessionIdDesired`, and `checkpointDirectory` through with no
    shared maximum length, NUL-character, printable/opaque-ID, or log-safe policy. Generated IDs
    are bounded, but caller-supplied IDs and paths can still be excessively large or log-hostile,
    and tightening creation-time validation would contain that shape for all later operations.
    **Status: New.**

35. **Default server host/port constants are duplicated across packages.**
    `packages/client/src/server.ts:47-48`, `packages/client/src/protobuf_ts/client.ts:36-37`,
    and `packages/ai/src/constants.ts:1-2` each define `127.0.0.1:9000` independently. A future
    default change can silently diverge between the legacy client, protobuf-ts client, and AI
    tooling unless the defaults move to one shared source.
    **Status: Fixed.** Default server host/port values now live in the shared client constants
    module; the legacy client, protobuf-ts client, and AI tooling consume that single source.

36. **Change-log JSON import is byte-bounded but not structure-bounded.**
    `packages/ai/src/service.ts:254-268` caps change-log file size and entry count, then parses
    the full file with `JSON.parse` before validating shape. A deeply nested but byte-small JSON
    document can still spend parser/normalizer CPU or trip runtime recursion limits before the
    normal entry caps are enforced. A streaming parser, nesting-depth guard, or pre-parse
    structural limit would make the import boundary less fragile.
    **Status: Fixed.** Change-log file imports now reject JSON nesting deeper than the supported
    limit before calling `JSON.parse`.

37. **Unary protobuf-ts RPCs have connection readiness deadlines but no per-call deadlines.**
    `packages/client/src/protobuf_ts/client.ts:70-84` applies a 10-second deadline to
    `waitForReady`, but the individual unary wrappers in `protobuf_ts/session.ts`,
    `protobuf_ts/change.ts`, and `protobuf_ts/viewport.ts` call methods such as `saveSession`,
    `replaceSession`, and `getSegment` without per-call gRPC deadlines or cancellation handles.
    Once a client is considered ready, a hung server-side unary can keep the returned promise
    pending indefinitely.
    **Status: Fixed.** Hand-written protobuf-ts unary wrappers now pass a default deadline, with
    `OMEGA_EDIT_UNARY_RPC_TIMEOUT_MS=0` available to disable it when needed.

---

## K. Core memory / lifetime correctness

38. **`omega_data_t` ownership is external and implicitly copyable.**
    `core/src/lib/impl_/data_def.hpp:31-34` defines `omega_data_t` as a trivially copyable union
    whose active storage is inferred from a separate length/capacity value stored in the owning
    `omega_change_t` or `omega_segment_t`. Accidental value copies of `omega_change_t`,
    `omega_segment_t`, or the union itself duplicate the raw pointer without duplicating ownership
    state, while destruction is manual through `omega_data_destroy_`. The current code avoids many
    obvious copies, but the type does not make ownership or non-copyability explicit, leaving a
    latent double-free/aliasing trap for future maintenance.
    **Status: New.**

39. **Reverse change visitors leak their iterator allocation.**
    `core/src/lib/visit.cpp:77-84` allocates `change_iter.riter_ptr` for reverse iteration, but
    `omega_visit_change_destroy_context` deletes only `change_iter.iter_ptr`
    (`core/src/lib/visit.cpp:132-137`). A reverse visit context therefore leaks one
    `omega_changes_t::const_reverse_iterator` each time it is destroyed.
    **Status: Fixed.** Reverse visit contexts now delete `riter_ptr`; forward contexts continue
    deleting `iter_ptr`.

40. **Internal change destruction casts away const ownership.**
    Change history is stored as `std::shared_ptr<const omega_change_t>`, but cleanup paths in
    `core/src/lib/edit.cpp:588-599` use `const_cast` to call `omega_data_destroy_` on change data.
    The implementation currently creates non-const heap objects before storing them as const
    shared pointers, so this works by convention, but the type system advertises immutable changes
    while destruction still mutates their internals. Internal ownership should stay mutable or move
    byte ownership into a self-destroying RAII member.
    **Status: New.**

41. **C API allocation failures can escape through C entry points inconsistently.**
    `omega_data_create_` throws `std::bad_array_new_length` for unrepresentable capacities
    (`core/src/lib/impl_/data_def.hpp:45-48`) and other paths allocate with throwing `new[]`.
    Some entry points, such as `omega_segment_create`, catch allocation failures and return
    `nullptr`, while edit/change creation helpers in `core/src/lib/edit.cpp` do not consistently
    translate allocation exceptions into C-style error returns. The public C API should not rely
    on C++ exceptions escaping safely across callers.
    **Status: New.**

42. **`omega_session_get_file_path` returns an internal string pointer without a lifetime contract.**
    `core/src/lib/session.cpp:105` returns `models_.back()->file_path.c_str()` directly. The
    header says only that callers receive the file path, not that the pointer is borrowed and can
    be invalidated by later session mutation, save/checkpoint model changes, or session
    destruction. Either the documentation needs a clear borrowed-pointer lifetime note or the API
    should return caller-owned storage.
    **Status: Fixed.** The public header now documents the returned path as a session-owned
    borrowed pointer with mutation/destruction lifetime limits.

---

## L. Transform plugin hardening / performance

43. **Plugin option regex validation recompiles unbounded patterns.**
    `core/src/lib/transform.cpp:503-508` reads a `pattern` string from a plugin argument schema
    and constructs `std::regex(pattern_text)` during each validation. There is no pattern length
    cap, compiled-regex cache, or timeout/backtracking guard. A plugin schema with a pathological
    pattern can make option validation unexpectedly expensive, and repeated transforms pay the
    regex compilation cost every time.
    **Status: Partially fixed.** Schema regex validation now rejects oversized patterns and caches
    compiled regex objects across validation calls; interruptible evaluation/backtracking limits
    remain open.

44. **File-backed plugin allocation tracking is process-global.**
    Large plugin allocations are tracked through the process-wide
    `g_file_backed_allocations` map and `g_file_backed_allocations_mutex`
    (`core/src/lib/transform.cpp:659-661`). This serializes allocation bookkeeping across all
    sessions and plugins, so unrelated transforms on different sessions still contend on one
    global lock. Per-operation or per-registry ownership would reduce contention and make cleanup
    boundaries clearer.
    **Status: New.**

---

## M. API design / portability

45. **Event interest masks use signed integers and `ALL_EVENTS (~0)`.**
    `core/src/include/omega_edit/fwd_defs.h:64-67` defines `ALL_EVENTS` as `~0`, while session
    and viewport interest APIs store masks in `int32_t`. The current event values fit below the
    sign bit, but the all-events sentinel relies on signed representation and differs from the
    TypeScript `ALL_EVENTS = ~NO_EVENTS` expression's 32-bit JavaScript behavior. A `uint32_t`
    mask or explicit all-events constant would make the ABI clearer.
    **Status: New.**

46. **Edit APIs mix serial-returning and status-code-returning conventions.**
    Core mutators such as `omega_edit_insert`, `omega_edit_delete`, and `omega_edit_replace`
    return a positive change serial on success, `0` for no-op/rejected-without-error cases, and
    `-1` for invalid arguments. Batch/checkpoint helpers such as
    `omega_edit_replace_bytes_checkpointed`, `omega_edit_apply_script`, and
    `omega_edit_replace_all_bytes` return `0` on success and non-zero on failure. Callers cannot
    use one success predicate across editing APIs, and mistakes can invert success handling.
    **Status: New.**

47. **C-string and byte edit APIs encode different length semantics.**
    The C-string helpers infer a length with `strlen` when the length argument is zero, while the
    `_bytes` variants treat length zero as an explicit no-op. The current header documents the
    difference, but the overload-like API shape remains easy to misuse for buffers that may contain
    embedded NUL bytes or for callers expecting zero length to mean the same thing everywhere.
    **Status: New.**

48. **Search/replace and viewport APIs rely on long positional argument lists and `int` booleans.**
    `omega_edit_replace_matches` / `omega_edit_replace_matches_bytes` take a long sequence of
    positional range, matching, ordering, output-count, and mode arguments, while viewport creation
    and modification use `int is_floating` rather than a boolean or options struct. These signatures
    are hard to read at call sites and make argument swaps or non-boolean values easy to miss.
    **Status: New.**

49. **Viewport dirty state is encoded as a negative capacity sentinel.**
    `core/src/lib/viewport.cpp:117` negates `data_segment.capacity` to mark viewport data dirty,
    and `omega_viewport_get_capacity` hides that by returning `std::abs(...)`. This couples a
    state flag to a conceptually non-negative size field and requires every data-segment user to
    remember the convention. A separate dirty flag would be more type-safe and less surprising.
    **Status: New.**

50. **Output path collision handling stops after 999 suffixes.**
    `core/src/lib/edit.cpp:189-206` and `core/src/lib/filesystem.cpp:313-321` try numeric suffixes
    only from 1 through 999 before returning `EEXIST`/`nullptr`. Busy output directories or stale
    temp/checkpoint files can exhaust that small namespace even though a timestamp, UUID, or wider
    suffix range would still produce a valid path.
    **Status: Fixed.** Output and available-filename helpers now search a much wider suffix range
    before reporting collision exhaustion.

---

## N. Build / dependency hygiene

51. **Deprecated or aging generator dependencies remain in the workspace.**
    Root `package.json` still carries `@types/glob` even though modern `glob` ships its own types,
    and `packages/client/package.json` still depends on `grpc-tools` for protobuf generation while
    the runtime stack has otherwise moved to `@grpc/grpc-js`/protobuf-ts. These are not immediate
    runtime bugs, but they keep extra native tooling and deprecated type packages in the install
    surface.
    **Status: Fixed.** Removed the direct root `@types/glob` dependency/resolution and moved
    protobuf generation from `grpc-tools` to the pinned `@protobuf-ts/protoc` compiler used with
    `@protobuf-ts/plugin`.
