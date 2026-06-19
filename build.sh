#!/usr/bin/env bash
########################################################################################################################
# Copyright (c) 2021 Concurrent Technologies Corporation.                                                              #
#                                                                                                                      #
# Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance       #
# with the License.  You may obtain a copy of the License at                                                           #
#                                                                                                                      #
#     http://www.apache.org/licenses/LICENSE-2.0                                                                       #
#                                                                                                                      #
# Unless required by applicable law or agreed to in writing, software is distributed under the License is              #
# distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or                     #
# implied.  See the License for the specific language governing permissions and limitations under the License.         #
#                                                                                                                      #
########################################################################################################################

set -ex
cd "$(dirname "${BASH_SOURCE[0]}")"

type=${type:-"Debug"}
generator=${generator:-"Ninja"}
build_docs=${build_docs:-"NO"}
install_dir="${PWD}/_install"
conan_venv_dir="${PWD}/.venv-conan"
cmake_extra_args=""

find_python() {
  if [[ -n "${PYTHON:-}" ]]; then
    if command -v "$PYTHON" >/dev/null 2>&1; then
      echo "$PYTHON"
      return
    fi

    echo "PYTHON is set to '$PYTHON', but it was not found on PATH." >&2
    exit 1
  fi

  for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return
    fi
  done

  echo "Python is required to bootstrap Conan, but python3/python was not found on PATH." >&2
  exit 1
}

activate_conan_venv() {
  if [[ -f "${conan_venv_dir}/bin/activate" ]]; then
    # shellcheck disable=SC1091
    source "${conan_venv_dir}/bin/activate"
  elif [[ -f "${conan_venv_dir}/Scripts/activate" ]]; then
    # shellcheck disable=SC1091
    source "${conan_venv_dir}/Scripts/activate"
  else
    echo "Conan virtual environment was not created correctly: ${conan_venv_dir}"
    exit 1
  fi
}

detect_vscode_transform_platform() {
  node - <<'NODE'
const os = require('node:os')
const platform = os.platform()
const arch = os.arch()

let id = ''
if (platform === 'linux' && (arch === 'x64' || arch === 'arm64')) {
  id = `linux-${arch}`
} else if (platform === 'darwin' && (arch === 'x64' || arch === 'arm64')) {
  id = `macos-${arch}`
} else if (platform === 'win32' && arch === 'x64') {
  id = 'windows-x64'
}

if (!id) {
  process.exit(1)
}

console.log(id)
NODE
}

stage_vscode_transform_plugins() {
  local source_dir="$1"
  local destination_root="$2"
  local platform_id="$3"
  local destination_dir="${destination_root}/${platform_id}"
  local patterns=("-name" "omega_transform_*.so")

  if [[ "$platform_id" == windows-* ]]; then
    patterns=("-name" "omega_transform_*.dll")
  elif [[ "$platform_id" == macos-* ]]; then
    patterns=("(" "-name" "omega_transform_*.dylib" "-o" "-name" "omega_transform_*.so" ")")
  fi

  if [[ ! -d "$source_dir" ]]; then
    echo "Transform plugin directory not found: $source_dir"
    exit 1
  fi

  rm -rf "$destination_root"
  mkdir -p "$destination_dir"
  find "$source_dir" -maxdepth 1 -type f "${patterns[@]}" -exec cp {} "$destination_dir" \;

  local plugin_count
  plugin_count="$(find "$destination_dir" -maxdepth 1 -type f | wc -l | tr -d '[:space:]')"
  if [[ "${plugin_count:-0}" -eq 0 ]]; then
    echo "No transform plugins found in $source_dir for $platform_id"
    exit 1
  fi

  if [[ "$platform_id" != windows-* ]]; then
    chmod 755 "$destination_dir"/omega_transform_* || true
  fi

  echo "Staged ${plugin_count} transform plugins for ${platform_id}"
}

ensure_conan() {
  if command -v conan >/dev/null 2>&1; then
    conan --version
    return
  fi

  echo "Conan was not found on PATH; bootstrapping ${conan_venv_dir}."
  if [[ ! -d "$conan_venv_dir" ]]; then
    local python_cmd
    python_cmd="$(find_python)"
    "$python_cmd" -m venv "$conan_venv_dir"
  fi

  activate_conan_venv
  if ! command -v conan >/dev/null 2>&1; then
    python -m pip install --upgrade pip
    python -m pip install conan
  fi

  conan --version
}

ensure_conan_profile() {
  if conan profile path default >/dev/null 2>&1; then
    return
  fi

  echo "Conan default profile was not found; detecting one for this machine."
  conan profile detect --force
}

ensure_conan
ensure_conan_profile

if [[ -n "$toolchain" && -z "$toolchain_file" ]]; then
  toolchain_file="${PWD}/toolchains/${toolchain}.cmake"
