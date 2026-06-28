#!/usr/bin/env bash
#
# Copyright (c) 2021 Concurrent Technologies Corporation.
#
# Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software is distributed under the License is
# distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
# implied.  See the License for the specific language governing permissions and limitations under the License.

set -euo pipefail

SOURCE_GLOBS=(
    '*.c'
    '*.cc'
    '*.cpp'
    '*.cxx'
    '*.h'
    '*.hh'
    '*.hpp'
    '*.hxx'
    '*.proto'
)
readonly SOURCE_GLOBS

if ! command -v clang-format >/dev/null 2>&1; then
    echo "clang-format is required to check C/C++ source formatting." >&2
    exit 127
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "scripts/check-clang-format.sh must be run from inside the git repository." >&2
    exit 1
fi

tracked_sources="$(mktemp)"
trap 'rm -f "${tracked_sources}"' EXIT

git ls-files -z -- "${SOURCE_GLOBS[@]}" > "${tracked_sources}"
if [[ ! -s "${tracked_sources}" ]]; then
    echo "No tracked C/C++ or proto sources found."
    exit 0
fi

if ! xargs -0 -r clang-format --dry-run --Werror < "${tracked_sources}"; then
    echo >&2
    echo "C/C++ source formatting check failed." >&2
    echo "Run the following command from the repository root and commit the result:" >&2
    echo "  git ls-files -z -- '*.c' '*.cc' '*.cpp' '*.cxx' '*.h' '*.hh' '*.hpp' '*.hxx' '*.proto' | xargs -0 -r clang-format -i" >&2
    exit 1
fi
