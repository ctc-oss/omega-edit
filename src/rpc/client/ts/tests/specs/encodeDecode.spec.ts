/*
 * Copyright (c) 2021 Concurrent Technologies Corporation.
 *
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { expect } from 'chai'

describe('Encode/Decode', () => {
  it('Should encode string into Uint8Array', () => {
    expect(Buffer.from('abc123')).deep.equals(
      new Uint8Array([97, 98, 99, 49, 50, 51])
    )
  })

  it('Should handle ASCII conversions', () => {
    const asciiChars = [
      'T',
      'h',
      'i',
      's',
      ' ',
      'i',
      's',
      ' ',
      'a',
      ' ',
      't',
      'e',
      's',
      't',
      '.',
      '\n',
    ]
    const asciiDecimalVals = [
      84, 104, 105, 115, 32, 105, 115, 32, 97, 32, 116, 101, 115, 116, 46, 10,
    ]
    for (let i = 0; i < asciiChars.length; ++i) {
      expect(asciiChars[i].charCodeAt(0)).to.equal(asciiDecimalVals[i])
      expect(String.fromCharCode(asciiDecimalVals[i])).to.equal(asciiChars[i])
    }
  })

  it('Should handle binary, octal, and hex conversions, and representations', () => {
    const hexList = [
      0x93, 0x5d, 0xde, 0x35, 0xef, 0x12, 0x4e, 0x32, 0x89, 0xef, 0x12, 0x3a,
      0x83, 0x2b,
    ]
    const octalList = [
      0o223, 0o135, 0o336, 0o65, 0o357, 0o22, 0o116, 0o62, 0o211, 0o357, 0o22,
      0o72, 0o203, 0o53,
    ]
    const binaryList = [
      0b10010011, 0b1011101, 0b11011110, 0b00110101, 0b11101111, 0b00010010,
      0b01001110, 0b0110010, 0b10001001, 0b11101111, 0b00010010, 0b00111010,
      0b10000011, 0b0101011,
    ]
    const binaryStrList = [
      '0b10010011',
      '0b01011101',
      '0b11011110',
      '0b00110101',
      '0b11101111',
      '0b00010010',
      '0b01001110',
      '0b00110010',
      '0b10001001',
      '0b11101111',
      '0b00010010',
      '0b00111010',
      '0b10000011',
      '0b00101011',
    ]
    const hexStrList = [
      '0x93',
      '0x5d',
      '0xde',
      '0x35',
      '0xef',
      '0x12',
      '0x4e',
      '0x32',
      '0x89',
      '0xef',
      '0x12',
      '0x3a',
      '0x83',
      '0x2b',
    ]
    const octalStrList = [
      '0o223',
      '0o135',
      '0o336',
      '0o065',
      '0o357',
      '0o022',
      '0o116',
      '0o062',
      '0o211',
      '0o357',
      '0o022',
      '0o072',
      '0o203',
      '0o053',
    ]
    for (let i = 0; i < hexList.length; ++i) {
      expect(hexList[i]).to.equal(octalList[i])
      expect(hexList[i]).to.equal(binaryList[i])
      expect(parseInt(octalStrList[i].slice(2), 8)).to.equal(octalList[i])
      expect(parseInt(binaryStrList[i].slice(2), 2)).to.equal(binaryList[i])
      expect(parseInt(hexStrList[i].slice(2), 16)).to.equal(hexList[i])
      expect('0o' + hexList[i].toString(8).padStart(3, '0')).to.equal(
        octalStrList[i]
      )
      expect('0b' + hexList[i].toString(2).padStart(8, '0')).to.equal(
        binaryStrList[i]
      )
      expect('0x' + hexList[i].toString(16)).to.equal(hexStrList[i])
      expect('0o' + octalList[i].toString(8).padStart(3, '0')).to.equal(
        octalStrList[i]
      )
      expect('0b' + octalList[i].toString(2).padStart(8, '0')).to.equal(
        binaryStrList[i]
      )
      expect('0x' + octalList[i].toString(16)).to.equal(hexStrList[i])
      expect('0o' + binaryList[i].toString(8).padStart(3, '0')).to.equal(
        octalStrList[i]
      )
      expect('0b' + binaryList[i].toString(2).padStart(8, '0')).to.equal(
        binaryStrList[i]
      )
      expect('0x' + binaryList[i].toString(16)).to.equal(hexStrList[i])
    }
  })
})