fi

if [[ -n "$toolchain_file" ]]; then
  if [[ ! -f "$toolchain_file" ]]; then
    echo "Toolchain file not found: $toolchain_file"
    exit 1
  fi
  cmake_extra_args=-DCMAKE_TOOLCHAIN_FILE=${toolchain_file}
fi

for objtype in shared static; do
  build_shared_libs="NO"
  if [[ $objtype == "shared" ]]; then
    build_shared_libs="YES"
  fi

  rm -rf "build-${objtype}-$type" "${install_dir}-${objtype}-$type"
  # shellcheck disable=SC2090
  cmake -G "$generator" -S . -B "build-${objtype}-$type" $cmake_extra_args -DBUILD_SHARED_LIBS="$build_shared_libs" -DBUILD_DOCS="$build_docs" -DCMAKE_BUILD_TYPE="$type"
  cmake --build "build-${objtype}-$type" --config "$type"
  ctest -C "$type" --test-dir "build-${objtype}-${type}/core" --output-on-failure
  if [[ -d "build-${objtype}-${type}/plugins" ]]; then
    ctest -C "$type" --test-dir "build-${objtype}-${type}/plugins" --output-on-failure
  fi
  cmake --install "build-${objtype}-${type}/packages/core" --prefix "${install_dir}-${objtype}-$type" --config "$type"
  cpack --config "build-${objtype}-${type}/CPackSourceConfig.cmake"
  cpack --config "build-${objtype}-${type}/CPackConfig.cmake" -C "$type"
done

# OE_LIB_DIR is used by native code to bundle the proper library file
# NOTE: Windows uses bin for shared libraries, and non-Windows uses lib
if [[ -d "${install_dir}-shared-${type}/bin" ]]; then
  export OE_LIB_DIR="$(readlink -f "${install_dir}-shared-${type}/bin")"
else
  export OE_LIB_DIR="$(readlink -f "${install_dir}-shared-${type}/lib")"
fi
export OE_PREFIX="$(readlink -f "${install_dir}-shared-${type}")"

# Copy the shared library to the _install directory
if [[ -d "$OE_LIB_DIR" ]]; then
  rm -rf _install
  # Use cp instead of a symlink so it works on Windows
  cp -a "$OE_LIB_DIR" _install
fi

# Configure and build the native gRPC server before packaging @omega-edit/server.
# The package build can rebuild an existing server/cpp/build tree, but it
# intentionally does not create one from scratch.
(
  cd server/cpp
  conan install . --output-folder=build \
    --build=missing \
    -s build_type="$type" \
    -s compiler.cppstd=17 \
    -c "tools.cmake.cmaketoolchain:generator=$generator"
  cmake -G "$generator" -S . -B build \
    -DCMAKE_BUILD_TYPE="$type" \
    -DCMAKE_TOOLCHAIN_FILE="build/conan_toolchain.cmake" \
    -DOE_LIB_DIR="$OE_LIB_DIR" \
    -DCMAKE_PREFIX_PATH="$OE_PREFIX"
  cmake --build build --config "$type"
)

# Install common packages and check lint for client and server
yarn install
yarn lint

# Packages modules in ./packages/{client, server}
./packages/build.sh -fc

# Execute client module tests (covers C++ server integration)
yarn workspace @omega-edit/client test

# Package all Node artifacts, then package the VS Code extension into a VSIX
# using the freshly built local client and server tarballs.
root_dir="$PWD"
pkg_version="$(node -p "require('./package.json').version")"

yarn workspace @omega-edit/server package
yarn workspace @omega-edit/client package
yarn workspace @omega-edit/ai package

vsix_stage="$(mktemp -d)"
transform_plugins_stage="$(mktemp -d)"
cleanup_vsix_stage() {
  rm -rf "$vsix_stage" "$transform_plugins_stage"
}
trap cleanup_vsix_stage EXIT

transform_plugin_platform="$(detect_vscode_transform_platform)"
stage_vscode_transform_plugins \
  "${root_dir}/build-shared-${type}/core/src/tests/plugins" \
  "$transform_plugins_stage" \
  "$transform_plugin_platform"

cp -R vscode-extension/. "$vsix_stage"
(
  cd "$vsix_stage"
  npm pkg set "dependencies.@omega-edit/client=${pkg_version}"
  npm install --no-save \
    "${root_dir}/packages/server/omega-edit-node-server-v${pkg_version}.tgz" \
    "${root_dir}/packages/client/omega-edit-node-client-v${pkg_version}.tgz"
  npm run stage:transform-plugins -- "$transform_plugins_stage" --platform "$transform_plugin_platform"
  npm run package:vsix
)
cp "$vsix_stage/omega-edit-data-editor.vsix" "${root_dir}/vscode-extension/"

echo "✔ Done! ✨"
