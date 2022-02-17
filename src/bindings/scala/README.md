Ωedit Scala API
===

Scala interface to the Ωedit library editor.

## design

Trait based API that hides the native implementation details.  The entry point to the system is via the `OmegaEdit` object which provides the `Session` factory functions.

## native library

The native shared library is pulled in via a transitive dependency and unpacked at runtime.

## binary releases

Artifacts are currently being published for Scala `2.12` and `2.13`

```
libraryDependencies += "com.ctc" %% "omega-edit" % "version"
```

## License

This library is released under [Apache License, v2.0].

[Apache License, v2.0]: https://www.apache.org/licenses/LICENSE-2.0
