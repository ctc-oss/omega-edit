# Transform Plugins

OmegaEdit transform plugins are native shared libraries that can be discovered by the
gRPC server and applied to a byte range in a session. They are intended for reusable
range operations that should live outside the core editor engine, such as encoding,
decoding, compression, checksums, hashes, or binary-safe one-for-one byte transforms.

Plugins are loaded from ordinary platform shared-library files:

| Platform | Extension |
| --- | --- |
| Linux | `.so` |
| macOS | `.dylib` |
| Windows | `.dll` |

The native ABI is declared in:

- `core/src/include/omega_edit/transform.h`
- `core/src/include/omega_edit/transform_plugin_sdk.h`

## Operation Modes

Each plugin advertises one operation mode:

| Mode | Behavior |
| --- | --- |
| `OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE` | Produces replacement bytes for the selected range. Content changes unless the response explicitly reports no content change. |
| `OMEGA_TRANSFORM_PLUGIN_OPERATION_INSPECT` | Leaves content unchanged and returns result bytes, such as a checksum or hash. |
| `OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE_AND_INSPECT` | Produces replacement bytes and an inspection result. |

Plugins also advertise flags:

| Flag | Meaning |
| --- | --- |
| `OMEGA_TRANSFORM_PLUGIN_FLAG_ONE_FOR_ONE` | Replacement length is expected to match input length. |
| `OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_EXPAND` | Replacement may be longer than input. |
| `OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_SHRINK` | Replacement may be shorter than input. |
| `OMEGA_TRANSFORM_PLUGIN_FLAG_TEXT_RESULT` | Inspection result bytes should be treated as text. |
| `OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE` | Plugin can operate on arbitrary bytes. |

Flags are metadata for discovery and user interfaces. The server still validates the
actual response it receives from the plugin before applying it.

## ABI Contract

A plugin must export two C ABI functions:

```c
OMEGA_TRANSFORM_PLUGIN_EXPORT int
omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr);

OMEGA_TRANSFORM_PLUGIN_EXPORT int
omega_transform_plugin_apply(
    const omega_transform_plugin_request_t *request_ptr,
    omega_transform_plugin_response_t *response_ptr);
```

`omega_transform_plugin_get_info` fills out stable metadata:

```c
info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
info_ptr->id = "omega.example.my_plugin";
info_ptr->name = "My Plugin";
info_ptr->description = "What this plugin does.";
info_ptr->help = "Choose the byte value to apply.";
info_ptr->example = "{\"byte\":\"0x42\"}";
info_ptr->default_args = "{\"byte\":\"0xFF\"}";
info_ptr->args_schema = "{\"type\":\"object\",\"properties\":{...}}";
info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE;
info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
```

The plugin ID must be unique across all registered plugins. A reverse-DNS style ID
is recommended, for example `com.example.base64`.

`description`, `help`, `example`, `default_args`, and `args_schema` are discovery
metadata for clients. When `args_schema` is set, callers should validate
`options_json` with the advertised JSON Schema before applying the transform; the
native transform registry also validates the same schema before invoking the plugin.
Transforms that do not accept JSON options should leave `args_schema`, `example`,
and `default_args` empty. Supplying options to a transform without an advertised
schema is rejected by the native apply path.

`omega_transform_plugin_apply` receives:

| Field | Description |
| --- | --- |
| `input_bytes` / `input_length` | Bytes selected from the current session range. |
| `session_offset` | Range start offset in the session. |
| `session_length` | Requested range length after clamping to the session end. |
| `options_json` | Optional plugin-specific JSON string supplied by the caller. |
| `alloc` / `allocator_user_data_ptr` | Allocator that must be used for response-owned memory. |

The plugin returns replacement bytes and/or result bytes through
`omega_transform_plugin_response_t`.

Important rules:

- Return `0` on success and non-zero on failure.
- Validate null pointers and negative lengths.
- Allocate all response memory through `request_ptr->alloc` or the SDK helpers.
- Do not free response memory yourself after assigning it to the response.
- Use `OMEGA_TRANSFORM_PLUGIN_RESPONSE_NO_CONTENT_CHANGE` for successful replace operations
  that intentionally leave the selected content untouched.
- Treat `options_json` as optional; it may be null.
- Keep plugin entry points thread-safe. The server serializes access to the registry,
  but plugin code should not rely on mutable global state unless it protects it.

## SDK Helpers

Include the SDK header for export macros and allocation helpers:

```c
#include <omega_edit/transform_plugin_sdk.h>
```

Useful helpers:

| Helper | Purpose |
| --- | --- |
| `OMEGA_TRANSFORM_PLUGIN_EXPORT` | Exports plugin entry points on all supported platforms. |
| `omega_transform_plugin_sdk_alloc` | Allocates response memory with the server-provided allocator. |
| `omega_transform_plugin_sdk_copy_bytes` | Copies byte ranges into response-owned memory. |
| `omega_transform_plugin_sdk_copy_cstring` | Copies C strings into response-owned memory. |
| `omega_transform_plugin_sdk_set_replacement` | Fills replacement bytes and length. |
| `omega_transform_plugin_sdk_set_no_content_change` | Marks a successful replace operation as having no content changes. |
| `omega_transform_plugin_sdk_set_text_result` | Fills text result bytes, label, and MIME type. |

