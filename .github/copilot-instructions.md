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
- Use Prettier for formatting (configured in root `package.json`)
- Semi-colons: OFF
- Single quotes: YES
- Tab width: 2 spaces
- Trailing commas: ES5 style
- Use ESLint with Prettier plugin for linting
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
- `package.json` - Root package configuration with Prettier settings
- `CMakeLists.txt` - C/C++ build configuration
- `Makefile` - Convenience build wrapper

## Additional Notes

- The project supports Windows, macOS, and Linux
- Build artifacts go to `_build/`
- Install artifacts go to `_install/`
- Use `OE_LIB_DIR` to specify a custom library location
