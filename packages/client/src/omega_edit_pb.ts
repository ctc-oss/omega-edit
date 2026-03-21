import './google_protobuf_compat'

export * from './omega_edit/v1/omega_edit_pb'
export { SubscribeToSessionEventsResponse as SessionEvent } from './omega_edit/v1/omega_edit_pb'
export { SubscribeToViewportEventsResponse as ViewportEvent } from './omega_edit/v1/omega_edit_pb'
export { GetHeartbeatRequest as HeartbeatRequest } from './omega_edit/v1/omega_edit_pb'
export { GetHeartbeatResponse as HeartbeatResponse } from './omega_edit/v1/omega_edit_pb'
export { GetServerInfoResponse as ServerInfoResponse } from './omega_edit/v1/omega_edit_pb'

import { SubscribeToSessionEventsRequest } from './omega_edit/v1/omega_edit_pb'

export class EventSubscriptionRequest extends SubscribeToSessionEventsRequest {}
