# Change Log Large-File Design

OmegaEdit change logs must not impose arbitrary caps that contradict the
large-file editing model. The change-log boundary now follows these rules.

This page covers persistence and transport boundaries. The semantic optimizer
and its coordinate model are specified in
[Change-Log Optimizer](Change-Log-Optimizer), while checkpoint replay and
branching are specified in
[Checkpoint Timeline Design](Checkpoint-Timeline-Design).

## Integer Fields

Serialized `omega-edit.change-log` documents represent int64-sized fields as
decimal values. Import accepts safe JSON numbers for convenience and decimal
strings for full int64 fidelity. Export writes counts, serials, offsets,
lengths, and fingerprint byte lengths as decimal strings.

This avoids making JavaScript number precision part of the file format. The
current generated TypeScript gRPC client is still built with
`long_type_number`, so replaying a change log through that client must downcast
offsets and lengths to safe JavaScript numbers before the RPC. If a document
contains an int64 value beyond that transport boundary, import fails loudly
instead of rounding or partially applying the log.

Full BigInt support at the TypeScript boundary requires changing the generated
protobuf-ts output away from `long_type_number`, then updating public client,
AI, and VS Code APIs that currently expose file sizes, offsets, lengths,
counts, and serials as `number`.

## File-Backed Export

File-backed export streams the JSON document to a temporary file in the target
directory and renames it only after every change detail has been written and
validated. Missing change details still fail the export because an incomplete
replay log is not useful.

Inline export can still return a document with a `changes` array for callers
that explicitly want an in-memory value. File-backed export returns summary
metadata and the output path rather than echoing the full entry array back to
the caller.

## Remaining Streaming Work

Import still parses the versioned JSON document before replay. The former byte
and entry-count caps are gone, but true streaming import needs either a
streaming JSON parser dependency or a line/chunk-oriented change-log format.
That should be a deliberate format/API decision, not a bigger magic number.
