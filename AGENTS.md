# OmegaEdit Agent Guide

This document provides essential information for agents working with the OmegaEdit codebase. It covers the project structure, key components, build processes, and important conventions.

## Project Overview

OmegaEdit is a multi-language library for building editors that can handle massive files and multiple viewports. The project consists of:

- Core C/C++ library (`core/`) - Native implementation of the edit engine
- TypeScript/Node.js packages (`packages/`) - Client and server packages
- C++ gRPC server (`server/cpp/`) - Native middleware implementation
- Protocol definitions (`proto/`) - gRPC protocol buffer definitions

## Architecture and Components

### Core C/C++ Library (`core/`)
- Implements the main editing functionality
- Provides low-level APIs for file manipulation, changes, sessions, and viewports
- Uses a model-view architecture with session management and change tracking
- Features include undo/redo, checkpointing, and transform plugins

### TypeScript/Node.js Packages (`packages/`)
- **@omega-edit/client**: JavaScript/TypeScript client library for interacting with the server
- **@omega-edit/server**: gRPC server implementation 
- **@omega-edit/ai**: AI tooling with CLI and MCP support

### Protocol Definitions (`proto/`)
- gRPC protocol buffer definitions for communication between client and server

### Server Implementation (`server/cpp/`)
- gRPC server that implements the core functionality
- Handles client connections and manages sessions

## Key Concepts and Patterns

### Session Management
- Sessions represent the editing state of a file
- Sessions can be created from files or in-memory buffers
- Sessions track all changes and support undo/redo functionality

### Change Tracking
- Changes are represented as discrete operations (insert, delete, overwrite)
- Each change has a serial number for tracking
- Changes are stored in a change log for undo/redo operations

### Viewports
- Viewports provide a window into a session at a specific offset
- Can be floating (follow changes) or fixed
- Allows viewing different parts of a large file simultaneously

### Transform Plugins
- Native plugins (.so, .dylib, .dll) for extending functionality
- Can replace ranges, expand/shrink content, or inspect ranges
- Used for operations like case conversion, encoding, compression, etc.

## Essential Commands

### Building Core C/C++ Library
```bash
# Using CMake presets (recommended)
cmake --preset ninja-debug-minimal
cmake --build --preset ninja-debug-minimal

# Or manually
cmake -S . -B _build -DBUILD_SHARED_LIBS=YES -DBUILD_DOCS=NO -DBUILD_EXAMPLES=NO -DCMAKE_BUILD_TYPE=Debug
cmake --build _build --config Debug
ctest --build-config Debug --test-dir _build/core --output-on-failure
```

### Building TypeScript/Node.js Packages
```bash
# Install dependencies
yarn install

# Build all packages
yarn package

# Build specific package
yarn workspace @omega-edit/server package
yarn workspace @omega-edit/client package
yarn workspace @omega-edit/ai package

# Run tests
yarn workspace @omega-edit/client test
```

### Development Workflow
```bash
# Generate protobuf files
yarn workspace @omega-edit/client scripts/generate-protobuf.js

# Run linter
yarn lint

# Fix linter issues
yarn lint:fix

# Build with coverage
make coverage
```

## Code Organization

### C/C++ Structure
- `core/src/include/`: Public headers defining the API
- `core/src/lib/`: Implementation files for core functionality
- `core/src/examples/`: Example programs demonstrating usage
- `core/src/tests/`: Unit tests for core functionality

### TypeScript Structure
- `packages/client/src/`: Client-side TypeScript implementation
- `packages/server/src/`: Server-side TypeScript implementation
- `packages/ai/src/`: AI tooling implementation
- `packages/client/src/protobuf_ts/`: Generated gRPC TypeScript bindings

## Important Conventions

### C/C++ Coding Standards
- Follow LLVM style with customizations in `.clang-format`
- Column limit: 120 characters
- Indentation: 4 spaces
- Pointer alignment: Right (e.g., `int *ptr`)
- Include copyright header in all source files
- Use clang-format for automatic formatting

