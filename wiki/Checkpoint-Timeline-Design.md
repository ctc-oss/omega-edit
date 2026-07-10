# Checkpoint Timeline Design

The Ωedit™ VS Code data editor exposes a storage-backed checkpoint timeline for
moving backward and forward through explicit editing milestones. It is designed
for large files: replay payloads live on disk, navigation is fingerprint
verified, and Save or Auto Save never destroys history.

This page defines the stable product and architecture contract. Development
backlogs and release evidence are maintained separately from the wiki.

## User model

The `Ωedit: Show Checkpoint Timeline` action reveals a slider and one-step
back/forward buttons in the editor. The slider contains:

- **Original**, at position zero, representing the bytes with which the session
  was opened;
- one position for every successfully recorded checkpoint;
- a current-position marker;
- a distinct **Last Saved** marker; and
- unavailable-boundary markers when history could not be archived safely.

Moving the slider previews a destination. Releasing it navigates to that
checkpoint. The user can move repeatedly in either direction as long as no new
content mutation is made while behind the tip.

## Core invariants

The following rules are release-critical:

1. Position zero is immutable for the lifetime of the editor session.
2. Position `N` is byte-identical to the content captured by checkpoint `N`.
3. Rewind preserves forward history.
4. Repeating a backward/forward cycle is idempotent.
5. Jumping several positions produces the same content as stepping through
   each intermediate position.
6. Save and Auto Save update saved identity but never rebase or truncate the
   timeline.
7. A new content mutation while behind the tip creates a branch and removes
   only the abandoned future.
8. Navigation never crosses an interval that is missing, corrupt,
   incompatible, or dependent on an unavailable transform plugin.
9. The displayed cursor changes only after native session content and durable
   metadata agree.

## Timeline state

The extension keeps small metadata records in memory. Change payloads are not
retained in the webview or extension heap after an interval is committed.

```text
Original ── interval 1 ── Checkpoint 1 ── interval 2 ── Checkpoint 2
   0                            1                              2
```

Each checkpoint entry records its ordinal, label, timestamp, before/after
fingerprints, availability, and durable interval reference. The timeline also
tracks:

- the current cursor;
- the current tip;
- the content fingerprint most recently saved;
- whether that saved fingerprint is on the active branch; and
- a monotonic generation used to reject stale asynchronous work.

The webview receives metadata only. It sends a requested destination to the
extension host, which owns validation, replay, storage, and native-session
coordination.

### Fingerprint authority

TypeScript does not hash session content. It calls the native
`GetSessionFingerprint` RPC for original or computed content, then normalizes,
compares, serializes, and displays the returned size and digest. The C++ server
materializes the requested core session content and computes its digest through
the registered streaming digest plugin. This keeps large content out of the
extension heap and makes the native session the fingerprint authority.

## Interval storage

History is stored as independently replayable `omega-edit.change-log` version
2 interval documents. An interval contains only the transition from checkpoint
`N - 1` to checkpoint `N`; it is not a cumulative snapshot of all prior edits.

```text
timeline root/
  manifest.json
  interval-000001.json
  interval-000002.json
  ...
```

The exact filenames are implementation details. The durable rules are:

- files are owned by one editor/session timeline;
- writes go to a temporary file in the target directory;
- content is flushed, closed, renamed, and verified before the manifest points
  to it;
- the manifest is committed last through its own atomic replacement;
- a committed manifest never references a partial interval;
- startup recovery quarantines invalid manifests and removes unreferenced
  temporary files without following untrusted paths or symbolic links; and
- quotas bound retained bytes, checkpoints, and abandoned cleanup work.

One process owns the timeline lock. A persisted reservation prevents concurrent
writers from both believing the same quota capacity is available. Stale locks
are recovered by a single winner and fresh owner locks are never stolen.

## Capture and optimization

Creating a checkpoint follows this order:

1. freeze the checkpoint generation;
2. stream the raw native changes for the interval to temporary storage;
3. verify entry counts and before/after fingerprints;
4. request coordinate-aware optimized export;
5. independently replay and verify the optimized candidate;
6. keep the smaller verified candidate; and
7. commit interval metadata and then publish the new timeline state.

Optimizer failure is not checkpoint failure. The verified raw interval is a
safe fallback. If raw capture itself cannot be committed, the native checkpoint
may still exist, but the boundary is marked unavailable and navigation across
it is disabled.

