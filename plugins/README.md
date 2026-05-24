# Omega Edit Transform Plugins

This package builds the exemplar native transform plugins for Omega Edit.

The plugins consume the Omega Edit transform plugin ABI and SDK from the core
package. Third-party transform dependencies, such as zlib, are owned here rather
than by the core library.

The bitwise exemplars accept options JSON with a single byte or a repeating
byte sequence, for example `{"byte":"0x42"}` or
`{"bytes":["0x0F","0xF0"]}`. The same sequence form is accepted as `mask`.

## Build

Install dependencies with Conan, then configure this directory with the generated
toolchain and an installed Omega Edit core package on `CMAKE_PREFIX_PATH`:

```bash
conan install . --output-folder=build --build=missing -s build_type=Release
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_TOOLCHAIN_FILE=build/conan_toolchain.cmake \
  -DCMAKE_PREFIX_PATH=/path/to/omega_edit/prefix
cmake --build build --config Release
cmake --install build --prefix /path/to/plugin/prefix --config Release
```

The repository root build also includes this project so native and client tests
can exercise the exemplar plugins.
