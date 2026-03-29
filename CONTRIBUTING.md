# Contributing to Ωedit™

Thank you for your interest in contributing to Ωedit™! This guide will help you
get up and running.

## Code of Conduct

This project is licensed under the [Apache License 2.0](LICENSE.txt). By
contributing you agree that your contributions will be licensed under the same
terms.

## Project Structure

```
omega-edit/
├── core/               C/C++ native library (edit engine)
│   ├── src/include/    Public C/C++ headers
│   ├── src/lib/        Library implementation
│   ├── src/examples/   C/C++ example programs
│   └── src/tests/      Native test suite
├── packages/
│   ├── client/         @omega-edit/client — TypeScript gRPC client (npm)
│   └── server/         @omega-edit/server — native server launcher (npm)
├── server/cpp/         C++ gRPC server (middleware)
├── proto/              Protocol Buffer / gRPC service definition
├── docker/             Docker build files
├── wiki/               GitHub Wiki source (auto-deployed)
└── .github/            CI workflows and actions
```

## Development Environment

### Prerequisites

| Tool | Version | Purpose |
| --- | --- | --- |
| CMake | 3.16+ | C/C++ build system |
| C++17 compiler | GCC 9+, Clang 10+, MSVC 2019+ | Native library and server |
| Node.js | 16+ | TypeScript packages |
| Yarn | 1.x | Package manager (workspaces) |

### First-time setup

```bash
# Clone the repository
git clone https://github.com/ctc-oss/omega-edit.git
cd omega-edit

# Install Node.js dependencies
yarn install
```

### Building the C/C++ library

```bash
cmake -S . -B _build -DCMAKE_BUILD_TYPE=Debug -DBUILD_DOCS=NO -DBUILD_EXAMPLES=NO -DBUILD_SHARED_LIBS=YES
cmake --build _build --config Debug
```

### Building TypeScript packages

```bash
yarn workspace @omega-edit/server package
yarn workspace @omega-edit/client build
```

## Running Tests

### C/C++ tests

```bash
ctest --build-config Debug --test-dir _build/core --output-on-failure
```

### TypeScript tests

```bash
yarn workspace @omega-edit/client test
```

All tests must pass before submitting a pull request. CI runs the full test
matrix across Windows, Ubuntu, and macOS (see `.github/workflows/tests.yml`).

## Coding Standards

### C/C++

- Formatted with **clang-format** using the LLVM-based configuration in `.clang-format`
- Column limit: **120** characters
- Indentation: **4 spaces**
- Pointer alignment: **Right** (`int *ptr`)
- Run before committing:
  ```bash
  clang-format -i <file>
  ```

### TypeScript / JavaScript

- Checked with **Biome** (configured in root `biome.json`):
  - Semicolons: **off**
  - Single quotes: **yes**
  - Tab width: **2 spaces**
  - Trailing commas: **ES5**
- Repo-owned JS/TS/JSON files are auto-formatted; the VS Code extension example also uses Biome lint rules
- Run before committing:
  ```bash
  yarn lint        # check
  yarn lint:fix    # auto-fix
  ```

### General (all files)

- UTF-8 encoding, LF line endings, trim trailing whitespace, final newline
- See `.editorconfig` for editor integration

## License Headers

Every source file must include the Apache 2.0 copyright header. CI enforces
this via the **Rat Check** workflow (`.github/workflows/ratCheck.yml`).

Example header for C/C++:

```c
/**********************************************************************************************************************
 * Copyright (c) 2021 Concurrent Technologies Corporation.                                                            *
 *                                                                                                                    *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance     *
 * with the License.  You may obtain a copy of the License at                                                         *
 *                                                                                                                    *
 *     http://www.apache.org/licenses/LICENSE-2.0                                                                     *
 *                                                                                                                    *
 * Unless required by applicable law or agreed to in writing, software is distributed under the License is            *
 * distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or                   *
 * implied.  See the License for the specific language governing permissions and limitations under the License.       *
 *                                                                                                                    *
 **********************************************************************************************************************/
```

For TypeScript/JavaScript, use the `<!-- ... -->` HTML comment form (in
Markdown) or `// ...` line comments.

## Version Management

The single source of truth for the project version is the `VERSION` file at the
repository root. After changing it, run:

```bash
yarn sync-version
```

This propagates the version to all `package.json` files and CMake
configuration. See `VERSION_MANAGEMENT.md` for full details.

## Pull Request Process

1. **Fork** the repository and create a feature branch from `main`
2. **Make your changes** — keep commits focused and atomic
3. **Ensure all checks pass locally:**
   - C/C++ tests: `ctest`
   - TypeScript lint: `yarn lint`
   - TypeScript tests: `yarn workspace @omega-edit/client test`
4. **Push** your branch and open a pull request against `main`
5. CI will run:
   - **Unit Tests** — native build + test on Windows, Ubuntu, macOS
   - **Middleware build** — gRPC server compilation
   - **Code Coverage** — uploaded to Codecov
   - **Rat Check** — license header verification
   - **CodeQL** — static analysis
6. Address any review feedback
7. A maintainer will merge once all checks pass

## Reporting Issues

Use [GitHub Issues](https://github.com/ctc-oss/omega-edit/issues) to report
bugs or request features. Please include:

- Steps to reproduce (for bugs)
- Expected vs. actual behaviour
- Platform and version information
- Minimal reproduction if possible

## Getting Help

- **Documentation**: <https://ctc-oss.github.io/omega-edit/>
- **Wiki**: <https://github.com/ctc-oss/omega-edit/wiki>
- **Issues**: <https://github.com/ctc-oss/omega-edit/issues>
