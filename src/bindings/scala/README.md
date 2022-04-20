<!--
  Copyright 2021 Concurrent Technologies Corporation

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
-->

Ωedit Scala API
===

Scala interface to the Ωedit library.

## Design

Trait based API hides the native FFI implementation details.  The traits allow for flexible unit testing, mocking, and changes to the FFI provider (JNR-FFI).

The entry point to the system is via the `com.ctc.omega_edit.api.OmegaEdit` object which provides factory interface for Ωedit `Session`s.

The `com.ctc.omega_edit.api` package provides the public interface, while the `com.ctc.omega_edit` package contains the private implementation details.

See the Ωedit documentation for details on the native API design philosophy and goals.

## Installation

**Note** there are no public artifacts published at this time, the installation from source tree below is the suggested method for installation.

Artifacts will be available from public repositories in a future revision of this library.

Artifacts use Maven rather than Ivy to better support the use of the classifier to identify the native platform.

### install from source tree

Running `sbt install` from the root directory of this project will install the artifacts into the local Maven cache.

To use these artifacts from SBT you must add the M2 local resolver:

`resolvers += Resolver.mavenLocal`

### sbt dependency

Artifacts are being built for Scala `2.12` and `2.13`.

The native binaries are delivered via artifacts that use a classifier to indicate the platform they target.

There is no explicit dependency from the api to the native library, so that dependency must be specified by the client.

```
val omegaEditVersion = "0.7.0-58-gbcb712d"
libraryDependencies ++= Seq(
    "com.ctc" %% s"omega-edit" % omegaEditVersion,
    "com.ctc" %% s"omega-edit-native" % omegaEditVersion classifier linux-64
)
```

The classifier controls identifies the platform binaries to match the runtime.

Platform identifiers are as follows

- `linux-{32|64}`
- `macos-{32|64}`
- `windows-{32|64}`

## callbacks

Callbacks can be passed in may ways including function objects, anonymous functions, and even closures.

It is important to be aware that if you do not maintain a reference the callback it will be garbage collected.
The API does not do this, it is the clients responsibiliity to maintain a reference to the callback.

See the [JNR-FFI Callback documentation](https://github.com/jnr/jnr-ffi/blob/master/docs/TypeMappings.md#callbackfunction-types) for more information.

## Future
- consider separating the JNR-FFI support into a separate submodule to allow parallel binding support or other backends (e.g. JNA or JavaCPP)
- find or create a generator from native header files (`.h`, `.hpp`) to JNR-FFI bindings trait.
- SBT plugin that detects and sets the classifier and installs the local resolver

## License

This library is released under [Apache License, v2.0].

[Apache License, v2.0]: https://www.apache.org/licenses/LICENSE-2.0
