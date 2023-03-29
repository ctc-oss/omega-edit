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

import { reverseBits } from '../../src/dataMan'
import { expect } from 'chai'

describe('Data Manipulation', () => {
  it('Should be able to reverse bits in a byte', () => {
    const bytesIn = [
      0b00000111, 0b10100101, 0b11110000, 0b01010101, 0b11001100, 0b10000000,
    ]
    const bytesOut = [
      0b11100000, 0b10100101, 0b00001111, 0b10101010, 0b00110011, 0b00000001,
    ]
    expect(bytesIn.length).to.equal(bytesOut.length)
    for (let i = 0; i < bytesIn.length; ++i) {
      expect(reverseBits(bytesIn[i])).to.equal(bytesOut[i])
    }
  })
})
