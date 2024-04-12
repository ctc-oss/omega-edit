import EventEmitter from "events";
import { IHeartbeatReceiver, IHeartbeatRegistry } from "../../src/registry";

const EmptyEvent = 'emptied'

export type TimeTolerance = { failAfterMs: number } 

export class TimeRegistryTolerance {
  protected timeout: NodeJS.Timeout | undefined
  constructor(
    tolerance: TimeTolerance,
    public onFailure: () => void
  ){ this.timeout = setTimeout(onFailure, tolerance.failAfterMs) }
  
  extend(tolerance: TimeTolerance){
    clearTimeout(this.timeout)
    this.timeout = setTimeout(this.onFailure, tolerance.failAfterMs)
  }
  clear(){ clearTimeout(this.timeout) }
}

export class TimedRegistry implements IHeartbeatRegistry<TimeTolerance> {
  private registry_: Map<IHeartbeatReceiver, TimeRegistryTolerance> = new Map()
  private events = new EventEmitter()

  update(receiver: IHeartbeatReceiver, tolerance: TimeTolerance) {
    let item = this.registry_.get(receiver)
    item 
      ? item.extend(tolerance)
      : this.registry_.set(receiver, new TimeRegistryTolerance(tolerance, () => { this.remove(receiver) }))
  }

  OnAllReceiversRemoved(listener: (ctx: any) => void){
    this.events.on(EmptyEvent, listener)
  }

  remove(receiver: IHeartbeatReceiver): void {
    this.registry_.delete(receiver)
    if(this.registry_.size == 0)
      this.events.emit(EmptyEvent)
  }

  // Test Functions
  M_reset(emit: boolean = false){ 
    this.registry_.forEach((tolerance) => {
      tolerance.clear()
    })
    this.registry_.clear()

    this.events.removeAllListeners()
    if(emit) this.events.emit(EmptyEvent)
  }
  M_registry(){ return this.registry_ }
  M_remove(receiver: IHeartbeatReceiver){ this.remove(receiver) }
}