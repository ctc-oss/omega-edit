import EventEmitter = require('events')
import { IServerHeartbeat } from './server'
export interface IHeartbeatReceiver {
  readonly id: string
  process(heartbeat: IServerHeartbeat): any
}
export interface IHeartbeatRequester {
  request(): void
}
export interface IHeartbeatRegistry<T> {
  update(receiver: IHeartbeatReceiver, measure: T): any
  remove(receiver: IHeartbeatReceiver): void
  OnAllReceiversRemoved(listener: (ctx: any) => void): void
}

export type TimeTolerance = { failAfterMs: number }

class TimeRegistryTolerance {
  protected timeout: NodeJS.Timeout | undefined
  constructor(
    tolerance: TimeTolerance,
    public onFailure: () => void
  ) {
    this.timeout = setTimeout(onFailure, tolerance.failAfterMs)
  }

  extend(tolerance: TimeTolerance) {
    clearTimeout(this.timeout)
    this.timeout = setTimeout(this.onFailure, tolerance.failAfterMs)
  }
  clear() {
    clearTimeout(this.timeout)
  }
}

const EmptyEvent = 'emptied'
class TimedHeartbeatRegistry implements IHeartbeatRegistry<TimeTolerance> {
  private registry_: Map<IHeartbeatReceiver, TimeRegistryTolerance> = new Map()
  private events = new EventEmitter()
  update(receiver: IHeartbeatReceiver, tolerance: TimeTolerance) {
    let item = this.registry_.get(receiver)
    item
      ? item.extend(tolerance)
      : this.registry_.set(
          receiver,
          new TimeRegistryTolerance(tolerance, () => {
            this.remove(receiver)
          })
        )
  }
  remove(receiver: IHeartbeatReceiver): void {
    this.registry_.delete(receiver)
    if (this.registry_.size == 0) this.events.emit(EmptyEvent)
  }
  OnAllReceiversRemoved(listener: (ctx: any) => void): void {
    this.events.on(EmptyEvent, listener)
  }
}

export const HeartbeatRegistry = new TimedHeartbeatRegistry()
