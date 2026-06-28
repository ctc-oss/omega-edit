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

import { expect } from './common.js'
import {
  ALL_EVENTS,
  NO_EVENTS,
  SESSION_EVENTS_ALL,
  SessionEventKind,
  VIEWPORT_EVENTS_ALL,
  ViewportEventKind,
} from '@omega-edit/client'

function combineEventMask(events: Record<string, number>): number {
  return Object.values(events).reduce((mask, event) => mask | event, 0)
}

describe('Events', () => {
  it('can be bitwise manipulated and tested', () => {
    const expectedSessionEvents = combineEventMask(SessionEventKind)
    const expectedViewportEvents = combineEventMask(ViewportEventKind)

    expect(NO_EVENTS).to.equal(0)
    expect(SESSION_EVENTS_ALL).to.equal(expectedSessionEvents)
    expect(VIEWPORT_EVENTS_ALL).to.equal(expectedViewportEvents)
    expect(ALL_EVENTS).to.equal(expectedSessionEvents | expectedViewportEvents)
    expect(ALL_EVENTS).to.be.greaterThan(NO_EVENTS)
    expect(ALL_EVENTS & SessionEventKind.RESTORE_CHECKPOINT).to.equal(
      SessionEventKind.RESTORE_CHECKPOINT
    )
    expect(ALL_EVENTS & ViewportEventKind.EDIT).to.equal(ViewportEventKind.EDIT)
    expect(ALL_EVENTS & ~ViewportEventKind.EDIT).to.equal(
      ALL_EVENTS - ViewportEventKind.EDIT
    )
    expect(
      ALL_EVENTS & ~ViewportEventKind.EDIT & ViewportEventKind.EDIT
    ).to.equal(NO_EVENTS)
    expect(NO_EVENTS | ViewportEventKind.EDIT).to.equal(ViewportEventKind.EDIT)
  })
})
