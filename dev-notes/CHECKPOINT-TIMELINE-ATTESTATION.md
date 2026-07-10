# Checkpoint Timeline Release Attestation

This document records reproducible evidence for WP5 / GitHub issue #1536.
Results are never marked as passing until the command or CI job has completed.
GitHub Actions artifacts are retained under the names shown below.

## Required CI checks

| Gate | Workflow/job | Evidence |
| --- | --- | --- |
| Native VS Code integration | `Unit Tests / VS Code extension checks` | Linux, macOS, and Windows at VS Code 1.110.0 and stable |
| Differential fuzz | `Checkpoint Timeline Hardening / Differential fuzz` | Linux, macOS, and Windows; minimized JSONL replay corpus uploaded on failure |
| ASan + UBSan | `Checkpoint Timeline Hardening / ASan-UBSan sanitizer` | Instrumented planner and differential fuzz output |
| TSan core | `Checkpoint Timeline Hardening / TSan sanitizer` | Instrumented planner and differential fuzz output |
| TSan server streaming | `Checkpoint Timeline Hardening / TSan native server streaming and cancellation` | Client cancellation suite plus native VS Code replay integration |
| Performance | `Checkpoint Timeline Hardening / Planner and codec performance attestation` | `checkpoint-timeline-performance` artifact |
| Optimizer soak | `Checkpoint Timeline Hardening / Optimizer soak shard 0..4` | Five seed-disjoint JSONL reports; scheduled defaults total 27.5 runner-hours |
| Packaging | `Unit Tests / Package VS Code extension VSIX` | Multi-platform server/plugin verification and VSIX artifact |

The hosted-runner soak is sharded because a single GitHub-hosted job cannot run
for 24 hours. Five 330-minute seed-disjoint shards provide 27.5 aggregate
runner-hours. A release approver who requires one continuous 24-hour process
must run `scripts/run-checkpoint-timeline-soak.sh` on a self-hosted runner after
raising its local duration guard, and link that artifact as an approved
replacement. Aggregate and continuous soak evidence must not be conflated.

## Local reproduction

### Core planner and fuzz

```bash
cmake -S . -B _build/wp5 -GNinja \
  -DBUILD_SHARED_LIBS=OFF -DBUILD_DOCS=OFF -DBUILD_EXAMPLES=OFF \
  -DBUILD_TESTS=ON -DCMAKE_BUILD_TYPE=Release
cmake --build _build/wp5 --target changelog_tests differential_fuzz_tests
_build/wp5/core/src/tests/changelog_tests '[.benchmark]'
OMEGA_EDIT_FUZZ_ITERATIONS=96 OMEGA_EDIT_FUZZ_OPS=512 \
  _build/wp5/core/src/tests/differential_fuzz_tests '[DifferentialFuzz]'
```

The planner benchmark prints machine-readable JSON and fails if optimized
planning for 100,000 typing edits takes one second or longer.

### Million-entry streaming codec

```bash
yarn workspace @omega-edit/client benchmark:changelog
```

This writes and reads 1,000,000 entries through the public atomic/streaming
codec, verifies the exact count, samples RSS throughout both passes, fails if
RSS growth exceeds 256 MiB, and writes
`artifacts/checkpoint-timeline/codec-benchmark.json`.

### Extension and native integration

```bash
cd vscode-extension
npm run lint
npm run compile
npm run test:unit
CPP_SERVER_BINARY=/path/to/omega-edit-grpc-server npm run test:integration
```

The native integration test covers repeated rewind/fast-forward, Save before
checkpoint (the same provider callback used by Auto Save), exact saved
fingerprint transitions, no-op branch preservation, archive corruption before
destructive rewind, unavailable-boundary UI state, transform checkpoints, and
checkpointed replace-all timeline replay.

## Accessibility review checklist

- [x] Slider and one-step buttons are keyboard focusable and use native range/button semantics.
- [x] Current checkpoint, saved location, navigation progress, and unavailable count are announced.
- [x] Unavailable and saved states do not rely on color alone; text and titles are present.
- [x] Forced-colors focus and boundary presentation is explicit.
- [x] Reduced-motion preferences disable component animation and transitions.
- [x] English and Spanish timeline strings are supplied through the shared localization table.
- [ ] NVDA on Windows manual pass linked.
- [ ] VoiceOver on macOS manual pass linked.

## Release evidence

| Date | Environment | Gate | Result | Artifact or output |
| --- | --- | --- | --- | --- |
| 2026-07-10 | Linux x64, GCC 13.3, Release, WSL workspace filesystem | 100k typing planner | Pass: 165 ms, 1 optimized entry | Local JSON console output |
| 2026-07-10 | Linux x64, Node 22.23.1 | 10k codec smoke | Pass: 1,202 ms, 179,245,056-byte RSS growth | `codec-benchmark.json` (smoke overwritten by full gate) |
| 2026-07-10 | Linux x64, Node 22.23.1, WSL workspace filesystem | 1M-entry streaming codec | Pass: 89,263 ms, 126,889,469 encoded bytes, 134,082,560-byte RSS growth | Local `codec-benchmark.json` |
| 2026-07-10 | Linux x64, GCC 13.3, Release | Differential fuzz 24×256 | Pass | Local Catch2 output |
| 2026-07-10 | Linux x64, GCC 13.3, Debug | ASan+UBSan planner tests and differential fuzz 6×128 | Pass: 12,031 assertions | Local Catch2 output |
| 2026-07-10 | VS Code 1.128.0, Linux x64 native server | Real `files.autoSave=afterDelay` edit then checkpoint | Pass | Native extension integration output |
| 2026-07-10 | Linux x64, GCC 13.3, Release, soak shard 9 | One-minute soak harness smoke | Pass: 1 seed-disjoint iteration, 2,048 operations, 113 seconds | Local `soak-9.jsonl` (transient artifact) |

Add CI run links and artifact names here before checking the remaining
Definition of Done items. Cross-platform, sanitizer, manual assistive
technology, and soak rows are intentionally absent until those jobs run.
