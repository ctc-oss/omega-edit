# GitHub Copilot Instructions for OmegaEdit

## Project Overview

OmegaEdit is a multi-language library for building editors that can handle massive files and multiple viewports. The project consists of:

- Core C/C++ library (`core/`) - Native implementation of the edit engine
- TypeScript/Node.js packages (`packages/`) - Client and server packages
- C++ gRPC server (`server/cpp/`) - Native middleware implementation
- Protocol definitions (`proto/`) - gRPC protocol buffer definitions

## Code Style and Formatting

### C/C++
- Follow LLVM style with customizations defined in `.clang-format`
- Column limit: 120 characters
- Indentation: 4 spaces
- Pointer alignment: Right (e.g., `int *ptr`)
- Include copyright header in all source files
- Use clang-format for automatic formatting

### TypeScript/JavaScript
- Use Biome for formatting and checks (configured in root `biome.json`)
- Semi-colons: OFF
- Single quotes: YES
- Tab width: 2 spaces
- Trailing commas: ES5 style
- Lint command: `yarn lint`
- Auto-fix command: `yarn lint:fix`

### General
- Use UTF-8 encoding for all files
- Use LF line endings
- Indent with spaces
- Trim trailing whitespace
- Insert final newline in all files
- See `.editorconfig` for complete editor configuration

## Build and Test Commands

### C/C++ Core Library
```bash
cmake -S . -B _build -DCMAKE_BUILD_TYPE=Debug -DBUILD_DOCS=NO -DBUILD_EXAMPLES=NO -DBUILD_SHARED_LIBS=YES
cmake --build _build --config Debug
ctest --build-config Debug --test-dir _build/core --output-on-failure
cmake --install _build --config Debug --prefix _install
```

### TypeScript/Node.js Packages
```bash
yarn install
yarn lint
yarn lint:fix
yarn workspace @omega-edit/server package
yarn workspace @omega-edit/client test
```

## Project Structure

```text
omega-edit/
|-- core/
|-- packages/
|   |-- client/
|   |-- core/
|   `-- server/
|-- server/cpp/
|-- proto/
`-- .github/
```

## Version Management

- Single source of truth: `VERSION` file at repository root
- Update versions using `yarn sync-version` or `node sync-version.js`
- See `VERSION_MANAGEMENT.md` for details

## Important Files

- `.clang-format` - C/C++ formatting rules
- `.editorconfig` - Cross-editor configuration
- `biome.json` - Root Biome configuration for repo-owned JS/TS/JSON files
- `CMakeLists.txt` - C/C++ build configuration
- `Makefile` - Convenience build wrapper

## Additional Notes

- The project supports Windows, macOS, and Linux
- Build artifacts go to `_build/`
- Install artifacts go to `_install/`
- Use `OE_LIB_DIR` to specify a custom library location

## Wiki Documentation

The `wiki/Home.md` file documents the C/C++ public API and must be kept in sync with the source code:

- **`omega_edit_create_session`** has 5 parameters: `file_path`, `cbk`, `user_data_ptr`, `event_interest`, `checkpoint_directory` — declared in `core/src/include/omega_edit/edit.h`.
- **`omega_edit_save`** uses `int io_flags` (an `omega_io_flags_t` bitmask such as `IO_FLG_OVERWRITE` or `IO_FLG_NONE`) as its third parameter, **not** a boolean overwrite flag — declared in `core/src/include/omega_edit/edit.h`.
- The C++ STL string adapter header is `omega_edit/stl_string_adaptor.hpp` (with **"or"**, not "er") — located at `core/src/include/omega_edit/stl_string_adaptor.hpp`.
- Example source files are under `core/src/examples/` (not `src/examples/`).
- Images for the wiki are stored in `wiki/images/` and referenced with relative paths in `wiki/Home.md`.
- The wiki is automatically deployed to GitHub Wiki on every push to `main` via `.github/workflows/deploy-wiki.yml`.