Optimization is semantic, not an adjacent-entry text rewrite. Change offsets
are relative to the document state in which each operation occurred, model and
transform boundaries matter, and replay must preserve exact bytes. See
[Change-Log Optimizer](Change-Log-Optimizer) for the planner design and proof
obligations.

## Rewind and fast-forward

Fast-forward streams the selected interval in original order. Before applying
the first primitive, the extension verifies that current content matches the
interval's `before` fingerprint. When replay finishes, it verifies the `after`
fingerprint before moving the cursor.

Rewind uses the native history model to return to the preceding boundary while
preserving the durable forward interval. The extension verifies the resulting
fingerprint before publishing the earlier cursor.

Navigation is failure-atomic:

- mutation and navigation operations are serialized per document;
- cancellation stops at a defined transaction boundary;
- a replay failure rolls the session back to its pre-navigation change count;
- cursor and manifest updates occur only after content verification; and
- rollback failure is surfaced as a fatal consistency error rather than hidden
  behind a successful-looking cursor update.

## Branching

Navigation alone never creates a branch. Inspection, search, scrolling,
selection, Save, and Auto Save are also non-branching.

When a content-changing operation occurs while the cursor is behind the tip,
the extension first commits the mutation and then atomically truncates future
timeline metadata. Future interval files become cleanup candidates only after
the new manifest is durable. A no-op command does not truncate the future.

Content-changing operations include insert, delete, overwrite, replace,
mutating transforms, and an undo or redo that actually changes bytes.

## Save and Auto Save

Saved state is based on content identity, not native change count. After every
successful Save, including VS Code Auto Save, the extension asks the native
fingerprint service for the computed-content identity that was written and
records that returned value.

This distinction matters because saving does not rebase the Ωedit™ session:

- a checkpoint remains navigable after a save;
- returning to the saved fingerprint makes the document clean;
- leaving it makes the document dirty;
- saving while rewound moves the Last Saved marker without deleting the
  forward branch; and
- if a later edit removes the branch containing Last Saved, the marker becomes
  off-branch until another save succeeds.

Checkpoint creation therefore depends on unsaved OmegaEdit history, not VS
Code's dirty flag. Users with Auto Save enabled can checkpoint immediately
after a save because the save and checkpoint serve different purposes.

## Transform boundaries

TRANSFORM changes are first-class replay primitives. Their plugin identifier,
options, range, replacement size, and computed-size metadata are preserved.
Transforms are hard optimization barriers because plugin behavior is opaque.

Before forward replay, the extension verifies that all required plugins are
available. Missing plugins disable only the affected navigation boundary and
produce a specific explanation.

## Large-file behavior

The design avoids cumulative in-memory history:

- export and import are streaming;
- a bounded parser window and one replay batch dominate memory use;
- JSON int64 fields use decimal strings so persistence is not limited by
  JavaScript number precision;
- the current number-based TypeScript transport rejects offsets outside its
  safe integer range instead of rounding; and
- optimized intervals reduce storage and replay work without mutating live
  native history.

For the serialized format and TypeScript int64 boundary, see
[Change Log Large-File Design](Change-Log-Large-File-Design).

## Accessibility and localization

The timeline uses native range and button semantics. Keyboard users can focus
the slider and step through checkpoints without a pointer. A live region
announces the current checkpoint, navigation progress, saved position, and
unavailable boundaries.

Saved and unavailable states have text or titles and do not rely on color.
Focus remains visible in forced-colors mode, motion is removed when the user
requests reduced motion, and all displayed strings use the extension's shared
localization table.

## Verification strategy

Correctness is established through three-way comparison: replay the raw
history, replay the optimized history, and navigate the timeline; all three
must produce byte-identical content and fingerprints.

The automated suite includes:

- deterministic and randomized differential replay;
- repeated rewind/fast-forward and multi-step jumps;
- branching and no-op mutation cases;
- real VS Code Auto Save followed by checkpoint creation;
- transform and replace-all checkpoints;
- corruption, short write, rename, manifest, lock, quota, and cleanup faults;
- Linux, macOS, and Windows integration matrices;
- AddressSanitizer, UndefinedBehaviorSanitizer, and ThreadSanitizer jobs; and
- 100,000-operation planner and 1,000,000-entry streaming-codec benchmarks.

Manual release review supplements automation with screen-reader passes and a
timeline-specific visual inspection.
