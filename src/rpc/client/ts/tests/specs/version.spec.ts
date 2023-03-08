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
import {
  ClientVersion,
  getClientVersion,
  getServerVersion,
} from '../../src/version'
import { getClient, waitForReady } from '../../src/client'

// prettier-ignore
// @ts-ignore

describe('Version', () => {
  const port = 9010

  beforeEach('Ensure the client is ready', async () => {
    expect(await waitForReady(getClient(port)))
  })

  it('Server version should return version ' + ClientVersion, async () => {
    expect(await getServerVersion())
      .to.equal(getClientVersion())
      .to.equal(ClientVersion)
  })
})
