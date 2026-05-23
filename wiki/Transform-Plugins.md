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
| `OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE` | Produces replacement bytes for the selected range. Content changes if the selected range or replacement is non-empty. |
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
info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE;
info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
```

The plugin ID must be unique across all registered plugins. A reverse-DNS style ID
is recommended, for example `com.example.base64_encode`.

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
| `omega_transform_plugin_sdk_set_text_result` | Fills text result bytes, label, and MIME type. |

## Minimal Plugin

This one-for-one example inverts every byte in the selected range:

```c
#include <omega_edit/transform_plugin_sdk.h>

OMEGA_TRANSFORM_PLUGIN_EXPORT int
omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) return -1;
    info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
    info_ptr->id = "com.example.xor_ff";
    info_ptr->name = "XOR 0xFF";
    info_ptr->description = "Invert every byte in the selected range.";
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

Plugins are CMake `MODULE` libraries in this repository. The exemplar plugins are
built when either `BUILD_EXAMPLES=ON` or `BUILD_TESTS=ON`:

```bash
cmake -S . -B _build -DCMAKE_BUILD_TYPE=Release -DBUILD_EXAMPLES=ON
cmake --build _build --config Release --target omega_edit_transform_plugins
```

The current in-repo output directory is:

```text
_build/packages/core/src/tests/plugins/
```

The filename does not determine the plugin ID. The plugin ID comes from
`omega_transform_plugin_get_info`.

## Plugin Directory Layout

At runtime, put one or more plugin shared libraries in a directory:

```text
plugins/
|- omega_transform_base64_decode.dll
|- omega_transform_base64_encode.dll
|- omega_transform_fnv1a64.dll
|- omega_transform_zlib_compress.dll
|- omega_transform_zlib_decompress.dll
|- omega_transform_xor_ff.dll
|- omega_transform_repeat.dll
`- omega_transform_checksum8.dll
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
  'omega.example.checksum8',
  0,
  1024
)
console.log(Buffer.from(result.result).toString('utf8'))
```

AI CLI:

```bash
oe list-transform-plugins
oe apply-transform-plugin \
  --session <session-id> \
  --plugin omega.example.checksum8 \
  --offset 0 \
  --length 1024
oe apply-transform-plugin \
  --session <session-id> \
  --plugin omega.example.base64_encode \
  --offset 0 \
  --length 1024
oe apply-transform-plugin \
  --session <session-id> \
  --plugin omega.example.zlib_compress \
  --offset 0 \
  --length 1024
```

MCP tools:

- `omega_edit_list_transform_plugins`
- `omega_edit_apply_transform_plugin`

## Exemplar Plugins

The repository ships small examples in `core/src/plugins/`:

| Plugin ID | Source | Operation | Demonstrates |
| --- | --- | --- | --- |
| `omega.example.base64_encode` | `base64_encode.c` | Replace | Expansion by encoding arbitrary bytes as base64 text. |
| `omega.example.base64_decode` | `base64_decode.c` | Replace | Shrinking text content back to decoded bytes, with validation. ASCII whitespace is tolerated; other invalid bytes fail. |
| `omega.example.fnv1a64` | `fnv1a64.c` | Inspect | 64-bit hash calculation without changing session content. |
| `omega.example.zlib_compress` | `zlib_compress.c` | Replace | Valid zlib streams using stored DEFLATE blocks, without a required external dependency. |
| `omega.example.zlib_decompress` | `zlib_decompress.c` | Replace | Shrinking stored-block zlib streams back to the original bytes, with header and checksum validation. |
| `omega.example.xor_ff` | `xor_ff.c` | Replace | One-for-one binary-safe byte transform. |
| `omega.example.repeat` | `repeat.c` | Replace | Expansion by replacing a range with two copies of itself. |
| `omega.example.checksum8` | `checksum8.c` | Inspect | Text result without changing session content. |

These examples are intentionally small so they can serve as test fixtures and copyable
developer starting points.

The zlib examples intentionally avoid a required external compression dependency:
`omega.example.zlib_compress` emits valid zlib streams with stored DEFLATE blocks,
and `omega.example.zlib_decompress` accepts that stored-block subset with zlib header
and Adler-32 validation. Because stored blocks have no compression level, the exemplar
compressor intentionally ignores `options_json`; a production compression plugin can use
that field for settings such as compression level.

## Release Notes for Plugin Authors

The current ABI version is `1`.

When changing the ABI:

1. Bump `OMEGA_TRANSFORM_PLUGIN_ABI_VERSION`.
2. Keep the server's load-time ABI validation strict.
3. Update this page and the exemplar plugins.
4. Mention the ABI version change in release notes.

When adding release plugins:

1. Put source under `core/src/plugins/`.
2. Add the source file to the plugin target list in `core/CMakeLists.txt`.
3. Add native registry/harness coverage.
4. Add client or AI coverage if the plugin exercises new behavior.
5. Document the plugin ID, operation, options JSON, and result format.

## See Also

- [Home](Home)
- [Embedding OmegaEdit Core](Embedding-OmegaEdit-Core)
- [`core/src/plugins/`](https://github.com/ctc-oss/omega-edit/tree/main/core/src/plugins)
- [`core/src/tools/transform_plugin_harness.cpp`](https://github.com/ctc-oss/omega-edit/blob/main/core/src/tools/transform_plugin_harness.cpp)
