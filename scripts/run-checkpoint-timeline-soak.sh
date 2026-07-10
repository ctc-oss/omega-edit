#!/usr/bin/env bash
set -euo pipefail

minutes="${SOAK_MINUTES:-330}"
shard="${SOAK_SHARD:-0}"
build_dir="${SOAK_BUILD_DIR:-build-soak}"
if ! [[ "$minutes" =~ ^[1-9][0-9]*$ ]] || (( minutes > 330 )); then
  echo "SOAK_MINUTES must be an integer from 1 through 330" >&2
  exit 2
fi
if ! [[ "$shard" =~ ^[0-9]+$ ]]; then
  echo "SOAK_SHARD must be a non-negative integer" >&2
  exit 2
fi

mkdir -p artifacts/checkpoint-timeline
report="artifacts/checkpoint-timeline/soak-${shard}.jsonl"
deadline=$(( $(date +%s) + minutes * 60 ))
iteration=0
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

while (( $(date +%s) < deadline )); do
  seed=$(( 0x5eed0000 + shard * 1000003 + iteration ))
  run_started=$(date +%s)
  OMEGA_EDIT_FUZZ_ITERATIONS=1 \
  OMEGA_EDIT_FUZZ_OPS=2048 \
  OMEGA_EDIT_FUZZ_SEED="$seed" \
    "$build_dir/core/src/tests/differential_fuzz_tests" '[DifferentialFuzz]'
  duration=$(( $(date +%s) - run_started ))
  printf '{"shard":%s,"iteration":%s,"seed":"%s","durationSeconds":%s,"status":"pass"}\n' \
    "$shard" "$iteration" "$seed" "$duration" >> "$report"
  iteration=$((iteration + 1))
done

finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{"summary":true,"shard":%s,"startedAt":"%s","finishedAt":"%s","iterations":%s,"status":"pass"}\n' \
  "$shard" "$started" "$finished" "$iteration" >> "$report"
