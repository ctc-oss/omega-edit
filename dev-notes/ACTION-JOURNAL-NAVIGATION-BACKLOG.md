# Action journal navigation backlog

Issue #1491 establishes the action journal as a bounded, server-owned viewport
over active primitive changes. The first PR intentionally stops short of making
the journal a second session cursor. The following work should build on the
`changeCountBefore`, `changeCountAfter`, `checkpointBefore`, and
`checkpointAfter` coordinates shipped with each journal entry.

## Per-change history navigation

- Add a non-destructive history cursor that can materialize the session at an
  arbitrary active change count without moving the editing tip.
- Navigate backward and forward by canonical journal entry, including an atomic
  `REPLACE` represented by its delete/insert pair.
- Define viewport and selection behavior when the selected change's byte range
  does not exist in the materialized before or after state.
- Make branch, undo, redo, clear, checkpoint rollback, and transform semantics
  explicit. A stale history cursor must never silently attach to a new branch.

## Checkpoint acceleration

- Resolve the nearest checkpoint at or before the target change count and replay
  only the bounded interval between that checkpoint and the target.
- Add server-side cost metadata so clients can distinguish a direct checkpoint
  restore from a replay and report progress for unusually long intervals.
- Reuse persisted checkpoint archives where available without exposing native
  file paths or checkpoint implementation details to clients.
- Benchmark cold and warm walks across large histories, huge changes, transform
  boundaries, and histories with sparse checkpoints.

## Journal evolution

- Add a stable history revision/cursor token so paged requests can detect an
  edit, undo, or branch change between windows without relying only on event
  invalidation.
- Add bidirectional prefetch around a selected entry and UI virtualization for
  very long journals.
- Decide whether undone/future changes appear as a separate branch viewport or
  remain outside the active journal.
- Add durable transaction identifiers if identifiers must survive exported log
  replay or session reconstruction.
- Evaluate replacing the checkpoint slider after per-change navigation reaches
  feature parity; retain checkpoint markers as acceleration and orientation
  points in the unified history surface.

## Validation

- Property-test pagination for no gaps or duplicates in both directions and
  under all kind/transaction filters.
- Stress-test bounded memory and response latency for million-change histories
  and very large transactions.
- Exercise live-tail invalidation while scrolling older windows and while a
  transform or transaction is in progress.
- Add end-to-end tests for stepping across checkpoints and transforms without
  mutating the active editing tip.
