<!--
  Copyright (c) 2021 Concurrent Technologies Corporation.

  Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance
  with the License.  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software is distributed under the License is
  distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
  implied.  See the License for the specific language governing permissions and limitations under the License.
-->

<div align="center">
<p>
    <img alt="Omega Edit Logo" src="https://raw.githubusercontent.com/ctc-oss/omega-edit/main/images/OmegaEditLogo.png" width=120>
</p>

<h1>Ωedit gRPC Client TypeScript</h1>

[![Release](https://shields.io/github/v/release/ctc-oss/omega-edit?display_name=tag&include_prereleases&sort=semver)](https://github.com/ctc-oss/omega-edit/releases)
![Build Status](https://github.com/ctc-oss/omega-edit/workflows/Unit%20Tests/badge.svg)
![CodeQL](https://github.com/ctc-oss/omega-edit/workflows/CodeQL/badge.svg)
[![codecov](https://codecov.io/gh/ctc-oss/omega-edit/branch/main/graph/badge.svg)](https://codecov.io/gh/ctc-oss/omega-edit)
[![Dependency Status](https://img.shields.io/librariesio/release/npm/omega-edit)](https://libraries.io/npm/omega-edit)
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit?ref=badge_shield)

</div>

## Goal

This package contains the TypeScript types and code needed to interact with the Ωedit library via a gRPC client.

## Package Distribution

This package is distributed with both ESM and CommonJS formats, along with full TypeScript source maps for enhanced debugging:

- **ESM**: `dist/esm/` - ES2020 modules
- **CommonJS**: `dist/cjs/` - CommonJS modules
- **Source Maps**: All outputs include `.map` files with embedded TypeScript sources (`sourcesContent`)
- **Type Definitions**: `.d.ts` files with declaration maps (`.d.ts.map`)

This allows downstream consumers (like VS Code extensions and webviews) to:

- Set breakpoints directly in the original TypeScript source
- See readable function/class names in stack traces
- Debug through the package code seamlessly

## Testing

### Testing the client

#### Compile the client

```shell
yarn compile-src
```

#### Test the client

Now test the client with:

```shell
yarn test
```

## User documentation

User documentation is published to https://ctc-oss.github.io/omega-edit/.

## Versioning

Ωedit follows [Semantic Versioning](http://semver.org/).

## License

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit?ref=badge_large)
