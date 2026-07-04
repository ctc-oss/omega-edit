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
2. **Massive-file pressure caps**: bound or stream `replace_matches`, and apply
   a configurable segment-size cap to read/classification RPCs.
3. **Plugin input hardening**: cap zlib decompression output and add cooperative
   cancellation to the C++ codec plugins.
4. **Undo performance batch**: implement the remaining low-risk undo pieces
   (transaction extents, redo batching, snapshot telemetry).
5. **Streaming import**: pair existing streaming export with a streaming/chunked
   import path.
6. **Checkpoint caps/dedupe**: add server/API guardrails for unbounded checkpoint
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

### 3. SearchSession buffers unbounded match lists

**Impact:** High for common patterns on massive files
**Risk:** Low
**Area:** C++ server search RPC

`SearchSession` with the default `limit = 0` accumulates every match offset in
a vector and then copies them all into a single response message. A short or
single-byte pattern over a large session can produce billions of matches
(memory proportional to match count, then a proportionally huge response). The
search loop also advances by 1 byte per match, so overlapping matches multiply
the count. This is the search-side sibling of the `replace_matches` finding
below.

Relevant code:
- `server/cpp/src/editor_service.cpp:2008`
- `server/cpp/src/editor_service.cpp:2032`

Suggested fix:
- Impose a server-side default/maximum match cap when the caller passes
  `limit = 0`, and report truncation explicitly (flag or status detail).
- Consider a streaming search RPC for callers that genuinely need all matches.
- Add a scale test with a high-frequency pattern asserting bounded memory and
  response size.

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

### 5. `replace_matches` buffers every match in memory

**Impact:** High for very large files and common patterns
**Risk:** Medium
**Area:** Core replace/search, C++ server replace RPC

`omega_edit_replace_matches_bytes` accumulates all accepted match offsets in a
vector, builds a full operation script, then applies one change record per
operation. The default limit can be unlimited, so replacing a common pattern in a
large file can consume memory proportional to match count. The streaming,
checkpointed `omega_edit_replace_all_bytes` path avoids this shape.

Relevant code:
- `core/src/lib/edit.cpp:1886`
- `core/src/lib/edit.cpp:1916`
- `core/src/lib/edit.cpp:1941`
- `core/src/lib/edit.cpp:1959`

Suggested fix:
- Add an internal match-count or operation-count ceiling for the current script
  path.
- Prefer a streaming/checkpointed implementation when the caller requests
  unbounded replacement.
- Add scale tests that assert bounded memory or a clear graceful failure.

### 6. Read/classification RPCs allocate unbounded segments

**Impact:** High for server robustness
**Risk:** Low to Medium
**Area:** C++ server read APIs

`GetSegment`, `GetContentType`, and `GetLanguage` allocate a segment directly
from `request->length()` without a policy ceiling. `bad_alloc` is caught as an
internal error, but the RPCs remain an easy memory-pressure lever. Viewports
already have a capacity limit, so this should use a similar policy.

Relevant code:
- `server/cpp/src/editor_service.cpp:1566`
- `server/cpp/src/editor_service.cpp:1609`
- `server/cpp/src/editor_service.cpp:1986`

Suggested fix:
- Add a configurable maximum read/classification segment size.
- Return `INVALID_ARGUMENT` or `RESOURCE_EXHAUSTED` when callers exceed it.
- Align defaults with viewport limits or document why they differ.

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

### 9. Zlib decompression has no output-size or ratio cap

**Impact:** High (decompression-bomb memory exhaustion)
**Risk:** Low to Medium
**Area:** Transform plugins (zlib)

`zlib_decompress` grows the output buffer by doubling with only a `SIZE_MAX/2`
ceiling, so a few kilobytes of compressible input can inflate to gigabytes of
resident memory. The loop does poll cancellation, but there is no maximum output
size or compression-ratio guard.

Relevant code:
- `plugins/src/zlib.c:142`
- `plugins/src/zlib.c:178`