### TypeScript/JavaScript Coding Standards
- Use Biome for formatting and checks (configured in root `biome.json`)
- Semi-colons: OFF
- Single quotes: YES
- Tab width: 2 spaces
- Trailing commas: ES5 style
- Lint command: `yarn lint`
- Auto-fix command: `yarn lint:fix`

### Naming Conventions
- C/C++ identifiers: `omega_edit_*` (lowercase with underscores)
- C++ classes and structs: `omega_*` (lowercase with underscores)
- TypeScript/JavaScript: camelCase
- Public API functions: `omega_edit_*` (C-style) or `OmegaEdit*` (C++ style)

### Memory Management
- All allocated memory must be freed by the caller
- Functions that allocate memory return pointers to heap-allocated data
- Callbacks should be designed to avoid memory leaks

### Error Handling
- Functions return 0 for success and non-zero for failure
- Error codes are typically negative integers
- Error messages are logged through callback mechanisms

## Key Files and Interfaces

### Core C API (`core/src/include/omega_edit/edit.h`)
- `omega_edit_create_session()` - Creates a new editing session
- `omega_edit_save()` - Saves a session to a file
- `omega_edit_undo_last_change()` - Undoes the last change
- `omega_edit_redo_last_undo()` - Redoes the last undone change

### Client Interface (`packages/client/src/client.ts`)
- `startServer()` - Starts the gRPC server
- `getClient()` - Connects to the server
- `createSession()` - Creates a new editing session
- `saveSession()` - Saves a session to a file

### Protocol Buffer Definitions (`proto/omega_edit/v1/omega_edit.proto`)
- Defines the gRPC service interface
- Contains message types for sessions, changes, viewports, etc.

## Gotchas and Non-Obvious Patterns

### API Parameter Differences
- `omega_edit_save()` uses `int io_flags` (an `omega_io_flags_t` bitmask) as third parameter, **not** a boolean overwrite flag
- `omega_edit_create_session()` has 5 parameters: `file_path`, `cbk`, `user_data_ptr`, `event_interest`, `checkpoint_directory`
- Session IDs are used to reference sessions across API calls

### Memory Safety
- All functions that return allocated memory require the caller to free it
- Buffers returned by `omega_edit_save_segment_to_bytes()` and `omega_edit_save_to_bytes()` must be freed by the caller
- Use `free()` to deallocate memory allocated by OmegaEdit functions

### Threading
- The library is not thread-safe by default
- Sessions and viewports should be accessed from the same thread
- Callbacks are invoked from the thread that initiated the operation

### File I/O Behavior
- When saving to an existing file, the file can be overwritten or a new name chosen
- Checkpoint directories are automatically managed if not provided
- Sessions are automatically reset when the underlying file is overwritten during save

### Transform Plugin Loading
- Plugins must be built as dynamic libraries (.so, .dylib, .dll)
- Plugins are discovered in a configured plugin directory
- Plugin interfaces are defined in `core/src/include/omega_edit/transform_plugin_sdk.h`

### Testing
- Tests are built with the Catch2 framework
- Tests are run using CTest for C/C++ and Mocha for TypeScript
- Coverage is measured with gcov/lcov for C/C++ and nyc for TypeScript

## Version Management

The project uses a single source of truth in the `VERSION` file at the repository root.
Update versions using:
```bash
yarn sync-version
node sync-version.js
```

## Documentation Generation

Documentation is generated using:
- Doxygen for C/C++ API documentation
- Sphinx for user documentation
- Typedoc for TypeScript documentation

## Build Artifacts Location

- C/C++ build artifacts: `_build/` directory
- C/C++ installation artifacts: `_install/` directory
- TypeScript packages: `packages/*/dist/` directories
- Documentation: `docs/` directory

## Working Documents

Keep development-only plans, backlogs, design drafts, and release evidence in
`dev-notes/`, not at the repository root. Promote stable material to the
appropriate user or maintainer documentation location when it becomes
canonical.
