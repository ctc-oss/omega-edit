# Embedding OmegaEdit Core

OmegaEdit core is already structured to be embedded directly into another native project. This page documents the three supported integration patterns and the runtime tradeoffs to think through before you ship.

## Choose an Integration Pattern

Use one of these patterns depending on how much of the OmegaEdit repository you want to bring into your build:

1. `add_subdirectory(<omega-edit-repo>)`

   Best when you vendor the full repository and want OmegaEdit to behave like a lean subproject.

2. `add_subdirectory(<omega-edit-repo>/core)`

   Best when you only want the native core library and do not need the packaging layer at all.

3. `find_package(omega_edit CONFIG REQUIRED)`

   Best when OmegaEdit has already been installed to a prefix and you want consumers to link against the installed package.

In all three cases, the primary target is the same:

```cmake
target_link_libraries(my_app PRIVATE omega_edit::omega_edit)
```

That target already carries the public include path, so consumers can include headers like:

```c
#include "omega_edit/edit.h"
#include "omega_edit/session.h"
```

## Pattern 1: Embed the Full Repo as a Subproject

The repo root supports an embedding mode specifically for downstream native projects:

```cmake
set(OMEGA_EDIT_EMBED_MODE ON CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE) # or ON

add_subdirectory(extern/omega-edit)

target_link_libraries(my_app PRIVATE omega_edit::omega_edit)
```

Why this mode exists:

- disables OmegaEdit tests
- disables docs generation
- disables examples
- disables coverage instrumentation
- skips the packaging layer that is only needed for install/export workflows

Use this path when you vendor the full repo but want the embedded build to stay small and predictable.

## Pattern 2: Embed Only `core/`

If you only need the native editing library, you can consume the `core/` directory directly:

```cmake
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE) # or ON

add_subdirectory(extern/omega-edit/core)

target_link_libraries(my_app PRIVATE omega_edit::omega_edit)
```

This is the smallest CMake integration path. `core/CMakeLists.txt` intentionally duplicates the key options from the repo root so that `core/` can stand on its own as a subproject.

Good fit for:

- embedding OmegaEdit beneath another native engine
- monorepos that already own their packaging story
- projects that do not want the repo-root packaging/install targets

## Pattern 3: Link Against an Installed Package

If OmegaEdit has already been installed to a prefix, use the exported package config:

```cmake
find_package(omega_edit CONFIG REQUIRED)
target_link_libraries(my_app PRIVATE omega_edit::omega_edit)
```

If you want to force a specific linkage style, request the package component explicitly:

```cmake
find_package(omega_edit CONFIG REQUIRED COMPONENTS static)
# or
find_package(omega_edit CONFIG REQUIRED COMPONENTS shared)

target_link_libraries(my_app PRIVATE omega_edit::omega_edit)
```

OmegaEdit's installed package config understands `static` and `shared` components and loads the matching exported target file for you.

Typical install flow from this repo:

```bash
cmake -S . -B _build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF
cmake --build _build --config Release
cmake --install _build --config Release --prefix _install
```

Then point your downstream project at that prefix using `CMAKE_PREFIX_PATH` or your normal toolchain/package-manager mechanism.

## Shared vs Static Linking

OmegaEdit supports both shared and static builds. The right choice depends mostly on deployment constraints, not on API shape.

### Static linking

Best when you want:

- the simplest runtime deployment
- no separate OmegaEdit DLL / `.so` / `.dylib`
- easier shipping inside a single native executable or tightly controlled plugin package

Tradeoffs:

- larger binaries
- slower relinks during development
- less flexibility if multiple processes/plugins should share one runtime copy

### Shared linking

Best when you want:

- smaller application binaries
- a separable OmegaEdit runtime artifact
- easier replacement of the core library without relinking the embedding app

Tradeoffs:

- the shared library must be deployed where the runtime loader can find it
- Windows packaging is usually a little more explicit than static linking

## Windows DLL and Runtime Placement

If you build OmegaEdit as a shared library on Windows, make sure `omega_edit.dll` is deployed beside your executable, or otherwise available on `PATH`.

