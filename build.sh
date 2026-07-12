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

case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) is_windows="YES" ;;
  *) is_windows="NO" ;;
esac

# Convert a path into a form that native tools (CMake, Conan, node) accept.
# On Windows (Git Bash) this yields a mixed "D:/path" that both POSIX
# coreutils and native Windows programs understand; elsewhere it is a no-op
# resolve via readlink.
to_native_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    readlink -f "$1"
  fi
}

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

setup_msvc_env() {
  [[ "$is_windows" == "YES" ]] || return 0

  # Already inside a Developer prompt / vcvars-initialized shell. Finding cl is
  # not enough: CMake can cache a full cl.exe path while INCLUDE/LIB are missing,
  # which leaves the compiler unable to find standard Windows/MSVC headers.
  if command -v cl >/dev/null 2>&1 && [[ -n "${INCLUDE:-}" && -n "${LIB:-}" ]]; then
    return 0
  fi

  local vswhere="/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe"
  if [[ ! -f "$vswhere" ]]; then
    echo "MSVC compiler (cl) is not on PATH and vswhere.exe was not found." >&2
    echo "Run this script from a Visual Studio Developer prompt, or install Visual Studio with the C++ workload." >&2
    exit 1
  fi

  local vs_install
  vs_install="$("$vswhere" -latest -products '*' \
    -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 \
    -property installationPath | tr -d '\r')"
  if [[ -z "$vs_install" ]]; then
    echo "No Visual Studio installation with the C++ toolset was found via vswhere." >&2
    exit 1
  fi

  local vcvars="${vs_install}\\VC\\Auxiliary\\Build\\vcvars64.bat"
  echo "Initializing the MSVC environment from ${vcvars}"

  # Run vcvars64.bat in cmd and import the variables it sets into this shell.
  # Embedded quotes get mangled when passing a command string through the MSYS
  # layer to cmd.exe, so drive cmd from a throwaway batch file instead.
  local bat="${TMPDIR:-/tmp}/oe-vcvars-$$.bat"
  {
    printf '@echo off\r\n'
    printf 'call "%s" >nul 2>&1\r\n' "$vcvars"
    printf 'set\r\n'
  } > "$bat"

  local env_dump
  if ! env_dump="$(cmd //c "$(cygpath -w "$bat")")"; then
    rm -f "$bat"
    echo "Failed to initialize the MSVC environment via vcvars64.bat" >&2
    exit 1
  fi
  rm -f "$bat"

  local line key value
  while IFS= read -r line; do
    line="${line%$'\r'}"
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      PATH | Path)
        # Convert the Windows PATH list to POSIX so cl/link/rc are resolvable.
        export PATH="$(cygpath -u -p "$value"):${PATH}"
        ;;
      INCLUDE | LIB | LIBPATH)
        # Consumed by the native toolchain; keep Windows-style values verbatim.
        export "${key}=${value}"
        ;;
    esac
  done <<< "$env_dump"

  if ! command -v cl >/dev/null 2>&1; then
    echo "MSVC environment initialization did not place cl on PATH." >&2
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

# The transform plugins depend on zlib and OpenSSL 3. On Linux/macOS these are
# expected from system packages (apt/brew); on Windows there is no system
# OpenSSL, so provide them through Conan and feed the generated toolchain to the
# top-level CMake configure, mirroring the CI build-native action.
plugin_conan_dir="${PWD}/build-plugin-conan"
ensure_plugin_deps() {
  [[ "$is_windows" == "YES" ]] || return 0

  node scripts/conan-install.js \
    --conanfile plugins/conanfile.py \
    --output-folder "$plugin_conan_dir" \
    --package protobuf \
    -- \
    conan install plugins --output-folder="$plugin_conan_dir" \
      --build=missing \
      -s build_type="$type" \
      ${CONAN_MSBUILD_VS_CONF:-} \
      -c "tools.cmake.cmaketoolchain:generator=$generator"

  local toolchain
  toolchain="$(to_native_path "${plugin_conan_dir}/conan_toolchain.cmake")"
  if [[ -n "$cmake_extra_args" ]]; then
    echo "WARNING: a toolchain is already configured; not adding the Conan plugin toolchain." >&2
  else
    cmake_extra_args="-DCMAKE_TOOLCHAIN_FILE=${toolchain}"
  fi
}