Suggested fix:
- Add a configurable maximum decompressed-output size (and/or ratio) and fail
  with a clear error when exceeded.
- Keep the existing per-iteration cancellation polling.
- Add a decompression-bomb test that asserts the cap is enforced.

### 10. Bundled plugins run in-process with server privileges

**Impact:** High for any hardening attestation
**Risk:** Medium
**Area:** Core transform plugin loading, deployment trust boundary

Transform plugins are loaded with `dlopen`/`LoadLibrary` and execute in-process
with the server's full privileges; there is no sandbox. Plugin directories are
operator-controlled at startup rather than client-selectable, so this is a
supply-chain/trust matter, not a client RCE. The `omega.example.*` naming implies
samples, yet at least `openssl_digests` is wired into a production feature
(`GetSessionFingerprint`), so the "example" plugins already inherit production
trust.

Relevant code:
- `core/src/lib/transform.cpp:62`
- `core/src/lib/transform.cpp:1068`
- `server/cpp/src/editor_service.cpp:81`

Suggested fix:
- Decide and document which bundled plugins are supported/production versus
  samples, and treat supported ones at the server's trust level.
- Define the plugin trust boundary for the attestation (operator-provided,
  reviewed, signed, or sandboxed).
- Consider process/permission isolation for untrusted plugins if that becomes a
  requirement.

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

### 14. Whole-content operations hold the per-session core lock for their full duration

**Impact:** Medium (per-session availability on massive files)
**Risk:** Medium
**Area:** C++ server fingerprint/inspection/transform paths

`GetSessionFingerprint` and `InspectSessionContent` over *computed* content, and
`ApplyTransformPlugin` generally, hold the session's `core_mutex` while
streaming the entire session content through the digest/inspect/transform
plugin. On a massive file that is minutes of wall-clock time during which every
other RPC on that session (viewport reads, heartbeat-adjacent calls, saves)
blocks — and, combined with item 3, can escalate to a server-wide stall. The
file-snapshot paths already avoid this by reading the snapshot outside the
lock.

Relevant code:
- `server/cpp/src/editor_service.cpp:1765`
- `server/cpp/src/editor_service.cpp:1911`
- `server/cpp/src/editor_service.cpp:2341`

Suggested fix:
- For computed-content digests/inspections, materialize a temporary snapshot
  (or reuse the checkpoint machinery) under the lock, then stream from the
  snapshot outside the lock, as the original/checkpoint paths do.
- Document that transforms intentionally serialize the session, and rely on the
  existing transform/mutation guards for mutual exclusion rather than the core
  lock alone where possible.
- Add a test that runs a digest over a large session and asserts a concurrent
  viewport read completes promptly.

### 15. Profile and character-count scans read in `BUFSIZ` chunks

**Impact:** Medium (massive-file scan throughput, especially on Windows)
**Risk:** Low
**Area:** Core session statistics

`omega_session_byte_frequency_profile` and `omega_session_character_counts`
iterate the session in `BUFSIZ`-sized segments. `BUFSIZ` is 512 bytes on MSVC
(8 KiB on glibc), so profiling a 10 GiB session on Windows performs ~20 million
`populate_data_segment_` calls, each doing an `upper_bound` over the segment
list plus a seek/read. The rest of the codebase uses a 64 KiB
`OMEGA_IO_BUFFER_SIZE` for streaming.

Relevant code:
- `core/src/lib/session.cpp:385`
- `core/src/lib/session.cpp:422`

Suggested fix:
- Use `OMEGA_IO_BUFFER_SIZE` (or a dedicated scan buffer constant) instead of
  `BUFSIZ` for both scans.
- Null-check the `omega_segment_create` result explicitly.
- Add a benchmark or perf regression note for full-file profiling.

### 16. Temp files are created, closed, then reopened by path

**Impact:** Medium (local symlink-swap hardening)
**Risk:** Low
**Area:** Core checkpoint/payload/save temp-file handling

