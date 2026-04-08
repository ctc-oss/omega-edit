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

export const CountKind = {
  UNSPECIFIED: RawProtoCountKind.UNSPECIFIED,
  COMPUTED_FILE_SIZE: RawProtoCountKind.COMPUTED_FILE_SIZE,
  CHANGES: RawProtoCountKind.CHANGES,
  UNDOS: RawProtoCountKind.UNDOS,
  VIEWPORTS: RawProtoCountKind.VIEWPORTS,
  CHECKPOINTS: RawProtoCountKind.CHECKPOINTS,
  SEARCH_CONTEXTS: RawProtoCountKind.SEARCH_CONTEXTS,
  CHANGE_TRANSACTIONS: RawProtoCountKind.CHANGE_TRANSACTIONS,
  UNDO_TRANSACTIONS: RawProtoCountKind.UNDO_TRANSACTIONS,
} as const
export type CountKind = (typeof CountKind)[keyof typeof CountKind]

export const ServerControlKind = {
  UNSPECIFIED: RawProtoServerControlKind.UNSPECIFIED,
  GRACEFUL_SHUTDOWN: RawProtoServerControlKind.GRACEFUL_SHUTDOWN,
  IMMEDIATE_SHUTDOWN: RawProtoServerControlKind.IMMEDIATE_SHUTDOWN,
} as const
export type ServerControlKind =
  (typeof ServerControlKind)[keyof typeof ServerControlKind]

export const ServerControlStatus = {
  UNSPECIFIED: RawProtoServerControlStatus.UNSPECIFIED,
  COMPLETED: RawProtoServerControlStatus.COMPLETED,
  DRAINING: RawProtoServerControlStatus.DRAINING,
} as const
export type ServerControlStatus =
  (typeof ServerControlStatus)[keyof typeof ServerControlStatus]