## Minimal Plugin

This one-for-one example inverts every byte in the selected range:

```c
#include <omega_edit/transform_plugin_sdk.h>

OMEGA_TRANSFORM_PLUGIN_EXPORT int
omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) return -1;
    info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
    info_ptr->id = "com.example.xor";
    info_ptr->name = "XOR";
    info_ptr->description = "XOR every byte in the selected range.";
    info_ptr->help = "Choose the byte value to XOR with each selected byte.";
    info_ptr->example = "{\"byte\":\"0x42\"}";
    info_ptr->default_args = "{\"byte\":\"0xFF\"}";
    info_ptr->args_schema =
        "{\"type\":\"object\",\"properties\":{\"byte\":{\"type\":\"string\"}},"
        "\"additionalProperties\":false}";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE;
    info_ptr->flags =
        OMEGA_TRANSFORM_PLUGIN_FLAG_ONE_FOR_ONE |
        OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
    return 0;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int
omega_transform_plugin_apply(
    const omega_transform_plugin_request_t *request_ptr,
    omega_transform_plugin_response_t *response_ptr) {
    if (!request_ptr || !response_ptr || request_ptr->input_length < 0) {
        return -1;
    }

    omega_byte_t *bytes = omega_transform_plugin_sdk_copy_bytes(
        request_ptr, request_ptr->input_bytes, request_ptr->input_length);
    if (!bytes) return -1;

    for (int64_t i = 0; i < request_ptr->input_length; ++i) {
        bytes[i] = request_ptr->input_bytes[i] ^ 0xff;
    }

    response_ptr->replacement_bytes = bytes;
    response_ptr->replacement_length = request_ptr->input_length;
    return 0;
}
```

## Building Plugins

Plugins are CMake `MODULE` libraries in the standalone top-level `plugins/`
package. The repository root build also includes that package so tests and local
development can use the exemplars:

```bash
cmake -S . -B _build -DCMAKE_BUILD_TYPE=Release -DBUILD_EXAMPLES=ON
cmake --build _build --config Release --target omega_edit_transform_plugins
```

The current repository-root test output directory is:

```text
_build/core/src/tests/plugins/
```

To build and package only the transform plugins, install the core package first,
then configure `plugins/` with its Conan-generated toolchain and the installed
core prefix on `CMAKE_PREFIX_PATH`.

The filename does not determine the plugin ID. The plugin ID comes from
`omega_transform_plugin_get_info`.

## Plugin Directory Layout

At runtime, put one or more plugin shared libraries in a directory:

```text
plugins/
|- omega_transform_base64.dll
|- omega_transform_bitwise.dll
|- omega_transform_character_transcode.dll
|- omega_transform_common_checksums.dll
|- omega_transform_decimal_codecs.dll
|- omega_transform_endian_swap.dll
|- omega_transform_format_inspectors.dll
|- omega_transform_openssl_digests.dll
|- omega_transform_record_text_helpers.dll
|- omega_transform_text_codecs.dll
|- omega_transform_zlib.dll
`- omega_transform_repeat.dll
```

Use the platform extension for your target operating system. Non-plugin files in
the directory are ignored if they cannot be loaded or do not expose the required
symbols.

## Registering Plugins

Native API:

```c
omega_transform_plugin_registry_t *registry =
    omega_transform_plugin_registry_create();

omega_transform_plugin_registry_register_directory(registry, "./plugins");
```

Native gRPC server CLI:

```bash
omega-edit-grpc-server --port=9000 --transform-plugin-dir ./plugins
```

The flag can be repeated. The server also reads a platform-path-list environment
variable:

```bash
OMEGA_EDIT_TRANSFORM_PLUGIN_DIRS="./plugins:./more-plugins"
```

On Windows, use semicolons:

```powershell
$env:OMEGA_EDIT_TRANSFORM_PLUGIN_DIRS = ".\plugins;.\more-plugins"
```

TypeScript server launcher:

```typescript
import { runServer } from '@omega-edit/server'

await runServer(9000, '127.0.0.1', undefined, {
  transformPluginDirectories: ['./plugins'],
})
```

## Discovering and Applying Plugins

TypeScript client:

```typescript
import {
  applyTransformPlugin,
  createSession,
  listTransformPlugins,
  startServer,
} from '@omega-edit/client'

await startServer(9000, '127.0.0.1', undefined, {
  transformPluginDirectories: ['./plugins'],
})

const plugins = await listTransformPlugins()
console.log(plugins.map((plugin) => plugin.id))

const sessionId = (await createSession('input.bin')).getSessionId()
const result = await applyTransformPlugin(
  sessionId,
  'omega.example.common_checksums',
  0,
  1024,
  JSON.stringify({ algorithm: 'sum8' })
)
console.log(Buffer.from(result.result).toString('utf8'))
```

AI CLI:

```bash
oe list-transform-plugins
oe apply-transform-plugin \
  --session <session-id> \
  --plugin omega.example.common_checksums \
  --offset 0 \
  --length 1024 \
  --options-json '{"algorithm":"sum8"}'
