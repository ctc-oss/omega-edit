# OmegaEdit — Shortcomings, Bugs, Gaps & Missed Opportunities

Living backlog of issues found while reviewing the `codex/checkpoint-change-log-actions`
work and the surrounding transform / change-log / checkpoint code. Grouped by theme,
roughly prioritized within each group. File:line references point at the offending code.

Status notes:
- `Fixed` means the current `codex/fix-transform-content-changed` branch addresses the
  item directly.
- `Partially fixed` means the branch reduces the risk but leaves a larger design gap.

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
    populate the transform/results feedback strip.

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
