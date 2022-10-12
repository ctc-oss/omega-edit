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

const nibbleReverseLookup = [
  0x0, 0x8, 0x4, 0xc, 0x2, 0xa, 0x6, 0xe, 0x1, 0x9, 0x5, 0xd, 0x3, 0xb, 0x7,
  0xf,
]

/**
 * Takes a byte, and reverses the bits, (e.g., 0b0000 0111 => 0b1110 0000)
 * @param b 8-bit byte to reverse
 */
export function reverseBits(b) {
  // Reverse the top and bottom nibble and then swap them
  return (nibbleReverseLookup[b & 0b1111] << 4) | nibbleReverseLookup[b >> 4]
}

export class BitArray {
    private readonly uints: Uint32Array
    private readonly bits: number

    constructor(bits: number) {
        this.bits = bits
        this.uints = new Uint32Array(Math.ceil(bits / 32))
    }

    getBit(bit: number): number {
        return (this.uints[Math.floor(bit / 32)] & (1 << (bit % 32))) !== 0 ? 1 : 0
    }

    assignBit(bit: number, value: number) {
        if (value === 1) {
            this.uints[Math.floor(bit / 32)] |= (1 << (bit % 32))
        } else if (value === 0) {
            this.uints[Math.floor(bit / 32)] &= ~(1 << (bit % 32))
        }
    }

    get size(): number {
        return this.bits
    }

    get capacity(): number {
        return this.uints.length * 32
    }
}