The common pattern is `omega_util_mkstemp` (0600, `O_EXCL`) followed by
`close(fd)` and a later `FOPEN(path, "wb")` — in checkpoint creation, payload
capture, save's temp file, and `reserve_output_path_`. Between the close and
the reopen, a local attacker with write access to the directory (for example a
shared `/tmp` checkpoint directory) can swap the file for a symlink and the
subsequent open-for-write follows it. The exclusive create wins the name, but
the identity guarantee is dropped when the fd is closed.

Relevant code:
- `core/src/lib/edit.cpp:987`
- `core/src/lib/edit.cpp:1011`
- `core/src/lib/edit.cpp:2259`
- `core/src/lib/edit.cpp:291`

Suggested fix:
- Keep the descriptor from `mkstemp` and wrap it with `fdopen` instead of
  closing and reopening by name.
- Where reopening is unavoidable, verify identity (`O_NOFOLLOW`, or
  fstat/st_ino comparison) before writing.
- Document that checkpoint directories should not be world-writable shared
  directories.

### 17. Search treats read failures as "no match"

**Impact:** Medium (silently wrong results on I/O errors)
**Risk:** Low
**Area:** Core search, C++ server search RPC

`omega_search_next_match` ignores the return value of
`populate_data_segment_`; on a read failure the segment length is zero, the
window loop ends, and the context reports "no more matches". A transient I/O
error therefore looks identical to a legitimate miss. On the server side,
`SearchSession` also returns `OK` with an empty match list when context
creation fails (invalid offset/length/pattern), so callers cannot distinguish
"no matches" from "search never ran".

Relevant code:
- `core/src/lib/search.cpp:221`
- `server/cpp/src/editor_service.cpp:2025`

Suggested fix:
- Propagate populate failures out of `omega_search_next_match` (distinct error
  return) and surface them as RPC errors.
- Return `INVALID_ARGUMENT` from `SearchSession` when the search context cannot
  be created.
- Add a test with an out-of-range offset asserting an error rather than an
  empty result.

### 18. C-string and byte edit APIs encode different zero-length semantics

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

### 19. Long positional argument lists remain hard to use safely

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

### 21. C++ codec plugins lack cancellation, and base58 is quadratic

**Impact:** Medium to High (CPU hang on large selections)
**Risk:** Low
**Area:** Transform plugins (text/decimal codecs)

The C++ REPLACE codecs pull the whole selection into memory via `selected_bytes`
and then run their encode/decode loops with no cancellation polling, unlike the C
plugins which poll roughly every 4096 bytes. base58 encode/decode are also
`O(n^2)` over the selection, so a large selection becomes an uninterruptible
multi-second-to-minutes CPU hang.

Relevant code:
- `plugins/src/plugin_options.hpp:185`
- `plugins/src/text_codecs.cpp:195`
- `plugins/src/text_codecs.cpp:224`

Suggested fix:
- Poll `omega_transform_plugin_sdk_is_cancelled` inside the C++ codec loops.
- Cap base58 selection size or document it as a short-field codec.
- Add cancellation and large-input tests for the C++ codecs.

### 22. OpenSSL cipher plugin does not zeroize key material

**Impact:** Medium
**Risk:** Low
**Area:** Transform plugins (crypto hygiene)

`cipher_parse_options` holds the raw key/IV in a stack `omega_cipher_options_t`
(and the hex key in a stack buffer during parsing) and never scrubs them with
`OPENSSL_cleanse` before returning, so key bytes linger in freed stack memory.
Transform output is also persisted to checkpoint files in the clear, which is
inherent to how transforms materialize but worth stating for a crypto-grade
attestation.

Relevant code:
- `plugins/src/openssl_ciphers.c:166`
- `plugins/src/openssl_ciphers.c:355`

Suggested fix:
- `OPENSSL_cleanse` the key/IV buffers (and the parsing scratch buffer) before
  returning from apply.
