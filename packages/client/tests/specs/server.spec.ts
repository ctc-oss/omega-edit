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

import {
  createSession,
  destroySession,
  getClient,
  getSessionCount,
  pidIsRunning,
  startServer,
  stopServerGraceful,
  stopServerImmediate,
  stopServerUsingPID,
} from '@omega-edit/client'
import { expect } from 'chai'

// @ts-ignore
import { testPort } from './common'

describe('Server', () => {
  let pid: number | undefined
  let session_id: string
  const serverTestPort = testPort + 1

  beforeEach(
    `create a server on port ${serverTestPort} and create a single session`,
    async () => {
      pid = await startServer(serverTestPort)
      expect(pid).to.be.a('number').greaterThan(0)
      expect(pidIsRunning(pid as number)).to.be.true
      expect(await getClient(serverTestPort)).to.not.be.undefined
      expect(await getSessionCount()).to.equal(0)
      session_id = (await createSession()).getSessionId()
      expect(session_id.length).to.equal(36)
      expect(await getSessionCount()).to.equal(1)
    }
  )

  afterEach(
    `server on port ${serverTestPort} should no longer exist`,
    async () => {
      // pause to allow server some time to shut down gracefully
      await new Promise((resolve) => setTimeout(resolve, 1000)) // 1 second

      // after each test, the server should be stopped
      expect(pidIsRunning(pid as number)).to.be.false
    }
  )

  it(`on port ${serverTestPort} should stop immediately via PID`, async () => {
    // stop the server using its pid should stop the server immediately using the operating system
    expect(await stopServerUsingPID(pid as number)).to.be.true
  })

  xit(`on port ${serverTestPort} should stop immediately via API`, async () => {
    // stop the server immediately should stop the server immediately without waiting for sessions to end
    expect(await stopServerImmediate()).to.equal(0)
  })

  xit(`on port ${serverTestPort} should stop gracefully via API`, async () => {
    // stop the server gracefully
    expect(await stopServerGraceful()).to.equal(0)

    // pause to allow server some time to remain up
    await new Promise((resolve) => setTimeout(resolve, 1000)) // 1 second

    // for graceful shutdown, the server should still be running until the session count drops to 0
    expect(pidIsRunning(pid as number)).to.be.true

    // once the server is stopping gracefully, no new sessions should be allowed
    expect((await createSession()).getSessionId()).to.be.empty
    expect(await getSessionCount()).to.equal(1)

    // destroy the session, dropping the count to 0, then the server should stop
    expect(await destroySession(session_id)).to.equal(session_id)
  })
})