oe apply-transform-plugin \
  --session <session-id> \
  --plugin omega.example.base64 \
  --offset 0 \
  --length 1024 \
  --options-json '{"direction":"encode"}'
oe apply-transform-plugin \
  --session <session-id> \
  --plugin omega.example.openssl_digests \
  --offset 0 \
  --length 1024 \
  --options-json '{"algorithm":"sha256"}'
oe apply-transform-plugin \
  --session <session-id> \
  --plugin omega.example.zlib \
  --offset 0 \
  --length 1024 \
  --options-json '{"action":"compress","level":9}'
```

MCP tools:

- `omega_edit_list_transform_plugins`
- `omega_edit_apply_transform_plugin`

## Exemplar Plugins

The repository ships small examples in `plugins/src/`:

| Plugin ID | Source | Operation | Demonstrates |
| --- | --- | --- | --- |
| `omega.example.base64` | `base64.c` | Replace | Base64 encode/decode with a `direction` option. Decoding tolerates ASCII whitespace; other invalid bytes fail. |
| `omega.example.bitwise` | `bitwise.c` | Replace | One-for-one binary-safe AND/OR/XOR transform with `operator`, `byte`, and `mask` options; defaults to XOR with `0xFF`. |
| `omega.example.case_change` | `case_change.c` | Replace | ASCII upper/lower case conversion with no-content-change reporting when the range is already in the requested case. |
| `omega.example.character_transcode` | `character_transcode.cpp` | Replace | Transcoding between UTF-8/16/32, ASCII, ISO-8859-1, Windows-1252, and common single-byte EBCDIC pages. |
| `omega.example.common_checksums` | `common_checksums.cpp` | Inspect | CRC, Adler, Fletcher, internet checksum, LRC/BCC, sum, FNV, Murmur3, and xxHash variants. |
| `omega.example.decimal_codecs` | `decimal_codecs.cpp` | Replace | BCD, packed decimal/COMP-3, zoned decimal, and signed overpunch encode/decode helpers. |
| `omega.example.endian_swap` | `endian_swap.cpp` | Replace | Fixed-width 2/4/8-byte endian swaps. |
| `omega.example.format_inspectors` | `format_inspectors.cpp` | Inspect | Protobuf varint, ASN.1 BER/DER TLV, and configurable TLV summaries. |
| `omega.example.openssl_digests` | `openssl_digests.c` | Inspect | MD5, SHA-1, SHA-2, SHA-3, and BLAKE2 digest calculation using OpenSSL 3 without changing session content. |
| `omega.example.record_text_helpers` | `record_text_helpers.cpp` | Replace | Newline normalization, fixed-width lines, delimiter escaping, CSV quoting, XML entities, and JSON string escaping. |
| `omega.example.text_codecs` | `text_codecs.cpp` | Replace | Hex/base16, Base64URL, Base32, Base32-Crockford, Ascii85/Base85, Z85, Base58, percent/URL, quoted-printable, uuencode, and yEnc encode/decode helpers. Base58 is capped at 64 KiB selections. |
| `omega.example.zlib` | `zlib.c` | Replace | Zlib compression/decompression with an `action` option. Compression accepts `level` values from `-1` through `9`; decompression accepts `maxOutputBytes` with a 64 MiB default cap. |
| `omega.example.repeat` | `repeat.c` | Replace | Expansion by replacing a range with two copies of itself. |

These examples are intentionally small so they can serve as test fixtures and copyable
developer starting points. Third-party dependencies belong to the plugin package,
not the core ABI/loader package; the zlib and OpenSSL digest exemplars use
`plugins/conanfile.py`.

MD5 and SHA-1 are provided for legacy formats, interoperability checks, and
low-security data inspection workflows. Do not use them for security-sensitive
authentication or integrity decisions.

The character transcode exemplar focuses on cross-platform single-byte charsets
and Unicode encodings. DBCS EBCDIC variants should be added from a dedicated
code-page table source rather than guessed from regional samples.

## Release Notes for Plugin Authors

The current ABI version is `1`.

When changing the ABI:

1. Bump `OMEGA_TRANSFORM_PLUGIN_ABI_VERSION`.
2. Keep the server's load-time ABI validation strict.
3. Update this page and the exemplar plugins.
4. Mention the ABI version change in release notes.

When adding release plugins:

1. Put source under `plugins/src/`.
2. Add the source file to the plugin target list in `plugins/CMakeLists.txt`.
3. Add native registry/harness coverage under `plugins/tests/`.
4. Add client or AI coverage if the plugin exercises new behavior.
5. Document the plugin ID, operation, options JSON, and result format.

## See Also

- [Home](Home)
- [Embedding OmegaEdit Core](Embedding-OmegaEdit-Core)
- [`plugins/src/`](https://github.com/ctc-oss/omega-edit/tree/main/plugins/src)
- [`plugins/tools/transform_plugin_harness.cpp`](https://github.com/ctc-oss/omega-edit/blob/main/plugins/tools/transform_plugin_harness.cpp)
