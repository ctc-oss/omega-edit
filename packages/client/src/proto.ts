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
  CountKind as ProtoCountKind,
  ServerControlKind as ProtoServerControlKind,
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

export { ProtoCountKind, ProtoServerControlKind }

export const CountKind = {
  COUNT_COMPUTED_FILE_SIZE: ProtoCountKind.COMPUTED_FILE_SIZE,
  COUNT_CHANGES: ProtoCountKind.CHANGES,
  COUNT_UNDOS: ProtoCountKind.UNDOS,
  COUNT_VIEWPORTS: ProtoCountKind.VIEWPORTS,
  COUNT_CHECKPOINTS: ProtoCountKind.CHECKPOINTS,
  COUNT_SEARCH_CONTEXTS: ProtoCountKind.SEARCH_CONTEXTS,
  COUNT_CHANGE_TRANSACTIONS: ProtoCountKind.CHANGE_TRANSACTIONS,
  COUNT_UNDO_TRANSACTIONS: ProtoCountKind.UNDO_TRANSACTIONS,
  ...ProtoCountKind,
}

export const ServerControlKind = {
  SERVER_CONTROL_GRACEFUL_SHUTDOWN: ProtoServerControlKind.GRACEFUL_SHUTDOWN,
  SERVER_CONTROL_IMMEDIATE_SHUTDOWN: ProtoServerControlKind.IMMEDIATE_SHUTDOWN,
  ...ProtoServerControlKind,
}
