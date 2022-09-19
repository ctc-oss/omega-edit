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
import { getClient, waitForReady } from '../../src/settings'
import {
  createSession,
  destroySession,
  getSessionCount,
} from '../../src/session'

export const deadline = new Date()
deadline.setSeconds(deadline.getSeconds() + 10)

export async function custom_setup() {
  let session_id = ''
  expect(await waitForReady(getClient(), deadline))

  const new_session_id = await createSession(undefined, undefined, undefined)
  expect(new_session_id).to.be.a('string').and.not.equal(session_id)

  // C++ RPC server uses 36 character UUIDs and the Scala server uses 8 character IDs
  expect(new_session_id.length).to.satisfy((l) => l === 36 || l === 8)
  expect(1).to.be.lessThanOrEqual(await getSessionCount())
  return new_session_id
}

export async function cleanup(session_id: string) {
  expect(1).to.be.lessThanOrEqual(await getSessionCount())
  expect(await destroySession(session_id)).to.equal(session_id)
}
