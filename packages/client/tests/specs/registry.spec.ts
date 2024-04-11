import { describe, it, Done } from "mocha";
import { IHeartbeatReceiver, IHeartbeatRegistry, TimeInfo } from "../../src/registry"
import EventEmitter from "events";
import assert from "assert";

class MockRegistry implements IHeartbeatRegistry {
  private registry_: Map<IHeartbeatReceiver, TimeInfo> = new Map()
  // private temporalRegistry_: Map<IHeartbeatReceiver, NodeJS.Timeout> = new Map()
  private checkIntervalId: NodeJS.Timeout | undefined = undefined
  private registryEventEmitter = new EventEmitter()
  private eventName = 'empty'
  private checkEvent = 'checked'
  private checkIntervalMs: number = 3000
  private toleranceMs: number = 3000

  constructor(){
  }
  // Expected public event
  onEmpty(listener: ()=>any) { this.registryEventEmitter.on(this.eventName, listener) }

  // Mock-only events
  _onCheck(listener: ()=>any) { this.registryEventEmitter.on(this.checkEvent, listener) }
  _onRemoval(listener: (context: any)=>any){ this.registryEventEmitter.on('removal', listener) }
  _onToleranceFailure(listener: (context: any)=>any){ this.registryEventEmitter.on('dead', listener) }

  setTolerance(tolerance: number){ this.toleranceMs = tolerance }
  tolerance(): number { return this.toleranceMs }
  setCheckInterval(checkIntervalMs: number){ this.checkIntervalMs = checkIntervalMs }
  checkInterval(): number { return this.checkIntervalMs }

  update(receiver: IHeartbeatReceiver, expectNextInMs: number) { 
    this.registry_.set(receiver, { nextTimestampMs: Date.now() + expectNextInMs })
    if(!this.checkIntervalId)
      this.checkIntervalId = setInterval(() => { this.check() }, this.checkIntervalMs)
  }

  remove(id: string) {
    this.registry_.forEach((time, receiver) => {
      if( receiver.id == id ) {
        this.registry_.delete(receiver)
        this.registryEventEmitter.emit('removal', receiver.id)
      }
    })
    if(this.registry_.size == 0){
      clearInterval(this.checkIntervalId)
      this.checkIntervalId = undefined
      this.registryEventEmitter.emit(this.eventName)
    }
  }

  private check() {
    this.registry_.forEach((time, receiver) => {
      
      if(!this.inTolerance(time)) {
        this.registryEventEmitter.emit('dead')
        this.remove(receiver.id)
      }
      this.registryEventEmitter.emit(this.checkEvent)
    })
  }
  private inTolerance(time: TimeInfo): boolean {
    console.log(`Tolerance Calc: ${Date.now()} - ${time.nextTimestampMs + this.toleranceMs} = ${Date.now() - time.nextTimestampMs + this.toleranceMs}`)
    return Date.now() <= time.nextTimestampMs + this.toleranceMs
  }
}

describe("Heartbeat Registry Functionality", function(){
  const mockReceiver: IHeartbeatReceiver = {id: "abc123", process: (_) => {}}

  it("Should drop the receiver at the next check when out of tolerance", function(done){
    const registry = new MockRegistry()
    registry.setTolerance(500)
    registry.setCheckInterval(250)

    registry._onToleranceFailure((ctx) => {
      assert(ctx.variance <= 550, `variance: ${ctx.variance}`)
      done()
    })
    registry.update(mockReceiver, 500)
  })

  it("Should emit an event when receiver count drops to zero", function(done){
    const registry = new MockRegistry()
    registry.setTolerance(500)
    registry.setCheckInterval(250)

    let timeout: NodeJS.Timeout | undefined = undefined
    registry.onEmpty(()=>{ 
      clearTimeout(timeout)
      done()
    })
    registry.update(mockReceiver, 500)
    timeout = setTimeout(()=>{ 
      assert.fail("Empty Event was not emitted")
    }, 5000)
  })
})