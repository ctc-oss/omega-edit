# First-Class Transform Primitives

OmegaEdit changes should converge on one primitive shape:

- `DELETE`
- `INSERT`
- `OVERWRITE`
- `REPLACE`
- `TRANSFORM`

Each primitive carries:

- primitive type
- byte range (`offset`, `length`)
- data payload

For `INSERT`, `OVERWRITE`, and `REPLACE`, the data payload is replacement bytes.
For `DELETE`, the data payload is exactly the deleted bytes. Small payloads are
stored inline; larger payloads are file-backed in the session checkpoint
directory. The inline/file-backed threshold defaults to
`OMEGA_CHANGE_INLINE_PAYLOAD_LIMIT` and can be lowered per session with
`omega_session_set_change_inline_payload_limit()`, which keeps tests and
low-memory callers from needing large allocations to exercise the file-backed
path. That gives undo an inverse payload without replaying history. For
`OVERWRITE`, the primary payload is the replacement bytes and the inverse
payload is the bytes that were replaced, including file-backed storage for large
ranges. For `TRANSFORM`, the data payload is JSON with the transform id and JSON
arguments, for example:

```json
{"transformId":"builtin:ascii-to-lower","args":{}}
```

The first implementation step makes `omega_change_get_bytes()` return the
primitive payload. `omega_change_get_data()` is kept as an alias for callers that
want a name tied to the primitive shape.

Large inverse payloads are not copied into memory-backed history. They use a
session-owned file-backed payload path, while model segments read payload bytes
through the same copy/write helpers regardless of storage.

Undo now applies inverse primitives directly for ordinary edit changes:

- `INSERT` undo deletes the inserted range.
- `DELETE` undo inserts the captured delete payload.
- `OVERWRITE` undo deletes the replacement payload and inserts the captured
  inverse payload.

Checkpoint-backed transform undo/redo still restores checkpoints.

Open migration steps:

- Promote `REPLACE` into the native core change kind instead of representing it
  as a transaction of delete/insert operations.
- Move protobuf change details further toward the same primitive shape by
  carrying data storage metadata where useful.
- Keep transform metadata accessors as compatibility helpers over the canonical
  transform JSON payload.
- Scope transform/plugin allocation ownership to the session or operation
  instead of using process-global maps and locks for payload cleanup.
