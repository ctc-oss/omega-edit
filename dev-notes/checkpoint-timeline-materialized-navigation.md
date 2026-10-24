# Materialized checkpoint timeline navigation

## Acceptance scenario

The ApacheCon demo must support a massive file, thousands of edits and transforms, and repeated movement through the
checkpoint timeline while the viewport updates. Moving between checkpoints that already exist in the live session must
not re-run transforms or replay interval change logs.

## Required behavior

- Rewind and fast-forward switch between already materialized checkpoint models.
- Navigation cost is independent of file size and interval change count, apart from viewport reads and fingerprint
  verification.
- Future checkpoints remain available after rewind until the user makes a branch mutation.
- The first mutation away from the tip atomically discards the native future and truncates the durable timeline.
- Durable change-log archives remain the reopen, recovery, and cross-process fallback. They are not the normal live
  navigation path.
- Checkpoint 0 continues to mean the immutable original file, not the edits that happened before checkpoint 1.

## Implemented native model

Add a future-checkpoint stack to `omega_session_t`. A rewind moves the active checkpoint model from the active model
stack to the future stack without closing or unlinking its backing file. Fast-forward moves the next future model back
to the active stack. Checkout invalidates viewports and emits the checkpoint-restore event.

The core API is:

- `omega_edit_checkout_checkpoint(session, checkpoint_count)`
- `omega_edit_discard_checkpoint_future(session)`
- `omega_session_get_num_future_checkpoints(session)`

Session destruction must close and remove checkpoint files from both stacks. Existing destructive checkpoint rollback
keeps its current semantics and must also invalidate any incompatible future.

## Server and client contract

`CheckoutCheckpoint` and `DiscardCheckpointFuture` run under the session mutation lock. Checkout returns active and
future checkpoint counts so the extension can assert native/timeline alignment after every move.

## Editor routing

`navigateToCheckpoint` uses a single native checkout call. Durable interval availability and plugin availability remain
visible as archive metadata, but neither disables live fast-forward because no replay is needed.

## Performance and reliability tests

- Core regression: 1,000 original-to-tip sweeps across mixed transform/plain checkpoints, with 10,041 assertions and an
  invariant transform callback count.
- Core regression: a branch edit after rewind removes the future and makes checkout beyond the branch fail.
- Client regression: active/future counts and content remain aligned through rewind, fast-forward, and branch creation.
- VS Code regression: a full-range transform moves `1 -> 0 -> 1` through materialized checkout.
- VS Code regression: navigation succeeds with missing storage and with a deliberately corrupted durable archive.
- VS Code scalability regression: one million checkpoint records produce a bounded metadata projection.