- Document that transform output, including ciphertext, is written to checkpoint
  files unencrypted.

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

### 26. C transform plugins each reimplement the same JSON parser

**Impact:** Low
**Risk:** Low
**Area:** Transform plugins (C option parsing)

base64, zlib, cipher, digest, and the bitmask header each carry their own
`*_skip_ws` / `*_parse_json_string` / `*_parse_options` scaffolding. The C++
plugins already share `plugin_options.hpp`; the C plugins have no equivalent, so
the same parser is duplicated and independently maintained.

Relevant code:
- `plugins/src/base64.c:34`
- `plugins/src/zlib.c:48`
- `plugins/src/openssl_ciphers.c:84`
- `plugins/src/openssl_digests.c:61`
- `plugins/src/bitmask_options.h:53`

Suggested fix:
- Extract a shared C options header mirroring `plugin_options.hpp`.
- Consolidate to a single audited JSON-options parser to shrink the attack
  surface.
- Keep per-plugin schema validation.

### 27. Core/server duplication that should be consolidated

**Impact:** Low (maintainability, divergence risk)
**Risk:** Low
**Area:** Core edit internals, C++ server RPC scaffolding

Several near-identical code blocks are maintained in parallel and have already
started to drift:

- `create_checkpoint_file_` and `create_payload_file_` differ only in the
  filename template (`core/src/lib/edit.cpp:972`, `core/src/lib/edit.cpp:996`).
- `update_model_helper_` and `insert_payload_segment_` duplicate the
  segment-split/walk scaffolding (~40 lines) around different insert bodies
  (`core/src/lib/edit.cpp:640`, `core/src/lib/edit.cpp:738`).
- `rebuild_model_to_change_count_` repeats the "reinitialize from backing file"
  block in two branches (`core/src/lib/edit.cpp:859`).
- `omega_session_get_num_change_transactions` and
  `omega_session_get_num_undone_change_transactions` are copy-pasted loops over
  different vectors (`core/src/lib/session.cpp:270`,
  `core/src/lib/session.cpp:295`).
- `GetSessionFingerprint` and `InspectSessionContent` each duplicate the entire
  snapshot-vs-computed branch pair, including two ten-argument
  `inspect_with_streaming_plugin` calls that differ only in messages
  (`server/cpp/src/editor_service.cpp:1702`,
  `server/cpp/src/editor_service.cpp:1856`); `GetContentType` and `GetLanguage`
  are likewise structural twins (`server/cpp/src/editor_service.cpp:1546`,
  `server/cpp/src/editor_service.cpp:1589`).
- Nearly every RPC repeats the same guard/lock/NOT_FOUND prologue by hand.

Suggested fix:
- Extract a single temp-file-in-checkpoint-dir helper parameterized by prefix.
- Factor the model segment split/walk into one helper used by both insert
  paths.
- Introduce a small `resolve_content_source(...)` helper (and an error-message
  struct for `inspect_with_streaming_plugin`) so fingerprint/inspect share one
  body.
- Add a `with_locked_session(request_id, handler)` helper for the RPC prologue.

### 28. Utility string helpers have minor robustness gaps

**Impact:** Low
**Risk:** Low
**Area:** Core C utility helpers

`omega_util_strndup` does not null-check `s` before `memcpy`, so a null source
with a non-zero length would crash; current callers pass valid pointers.
`omega_util_strncmp` compares with signed `char` subtraction, so its ordering
result differs from `strcmp` for bytes `>= 0x80` (equality is unaffected).

Relevant code:
- `core/src/lib/utility.c:214`
- `core/src/lib/utility.c:232`

Suggested fix:
- Guard `omega_util_strndup` against a null source.
- Compare bytes as `unsigned char` in `omega_util_strncmp` if strcmp-compatible
  ordering is expected.

### 29. Failure-signaling edges can mislead callers or operators

