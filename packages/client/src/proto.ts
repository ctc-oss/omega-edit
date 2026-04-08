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

import {
  CountKind as RawProtoCountKind,
  ServerControlKind as RawProtoServerControlKind,
  ServerControlStatus as RawProtoServerControlStatus,
} from './protobuf_ts/generated/omega_edit/v1/omega_edit'

export {
  CreateSessionResponse,
  EventSubscriptionRequest,
  HeartbeatRequest,
  HeartbeatResponse,
  SaveSessionResponse,
  ServerControlRequest,
  ServerControlResponse,
  ServerInfoResponse,
  SessionEvent,
  SingleCount,
  ViewportEvent,
  ViewportDataResponse,
} from './omega_edit_pb'

export { EditorClient, EditorServiceService } from './omega_edit_grpc_pb'

export const ProtoCountKind = {
  COUNT_KIND_COMPUTED_FILE_SIZE: RawProtoCountKind.COMPUTED_FILE_SIZE,
  COUNT_KIND_CHANGES: RawProtoCountKind.CHANGES,
  COUNT_KIND_UNDOS: RawProtoCountKind.UNDOS,
  COUNT_KIND_VIEWPORTS: RawProtoCountKind.VIEWPORTS,
  COUNT_KIND_CHECKPOINTS: RawProtoCountKind.CHECKPOINTS,
  COUNT_KIND_SEARCH_CONTEXTS: RawProtoCountKind.SEARCH_CONTEXTS,
  COUNT_KIND_CHANGE_TRANSACTIONS: RawProtoCountKind.CHANGE_TRANSACTIONS,
  COUNT_KIND_UNDO_TRANSACTIONS: RawProtoCountKind.UNDO_TRANSACTIONS,
  ...RawProtoCountKind,
}

export const ProtoServerControlKind = {
  SERVER_CONTROL_KIND_GRACEFUL_SHUTDOWN:
    RawProtoServerControlKind.GRACEFUL_SHUTDOWN,
  SERVER_CONTROL_KIND_IMMEDIATE_SHUTDOWN:
    RawProtoServerControlKind.IMMEDIATE_SHUTDOWN,
  ...RawProtoServerControlKind,
}

export const ProtoServerControlStatus = {
  SERVER_CONTROL_STATUS_UNSPECIFIED: RawProtoServerControlStatus.UNSPECIFIED,
  SERVER_CONTROL_STATUS_COMPLETED: RawProtoServerControlStatus.COMPLETED,
  SERVER_CONTROL_STATUS_DRAINING: RawProtoServerControlStatus.DRAINING,
  ...RawProtoServerControlStatus,
}

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

export const ServerControlStatus = {
  SERVER_CONTROL_STATUS_UNSPECIFIED:
    ProtoServerControlStatus.SERVER_CONTROL_STATUS_UNSPECIFIED,
  SERVER_CONTROL_STATUS_COMPLETED:
    ProtoServerControlStatus.SERVER_CONTROL_STATUS_COMPLETED,
  SERVER_CONTROL_STATUS_DRAINING:
    ProtoServerControlStatus.SERVER_CONTROL_STATUS_DRAINING,
  UNSPECIFIED: RawProtoServerControlStatus.UNSPECIFIED,
  COMPLETED: RawProtoServerControlStatus.COMPLETED,
  DRAINING: RawProtoServerControlStatus.DRAINING,
}
