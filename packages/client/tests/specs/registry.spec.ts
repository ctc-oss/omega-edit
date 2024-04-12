import { afterEach, describe, it } from 'mocha'
import { TimedRegistry } from './registryMock'
import { IHeartbeatReceiver } from '../../src/registry'
import assert from 'assert'
import { IServerHeartbeat } from '../../src/server'

const nullProcessFn = () => {}
const receiverMocks: IHeartbeatReceiver[] = [
  { id: 'abc-123', process: nullProcessFn },
  { id: 'de1', process: nullProcessFn },
  { id: 'dfdl-debug-de', process: nullProcessFn },
]
const mockServerHeartbeat: IServerHeartbeat = {
  latency: 15, // latency in ms
  sessionCount: 0, // session count
  serverTimestamp: Date.now(), // timestamp in ms
  serverUptime: 100, // uptime in ms
  serverCpuCount: 4, // cpu count
  serverCpuLoadAverage: 0, // cpu load average
  serverMaxMemory: 16, // max memory in bytes
  serverCommittedMemory: 2, // committed memory in bytes
  serverUsedMemory: 2, // used memory in bytes
}

const registry = new TimedRegistry()

const getServerHeartbeatMock = (
  receiver: IHeartbeatReceiver,
  heartbeatInterval: number = 1000
): Promise<IServerHeartbeat> => {
  return new Promise((resolve) => {
    registry.update(receiver, { failAfterMs: heartbeatInterval })
    receiver.process(mockServerHeartbeat)
    resolve(mockServerHeartbeat)
  })
}
class HeartbeatRetention implements IHeartbeatReceiver {
  id: string = 'retention'
  private last: IServerHeartbeat | undefined = undefined
  process(heartbeat: IServerHeartbeat) {
    this.last = heartbeat
  }
  getLast(): IServerHeartbeat {
    return this.last!
  }
}
const LastHeartbeatKeeper = new HeartbeatRetention()

describe('Heartbeat Receivers', () => {
  let timeout: NodeJS.Timeout | undefined
  afterEach(() => {
    clearTimeout(timeout)
    registry.M_reset()
  })
  describe('Registry Interactions', () => {
    it('Should be able to interact with the registery through the `getServerHeartbeatFor` function', (done) => {
      getServerHeartbeatMock(LastHeartbeatKeeper).then((hb) => {
        assert.equal(LastHeartbeatKeeper.getLast(), hb)
        assert(
          registry.M_registry().size == 1 &&
            registry.M_registry().get(LastHeartbeatKeeper)
        )
        done()
      })
    })
  })
})

describe('Heartbeat Registry Implementations', () => {
  let timeout: NodeJS.Timeout | undefined
  afterEach(() => {
    clearTimeout(timeout)
    registry.M_reset()
  })
  describe('Timeout Based registry', () => {
    it('Should automatically remove a receiver upon uncleared timeout', (done) => {
      registry.update(receiverMocks[1], { failAfterMs: 250 })
      registry.OnAllReceiversRemoved(() => {
        assert(true)
        done()
      })

      timeout = setTimeout(() => {
        assert.fail('Did not emit removal before 250ms')
      }, 300)
    })

    it("Should refresh a receiver's timeout upon updates", (done) => {
      const ExpectedUpdateCount = 3
      let updateCount = 0

      registry.update(receiverMocks[1], { failAfterMs: 100 })
      registry.OnAllReceiversRemoved(() => {
        assert.equal(updateCount, 3)
        done()
      })
      let updateInterval = setInterval(() => {
        updateCount++
        if (updateCount >= ExpectedUpdateCount) clearInterval(updateInterval)
        registry.update(receiverMocks[1], { failAfterMs: 100 })
      }, 50)

      timeout = setTimeout(() => {
        assert.fail('Did not ')
      }, 500)
    })

    it('Should not emit "OnAllReceiversRemoved" with active receivers', (done) => {
      registry.update(receiverMocks[0], { failAfterMs: 250 })
      registry.update(receiverMocks[1], { failAfterMs: 50 })
      timeout = setTimeout(() => {
        assert(registry.M_registry().size == 1)
        assert(registry.M_registry().has(receiverMocks[0]))
        done()
      }, 100)
    })
  })
})

function shortTime(time: number): string {
  const timeStr = time.toString()
  return '..' + timeStr.substring(timeStr.length - 4)
}
