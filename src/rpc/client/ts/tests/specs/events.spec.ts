import { expect } from 'chai'
import { ALL_EVENTS, NO_EVENTS } from '../../src/client'
import { ViewportEventKind } from '../../src/omega_edit_pb'

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