setup_msvc_env
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
  cmake_extra_args=-DCMAKE_TOOLCHAIN_FILE=$(to_native_path "${toolchain_file}")
fi

ensure_plugin_deps

shared_build_dir=""
for objtype in shared static; do
  build_shared_libs="NO"
  if [[ $objtype == "shared" ]]; then
    build_shared_libs="YES"
  fi

  preferred_build_dir="build-${objtype}-$type"
  build_dir="$preferred_build_dir"
  if ! rm -rf "$preferred_build_dir" 2>/dev/null; then
    build_dir="${preferred_build_dir}-fresh-$(date +%s)-$$"
    echo "WARNING: Unable to remove ${preferred_build_dir}; using ${build_dir} instead." >&2
  fi
  rm -rf "${install_dir}-${objtype}-$type"
  if [[ $objtype == "shared" ]]; then shared_build_dir="$build_dir"; fi
  # shellcheck disable=SC2090
  cmake -G "$generator" -S . -B "$build_dir" $cmake_extra_args -DBUILD_SHARED_LIBS="$build_shared_libs" -DBUILD_DOCS="$build_docs" -DCMAKE_BUILD_TYPE="$type"
  cmake --build "$build_dir" --config "$type"
  ctest -C "$type" --test-dir "$build_dir/core" --output-on-failure
  if [[ -d "$build_dir/plugins" ]]; then
    ctest -C "$type" --test-dir "$build_dir/plugins" --output-on-failure
  fi
  cmake --install "$build_dir/packages/core" --prefix "${install_dir}-${objtype}-$type" --config "$type"
  package_dir="$build_dir/package"
  package_version="$(tr -d '\r\n' < VERSION)"
  source_package="${package_dir}/omega_edit-${package_version}.tar.gz"
  mkdir -p "$package_dir"
  git archive --format=tar.gz --prefix="omega_edit-${package_version}/" --output="$source_package" HEAD
  node scripts/verify-package-contents.js source "$source_package"

  cpack --config "$build_dir/CPackConfig.cmake" -C "$type"

  binary_packages=("${package_dir}/omega_edit-"*)
  for package_path in "${binary_packages[@]}"; do
    if [[ -f "$package_path" && "$package_path" != "$source_package" ]]; then
      node scripts/verify-package-contents.js core "$package_path"
    fi
  done
done

# OE_LIB_DIR is used by native code to bundle the proper library file
# NOTE: Windows uses bin for shared libraries, and non-Windows uses lib
if [[ -d "${install_dir}-shared-${type}/bin" ]]; then
  export OE_LIB_DIR="$(to_native_path "${install_dir}-shared-${type}/bin")"
else
  export OE_LIB_DIR="$(to_native_path "${install_dir}-shared-${type}/lib")"
fi
export OE_PREFIX="$(to_native_path "${install_dir}-shared-${type}")"

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
  "${root_dir}/${shared_build_dir}/core/src/tests/plugins" \
  "$transform_plugins_stage" \
  "$transform_plugin_platform"

cp -R vscode-extension/. "$vsix_stage"
# These paths are consumed by native node/npm, so pass them in native form.
server_tgz="$(to_native_path "${root_dir}/packages/server/omega-edit-node-server-v${pkg_version}.tgz")"
client_tgz="$(to_native_path "${root_dir}/packages/client/omega-edit-node-client-v${pkg_version}.tgz")"
transform_plugins_stage_native="$(to_native_path "$transform_plugins_stage")"
(
  cd "$vsix_stage"
  npm pkg set "devDependencies.@omega-edit/client=${pkg_version}"
  npm install --no-save "$server_tgz" "$client_tgz"
  npm run stage:transform-plugins -- "$transform_plugins_stage_native" --platform "$transform_plugin_platform"
  npm run package:vsix
)
cp "$vsix_stage/omega-edit-data-editor.vsix" "${root_dir}/vscode-extension/"

echo "✔ Done! ✨"
