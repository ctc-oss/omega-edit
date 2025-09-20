# Version Management

Ωedit™ uses a single source of truth for version information via the `VERSION` file at the repository root.

## Version File

The `VERSION` file contains the current version number in semantic versioning format (e.g., `0.9.88`).

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
- Client-server dependency versions

## Build System Integration

### CMake (C/C++ Core Library)
The CMake build system reads the version from the `VERSION` file automatically:
- Configures `OMEGA_EDIT_VERSION_MAJOR`, `OMEGA_EDIT_VERSION_MINOR`, `OMEGA_EDIT_VERSION_PATCH` defines
- Sets project version for shared library versioning

### Scala (gRPC Server)
The Scala build (`server/scala/build.sbt`) reads directly from the `VERSION` file.

### Node.js (Client and Server Packages)
The Node.js packages use the `sync-version.js` script to maintain version consistency across:
- Workspace packages
- Inter-package dependencies
- Generated client version files

## Automated Version Management

The version sync script ensures:
- All package.json files have consistent versions
- Client-server dependency versions are properly aligned
- Build artifacts use the correct version number

## Integration with Git Tags

While the current implementation uses a manual `VERSION` file, the system is designed to potentially integrate with Git tags in the future for automated version discovery.