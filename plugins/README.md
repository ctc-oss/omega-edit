# Omega Edit Transform Plugins

This package builds the native transform plugins for Omega Edit.

The plugins consume the Omega Edit transform plugin ABI and SDK from the core
package. Third-party transform dependencies, such as libmagic, CLD3, zlib, and OpenSSL 3, are
owned here rather than by the core library.

Transform plugin metadata includes a description, help text, example arguments,
default arguments, and an optional JSON Schema for validating options on both
the client and native apply path. The bitwise exemplar exposes one action with
an `operator` field plus a single repeated byte or repeating mask sequence, for
example `{"operator":"xor","byte":"0x42"}` or
`{"operator":"and","mask":["0x0F","0xF0"]}`. The zlib exemplar exposes an
`action` field for compression or decompression; compression accepts `level`
values from `-1` through `9`, and decompression accepts `maxOutputBytes` with a
64 MiB default cap.
The production detector plugins provide on-demand MIME content type detection
(`omega.detect.content_type`) and language detection (`omega.detect.language`).
Content type detection uses libmagic when available and falls back to built-in
signatures/text heuristics. Language detection uses CLD3 and accepts a
`byteOrderMark` option for UTF-16/UTF-32 input.
The richer data-format exemplars cover digest/hash inspection, AES cipher
transforms, CRC/checksum inspection, binary-to-text codecs, character set
transcoding, decimal field encodings, byte-order swaps, record/text escaping
helpers, and lightweight format inspectors for TLV-style data. The base58 text
codec is intentionally capped at 64 KiB selections because its exemplar
implementation is quadratic. The OpenSSL
exemplars use OpenSSL 3's EVP API to calculate MD5, SHA-1, SHA-2, SHA-3, and
BLAKE2 inspect-only text results and to encrypt/decrypt selected bytes with
AES-CBC or AES-CTR. MD5 and SHA-1 are included for legacy formats,
interoperability checks, and low-security data inspection workflows; do not use
them for security-sensitive authentication or integrity decisions. The cipher
exemplar accepts raw key and IV/counter bytes as hex; it does not derive keys or
authenticate ciphertext.

Plugins should poll `omega_transform_plugin_sdk_is_cancelled()` during long
loops, between streaming reads, and around expensive library calls. When it
returns non-zero, stop promptly, release any resources not owned by the response,
and return a non-zero apply result. The host releases SDK-allocated buffers that
were not transferred in a successful response.

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
can exercise the production and exemplar plugins.
