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

Ωedit Scala API, Native Bindings, SPI and gRPC Server
===

- Scala Native bindings to shared library
- Scala API to call native bindings
- Scala SPI for determing different build info
- Scala gRPC reference implementation using Apache Pekko.

## Copile and Install

For all of these subsections you will need to be inside of folder `server/scala`

### API

```bash
sbt api/publishM2
```

### Native

```bash
sbt native/publishM2
```

### SPI

```bash
sbt spi/publishM2
```

### All at once

This will also run the unit tests

```bash
sbt installM2
```

## Running the server

To run the gRPC scala server, inside of `server/scala` run:

```bash
sbt serv/run
```

OR

```bash
sbt runServer
```


## Packaging the server

To package the gRPC scala server, inside of `server/scala` run:

```bash
sbt serv/Universal/packageBin
```

OR

```bash
sbt pkgServer
```


## Reference

- [Apache Pekko](https://github.com/apache/incubator-pekko-grpc)

## License

This library is released under [Apache License, v2.0].

[Apache License, v2.0]: https://www.apache.org/licenses/LICENSE-2.0
