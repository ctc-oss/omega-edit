# GitHub Copilot Instructions for Ωedit™

## Project Overview

Ωedit™ is a multi-language library for building editors that can handle massive files and multiple viewports. The project consists of:

- **Core C/C++ library** (`core/`) - Native implementation of the edit engine
- **TypeScript/Node.js packages** (`packages/`) - Client and server packages
- **Scala gRPC server** (`server/scala/`) - gRPC reference implementation using Apache Pekko
- **Protocol definitions** (`proto/`) - gRPC protocol buffer definitions

## Code Style and Formatting

### C/C++
- Follow LLVM style with customizations defined in `.clang-format`
- Column limit: 120 characters
- Indentation: 4 spaces
- Pointer alignment: Right (e.g., `int *ptr`)
- Include copyright header in all source files (see existing files for template)
- Use clang-format for automatic formatting

### TypeScript/JavaScript
- Use Prettier for formatting (configured in root `package.json`)
- Semi-colons: OFF (configured as `"semi": false`)
- Single quotes: YES (configured as `"singleQuote": true`)
- Tab width: 2 spaces
- Trailing commas: ES5 style
- Use ESLint with Prettier plugin for linting
- Lint command: `yarn lint`
- Auto-fix command: `yarn lint:fix`

### Scala
- Use scalafmt for formatting (configured in `.scalafmt.conf`)
- scalafmt version: 3.7.17
- Max column: 120 characters
- Dialect: scala213
- Rewrite rules: SortImports, RedundantBraces
- Format command: `sbt scalafmtAll` (in `server/scala/`)

### General
- Use UTF-8 encoding for all files
- Use LF (Unix-style) line endings
- Indent with spaces (2 spaces for TS/JS, 4 spaces for C/C++)
- Trim trailing whitespace
- Insert final newline in all files
- See `.editorconfig` for complete editor configuration

## Build and Test Commands

### C/C++ Core Library

Build debug shared library (required for Scala server):
```bash
cmake -S . -B _build -DCMAKE_BUILD_TYPE=Debug -DBUILD_DOCS=NO -DBUILD_EXAMPLES=NO -DBUILD_SHARED_LIBS=YES
cmake --build _build --config Debug
```

Test the core library:
```bash
ctest --build-config Debug --test-dir _build/core --output-on-failure
```

Install the core library (for Scala server):
```bash
cmake --install _build --config Debug --prefix _install
```

Using Makefile (convenience wrapper):
```bash
make all          # Build debug shared library and run tests
make TYPE=Release # Build release version
make clean        # Clean build artifacts
```

### TypeScript/Node.js Packages

Install dependencies (from repository root):
```bash
yarn install
```

Lint all packages:
```bash
yarn lint        # Check formatting and linting
yarn lint:fix    # Auto-fix formatting and linting issues
```

Test the client package:
```bash
yarn workspace @omega-edit/client test
```

Package the client and server:
```bash
yarn workspace @omega-edit/server package    # Includes sbt build
yarn workspace @omega-edit/client package
```

Package without rebuilding Scala server:
```bash
yarn workspace @omega-edit/server package-no-sbt
```

### Scala Server

All commands should be run from `server/scala/` directory:

Install all components and run tests:
```bash
sbt installM2
```

Run the server:
```bash
sbt runServer
# or
sbt serv/run
```

Package the server:
```bash
sbt pkgServer
# or
sbt serv/Universal/packageBin
```

Run Scala tests:
```bash
sbt test
sbt serv/test
```

Format Scala code:
```bash
sbt scalafmtAll
```

## Project Structure

```
omega-edit/
├── core/                  # C/C++ core library
│   ├── src/lib/          # Core library implementation
│   ├── src/examples/     # Example programs
│   └── src/tests/        # C/C++ tests
├── packages/             # Node.js packages
│   ├── client/           # TypeScript client package
│   │   ├── src/         # Client source code
│   │   └── tests/       # Client tests (Mocha + Chai)
│   └── server/          # TypeScript server wrapper
│       └── src/         # Server wrapper source
├── server/scala/        # Scala gRPC server
│   ├── api/            # Scala API
│   ├── native/         # Native bindings
│   ├── spi/            # Service provider interface
│   └── serv/           # gRPC server implementation
├── proto/              # Protocol buffer definitions
└── .github/            # GitHub workflows and configuration
```

## Dependencies and Package Management

- **C/C++**: Use Conan for C/C++ dependencies (`pip install conan`)
- **Node.js**: Use Yarn workspaces for package management
- **Scala**: Use sbt for dependency management
- **CMake**: Version 3.x or higher required
- **Node.js**: Use nvm or nodeenv for version management

## Version Management

- Single source of truth: `VERSION` file at repository root
- Follows Semantic Versioning (semver)
- Update versions using: `make update-version version=X.Y.Z`
- The `sync-version.js` script propagates version to all components
- See `VERSION_MANAGEMENT.md` for details

## Testing Standards

### C/C++ Tests
- Use CTest framework
- Tests located in `core/src/tests/`
- Run with: `ctest --build-config <Debug|Release> --test-dir _build/core --output-on-failure`

### TypeScript/Node.js Tests
- Use Mocha test framework with Chai assertions
- Tests located in `packages/client/tests/specs/`
- Timeout: 100 seconds for client tests, 50 seconds for lifecycle tests
- Run with: `yarn workspace @omega-edit/client test`

### Scala Tests
- Use ScalaTest framework
- Tests located in `server/scala/*/src/test/scala/`
- Run with: `sbt test` or `sbt serv/test`

## Commit and PR Guidelines

- Use conventional commit messages where appropriate
- Include copyright headers in new source files (Apache License 2.0)
- Ensure all tests pass before submitting PRs
- Run linters and formatters before committing
- Update documentation if adding new features
- PRs should include both code and test changes

## Copyright and License

- All source files must include Apache License 2.0 copyright header
- Copyright holder: Concurrent Technologies Corporation
- See existing files for header template
- License file: `LICENSE.txt`

## Important Files

- `.clang-format` - C/C++ formatting rules
- `.editorconfig` - Cross-editor configuration
- `.scalafmt.conf` - Scala formatting rules
- `package.json` - Root package configuration with Prettier settings
- `CMakeLists.txt` - C/C++ build configuration
- `Makefile` - Convenience build wrapper

## Additional Notes

- The project supports Windows, macOS, and Linux
- Build artifacts go to `_build/` directory
- Install artifacts go to `_install/` directory
- Generated packages go to `packages/*/` with `.tgz` extension
- Scala server requires the shared library from the C/C++ build
- Use `OE_LIB_DIR` environment variable to specify custom library location

## CI/CD Workflows

- Unit tests run on: Windows 2022, macOS 13, Ubuntu 22.04, macOS 14
- CodeQL security scanning is enabled
- Format checks for TypeScript and Scala
- Release binaries published for macOS (Apple Silicon & x86), Windows (x86), and Linux (ARM & x86)
- Workflows located in `.github/workflows/`