**Impact:** Low to Medium
**Risk:** Low
**Area:** Core edit results, server startup/CLI

A collection of small signaling gaps, individually rare but relevant to a
reliability attestation:

- `replace_bytes_impl_` returns `0` (the "nothing changed" value) when the
  insert fails *and* the compensating undo of the already-applied delete also
  fails, so in that allocation-failure corner the session content changed while
  the caller is told it did not (`core/src/lib/edit.cpp:396`).
- `omega_edit_save_segment` returns `-12` when `sync_parent_directory_` fails
  *after* the atomic rename has already published the file, so a completed save
  is reported as a failure with no way to distinguish post-commit durability
  warnings from real failures (`core/src/lib/edit.cpp:2376`).
- `main.cpp` silently ignores unknown CLI options, so a typo in a resource-cap
  or security-relevant flag leaves defaults in effect without any warning
  (`server/cpp/src/main.cpp:509`).
- `CreateSession` maps "file does not exist" to `INTERNAL` rather than
  `NOT_FOUND`/`INVALID_ARGUMENT` (`server/cpp/src/main.cpp` comment says this
  matches previous behavior) (`server/cpp/src/editor_service.cpp:917`).

Suggested fix:
- Return a distinct negative error when the replace rollback itself fails, and
  a distinct post-commit code (or success-with-warning) for the directory-sync
  case.
- Reject unknown CLI options (or at least log a warning listing them).
- Use `NOT_FOUND` for missing session files, keeping the old message text if
  compatibility matters.

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
- Track and update libmagic/CLD3 versions as part of the release process.
- Consider isolating or resource-limiting content detection for untrusted input.
- Document the third-party parser exposure in the deployment trust boundary.

---

## Testing Gaps For Attestation

These are not separate product shortcomings, but they are worth closing before
claiming production hardening:

- Save durability: add fault-injection coverage around interrupted saves beyond
  the current atomic/durable publishing coverage.
- Remaining overflow paths: helper and edit-range tests exist, but add more
  near-`INT64_MAX` coverage through public APIs and server RPC boundaries.
- `replace_matches` scale: assert bounded memory use or clear failure on huge
  match counts.
- Change-detail payload bounds: request details for a change larger than the
  inline payload limit and assert bounded memory/response behavior.
- Same-session availability under long scans: run a slow operation (large
  transform or computed-content fingerprint) and assert non-mutating RPCs on
  that session complete promptly once the long scan paths release `core_mutex`
  more aggressively.
- gRPC message-size boundaries: submit changes just under/over the effective
  transport and `max_change_bytes` limits and assert the intended error paths.
- Search error paths: assert I/O failures and invalid ranges surface as errors,
  not empty match lists.
- Transform/mutation concurrency: add real-thread coverage for
  `try_begin_transform` returning `MUTATION_IN_PROGRESS` and for transform vs.
  mutation mutual exclusion.
- Source mutation immunity: assert sessions continue reading from their private
  original snapshot after the user truncates or rewrites the source file.
- Plugin fuzzing: fuzz the format inspectors and text/decimal codecs, especially
  base58, for hangs, unbounded output, and decode round-trips.
- Decompression caps: assert zlib decompression enforces its output-size/ratio
  ceiling and stays cancellable.
- Plugin cancellation: assert every bundled plugin honors cooperative
  cancellation partway through a large selection.

---

## Reviewed And Not Open

- The stack-allocated `omega_segment_t data_segment` in
  `omega_search_next_match` is not an uninitialized-read issue; the struct uses
  non-static data member initializers, so default initialization covers the
  fields read by `populate_data_segment_`.
- The C transform plugins' hand-rolled JSON string parsers use fixed stack
  buffers with strict `length + 1 >= out_size` guards; no buffer overflow was
  found across the base64/zlib/cipher/digest/bitmask parsers.
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
- Event mask signed `ALL_EVENTS` ambiguity.
- Output collision suffix range and deprecated protobuf generator dependencies.
