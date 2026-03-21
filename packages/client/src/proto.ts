export {
  CreateSessionRequest,
  EventSubscriptionRequest,
  CreateSessionResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  ServerInfoResponse,
  SaveSessionRequest,
  SaveSessionResponse,
  SessionEvent,
  ServerControlRequest,
  ServerControlResponse,
  ViewportEvent,
} from './omega_edit_pb'

export {
  CountKind as ProtoCountKind,
  ServerControlKind as ProtoServerControlKind,
} from './omega_edit_pb'

import {
  CountKind as ProtoCountKind,
  ServerControlKind as ProtoServerControlKind,
} from './omega_edit_pb'

export const CountKind = {
  COUNT_COMPUTED_FILE_SIZE: ProtoCountKind.COUNT_KIND_COMPUTED_FILE_SIZE,
  COUNT_CHANGES: ProtoCountKind.COUNT_KIND_CHANGES,
  COUNT_UNDOS: ProtoCountKind.COUNT_KIND_UNDOS,
  COUNT_VIEWPORTS: ProtoCountKind.COUNT_KIND_VIEWPORTS,
  COUNT_CHECKPOINTS: ProtoCountKind.COUNT_KIND_CHECKPOINTS,
  COUNT_SEARCH_CONTEXTS: ProtoCountKind.COUNT_KIND_SEARCH_CONTEXTS,
  COUNT_CHANGE_TRANSACTIONS: ProtoCountKind.COUNT_KIND_CHANGE_TRANSACTIONS,
  COUNT_UNDO_TRANSACTIONS: ProtoCountKind.COUNT_KIND_UNDO_TRANSACTIONS,
  ...ProtoCountKind,
}

export const ServerControlKind = {
  SERVER_CONTROL_GRACEFUL_SHUTDOWN:
    ProtoServerControlKind.SERVER_CONTROL_KIND_GRACEFUL_SHUTDOWN,
  SERVER_CONTROL_IMMEDIATE_SHUTDOWN:
    ProtoServerControlKind.SERVER_CONTROL_KIND_IMMEDIATE_SHUTDOWN,
  ...ProtoServerControlKind,
}

export {
  EditorClient,
  EditorServiceService,
} from './omega_edit_grpc_pb'
