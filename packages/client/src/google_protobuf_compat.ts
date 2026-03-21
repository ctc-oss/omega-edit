import { BinaryReader } from 'google-protobuf'

type PackedReader = {
  readPackableInt64Into(values: number[]): void
  readPackedInt64?(): number[]
}

const readerPrototype = BinaryReader.prototype as unknown as PackedReader

if (typeof readerPrototype.readPackedInt64 !== 'function') {
  readerPrototype.readPackedInt64 = function readPackedInt64() {
    const values: number[] = []
    this.readPackableInt64Into(values)
    return values
  }
}
