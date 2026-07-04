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
list below rather than kept as a second appended review.

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
- `server/cpp/src/main.cpp:597`
- `server/cpp/src/main.cpp:615`
- `server/cpp/src/main.cpp:622`
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

### 2. Undo snapshot strategy is count-only and memory-blind

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

### 3. `replace_matches` buffers every match in memory

**Impact:** High for very large files and common patterns
**Risk:** Medium
**Area:** Core replace/search, C++ server replace RPC

`omega_edit_replace_matches_bytes` accumulates all accepted match offsets in a
vector, builds a full operation script, then applies one change record per
operation. The default limit can be unlimited, so replacing a common pattern in a
large file can consume memory proportional to match count. The streaming,
checkpointed `omega_edit_replace_all_bytes` path avoids this shape.

Relevant code:
- `core/src/lib/edit.cpp:1822`
- `core/src/lib/edit.cpp:1852`
- `core/src/lib/edit.cpp:1877`
- `core/src/lib/edit.cpp:1895`

Suggested fix:
- Add an internal match-count or operation-count ceiling for the current script
  path.
- Prefer a streaming/checkpointed implementation when the caller requests
  unbounded replacement.
- Add scale tests that assert bounded memory or a clear graceful failure.

### 4. Read/classification RPCs allocate unbounded segments

**Impact:** High for server robustness
**Risk:** Low to Medium
**Area:** C++ server read APIs

`GetSegment`, `GetContentType`, and `GetLanguage` allocate a segment directly
from `request->length()` without a policy ceiling. `bad_alloc` is caught as an
internal error, but the RPCs remain an easy memory-pressure lever. Viewports
already have a capacity limit, so this should use a similar policy.

Relevant code:
- `server/cpp/src/editor_service.cpp:1526`
- `server/cpp/src/editor_service.cpp:1570`
- `server/cpp/src/editor_service.cpp:2032`

Suggested fix:
- Add a configurable maximum read/classification segment size.
- Return `INVALID_ARGUMENT` or `RESOURCE_EXHAUSTED` when callers exceed it.
- Align defaults with viewport limits or document why they differ.

### 5. Change-log import is still full-document JSON parsing

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

### 6. TypeScript live client still has a 2^53 int64 ceiling

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

### 7. Zlib decompression has no output-size or ratio cap

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

### 8. Bundled plugins run in-process with server privileges

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
- `core/src/lib/transform.cpp:1044`
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

### 9. Transform change replay is metadata-aware but not native-first

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

### 14. C++ codec plugins lack cancellation, and base58 is quadratic

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

### 15. OpenSSL cipher plugin does not zeroize key material

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

### 16. Snapshot allocation failure silently degrades undo speed

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

### 17. Transaction-boundary scan is linear per undo

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

### 18. Redo still replays one change at a time

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

### 19. C transform plugins each reimplement the same JSON parser

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

### 20. Utility string helpers have minor robustness gaps

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

### 21. Content detection feeds untrusted bytes to third-party parsers

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
