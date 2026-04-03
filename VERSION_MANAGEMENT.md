# Version Management

Ωedit™ uses a single source of truth for version information via the `VERSION` file at the repository root.

## Version File

The `VERSION` file contains the current version number in semantic versioning format (for example `0.9.88` or `2.0.0-rc1`).

## Updating Version

To update the version across all components:

1. **Update the VERSION file**: Edit the `VERSION` file in the repository root with the new version number.

2. **Sync package.json files**: Run the version sync script:
   ```bash
   yarn sync-version
   ```
   or
   ```bash
   node sync-version.js
   ```

This will automatically update:
- Root `package.json`
- `packages/client/package.json`
- `packages/server/package.json`
- `packages/ai/package.json`
- `examples/vscode-extension/package.json`
- `examples/vscode-extension/package-lock.json` metadata
- Client-server and AI-client dependency versions
- VS Code extension version metadata

For prerelease versions such as `2.0.0-rc1`, the sync script intentionally leaves the VS Code example's `@omega-edit/client` npm dependency pinned to the latest published release so `npm ci` continues to work before the prerelease packages are published.

## Build System Integration

### CMake (C/C++ Core Library)
The CMake build system reads the version from the `VERSION` file automatically:
- Configures `OMEGA_EDIT_VERSION_MAJOR`, `OMEGA_EDIT_VERSION_MINOR`, `OMEGA_EDIT_VERSION_PATCH` defines
- Uses the numeric `major.minor.patch` portion for shared library versioning
- Preserves the full semantic version string for release metadata such as `-rc1`

### Node.js (Client and Server Packages)
The Node.js packages use the `sync-version.js` script to maintain version consistency across:
- Workspace packages
- Inter-package dependencies
- Generated client version files
- The VS Code extension example package and its lockfile metadata

### VS Code Extension Release Asset
The VS Code extension example uses the synced version in:
- `examples/vscode-extension/package.json`
- GitHub release asset naming for the generated `.vsix`

## Automated Version Management

The version sync script ensures:
- All package.json files have consistent versions
- Client-server and AI-client dependency versions are properly aligned
- The VS Code extension package stays aligned with the repo version
- Build artifacts use the correct version number

## Integration with Git Tags

While the current implementation uses a manual `VERSION` file, the system is designed to potentially integrate with Git tags in the future for automated version discovery.
