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
import { ALL_EVENTS, NO_EVENTS, ViewportEventKind } from 'omega-edit'

describe('Events', () => {
  it('can be bitwise manipulated and tested', () => {
    expect(NO_EVENTS).to.equal(0)
    expect(~0).to.equal(-1)
    expect(ALL_EVENTS).to.equal(-1)
    expect(ALL_EVENTS).to.equal(~NO_EVENTS)
    expect(NO_EVENTS).to.equal(~ALL_EVENTS)
    expect(ALL_EVENTS & ~ViewportEventKind.VIEWPORT_EVT_EDIT).to.equal(-3)
    expect(ALL_EVENTS & ViewportEventKind.VIEWPORT_EVT_EDIT).to.equal(
      ViewportEventKind.VIEWPORT_EVT_EDIT
    )
    expect(
      ALL_EVENTS &
        ~ViewportEventKind.VIEWPORT_EVT_EDIT &
        ViewportEventKind.VIEWPORT_EVT_EDIT
    ).to.equal(NO_EVENTS)
    expect(NO_EVENTS | ViewportEventKind.VIEWPORT_EVT_EDIT).to.equal(
      ViewportEventKind.VIEWPORT_EVT_EDIT
    )
  })
})