The usual "works everywhere" rule is:

- put `omega_edit.dll` next to `my_app.exe`

If you are packaging with CMake, a post-build copy step is a practical default:

```cmake
add_custom_command(TARGET my_app POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
          $<TARGET_FILE:omega_edit::omega_edit>
          $<TARGET_FILE_DIR:my_app>
)
```

If you are using modern CMake and multiple shared dependencies, you can also use runtime-DLL copying on Windows:

```cmake
add_custom_command(TARGET my_app POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
          $<TARGET_RUNTIME_DLLS:my_app>
          $<TARGET_FILE_DIR:my_app>
  COMMAND_EXPAND_LISTS
)
```

Notes:

- when OmegaEdit is built statically, no separate OmegaEdit DLL is needed at runtime
- your C/C++ runtime deployment still follows your toolchain choice (`/MD` vs `/MT`, vcpkg triplet, etc.); OmegaEdit does not add a separate runtime policy beyond the one your build already uses

## Minimal Required Targets and Includes

For most embedding scenarios, the minimal requirement is just:

```cmake
target_link_libraries(my_app PRIVATE omega_edit::omega_edit)
```

You do not need to manually add the public include directory when you link the exported target.

Typical headers:

- `omega_edit/edit.h` for session lifecycle and edit operations
- `omega_edit/session.h` for reading computed session state
- `omega_edit/segment.h` for working with retrieved byte segments
- `omega_edit/search.h` if you want direct search contexts
- `omega_edit/viewport.h` if your host application wants viewport-style reads

## Using OmegaEdit as an Edit Backend

OmegaEdit works well underneath another workflow engine, parser, editor shell, or rewrite system. A common pattern looks like this:

1. Open a session from a file or in-memory bytes.
2. Translate your engine's logical operations into OmegaEdit inserts, deletes, and overwrites.
3. Read computed data back through `omega_session_get_segment` when you need materialized bytes.
4. Save to disk with `omega_edit_save` or keep working in-memory until your host decides to persist.
5. Destroy the session when the workflow is complete.

Minimal native flow:

```c
#include "omega_edit/edit.h"
#include "omega_edit/segment.h"
#include "omega_edit/session.h"

int main(void) {
    omega_session_t *session =
        omega_edit_create_session("input.dat", NULL, NULL, NO_EVENTS, NULL);
    if (!session) return 1;

    omega_edit_insert(session, 0, "HDR", 3);

    omega_segment_t *segment = omega_segment_create(16);
    if (segment) {
        if (omega_session_get_segment(session, segment, 0) == 0) {
            /* consume the computed bytes here */
        }
        omega_segment_destroy(segment);
    }

    omega_edit_save(session, "output.dat", IO_FLG_OVERWRITE, NULL);
    omega_edit_destroy_session(session);
    return 0;
}
```

Why this pattern is useful:

- OmegaEdit gives your host system undo/redo, checkpointing, and large-file-safe edits without forcing you to design those primitives yourself.
- Your application can keep its own higher-level transaction or workflow model while delegating byte-accurate edit bookkeeping to OmegaEdit.
- You can adopt only the core session/edit APIs first and add search, viewports, profiling, or transforms later.

## Practical Recommendations

If you are choosing quickly:

- use repo-root `OMEGA_EDIT_EMBED_MODE=ON` when vendoring the whole repository
- use `core/` directly when you only want the native library as a subproject
- use `find_package(omega_edit CONFIG REQUIRED COMPONENTS static)` when you want the simplest installed-package deployment story
- prefer static linking first for embedded tools, plugins, and internal engines unless you have a strong reason to ship a shared runtime
- prefer shared linking when multiple packaged components need to reuse the same OmegaEdit binary or when swapping the runtime independently matters

## See Also

- [Home](Home)
- [Quick Start C/C++ section](Home#path-2--cc-native-library)
- [`core/src/examples/`](https://github.com/ctc-oss/omega-edit/tree/main/core/src/examples)
