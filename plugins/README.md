# Omega Edit Transform Plugins

This package builds the exemplar native transform plugins for Omega Edit.

The plugins consume the Omega Edit transform plugin ABI and SDK from the core
package. Third-party transform dependencies, such as zlib and OpenSSL 3, are
owned here rather than by the core library.

Transform plugin metadata includes a description, help text, example arguments,
default arguments, and an optional JSON Schema for validating options on both
the client and native apply path. The bitwise exemplars accept options JSON with
a single repeated byte or a repeating mask sequence, for example
`{"byte":"0x42"}` or `{"mask":["0x0F","0xF0"]}`. The zlib compression
exemplar accepts `{"level":9}`, with valid levels from `-1` through `9`.
The richer data-format exemplars cover digest/hash inspection, CRC/checksum
inspection, binary-to-text codecs, character set transcoding, decimal field
encodings, byte-order swaps, record/text escaping helpers, and lightweight
format inspectors for TLV-style data. The digest exemplars use OpenSSL 3's EVP
API to calculate MD5, SHA-1, SHA-2, SHA-3, and BLAKE2 inspect-only text
results. MD5 and SHA-1 are included for legacy formats, interoperability checks,
and low-security data inspection workflows; do not use them for
security-sensitive authentication or integrity decisions.

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
