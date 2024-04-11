import { IServerHeartbeat } from "./server";
export type TimeInfo = {
  readonly nextTimestampMs: number
}
export interface IHeartbeatReceiver {
  readonly id: string
  process(heartbeat: IServerHeartbeat): any
}
export interface IHeartbeatRequester {
  request(): void
}
export interface IHeartbeatRegistry {
  update(receiver: IHeartbeatReceiver, expectNextInMs: number): any
  remove(id: IHeartbeatReceiver['id']): any
}
class HeartbeatRegistryManager {
  private registry_: Map<IHeartbeatReceiver, TimeInfo> = new Map()
  private checkIntervalId: NodeJS.Timeout | undefined = undefined

  readonly checkIntervalMs: number = 3000

  update(receiver: IHeartbeatReceiver, time: Required<TimeInfo>) {

  }

}