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
import { decode, encode } from 'fastestsmallesttextencoderdecoder'
// @ts-ignore
import { deadline } from './common'

describe('Encode/Decode', () => {
  it('Should encode string into Uint8Array', () => {
    expect(encode('abc123'))
      .deep.equals(Buffer.from('abc123'))
      .and.deep.equals(new Uint8Array([97, 98, 99, 49, 50, 51]))
  })

  it('Should decode Uint8Array into string', () => {
    expect('abc123').to.equal(decode(new Uint8Array([97, 98, 99, 49, 50, 51])))
  })
})
