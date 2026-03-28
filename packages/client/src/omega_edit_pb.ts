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

import type {
  CreateSessionResponse as RawCreateSessionResponse,
  GetByteOrderMarkResponse as RawGetByteOrderMarkResponse,
  GetChangeDetailsResponse as RawGetChangeDetailsResponse,
  GetCharacterCountsResponse as RawGetCharacterCountsResponse,
  GetContentTypeResponse as RawGetContentTypeResponse,
  GetHeartbeatRequest as RawGetHeartbeatRequest,
  GetHeartbeatResponse as RawGetHeartbeatResponse,
  GetLanguageResponse as RawGetLanguageResponse,
  GetServerInfoResponse as RawGetServerInfoResponse,
  GetViewportDataResponse as RawGetViewportDataResponse,
  ModifyViewportResponse as RawModifyViewportResponse,
  CreateViewportResponse as RawCreateViewportResponse,
  SaveSessionResponse as RawSaveSessionResponse,
  ServerControlRequest as RawServerControlRequest,
  ServerControlResponse as RawServerControlResponse,
  SingleCount as RawSingleCount,
  SubscribeToSessionEventsRequest as RawSubscribeToSessionEventsRequest,
  SubscribeToSessionEventsResponse as RawSubscribeToSessionEventsResponse,
  SubscribeToViewportEventsResponse as RawSubscribeToViewportEventsResponse,
} from './protobuf_ts/generated/omega_edit/v1/omega_edit'

function bytesOrEmpty(data?: Uint8Array): Uint8Array {
  return data ?? new Uint8Array()
}

function numberOrZero(value?: number): number {
  return value ?? 0
}

export type CompatibilityViewportResponse =
  | RawCreateViewportResponse
  | RawModifyViewportResponse
  | RawGetViewportDataResponse

export class EventSubscriptionRequest {
  private id_ = ''
  private interest_: number | undefined

  setId(value: string): this {
    this.id_ = value
    return this
  }

  getId(): string {
    return this.id_
  }

  setInterest(value: number): this {
    this.interest_ = value
    return this
  }

  getInterest(): number | undefined {
    return this.interest_
  }

  hasInterest(): boolean {
    return this.interest_ !== undefined
  }

  toObject(): RawSubscribeToSessionEventsRequest {
    return this.toRaw()
  }

  toRaw(): RawSubscribeToSessionEventsRequest {
    const request: RawSubscribeToSessionEventsRequest = {
      id: this.id_,
    }
    if (this.interest_ !== undefined) {
      request.interest = this.interest_
    }
    return request
  }
}

export class HeartbeatRequest {
  private request_: RawGetHeartbeatRequest = {
    hostname: '',
    processId: 0,
    heartbeatInterval: 0,
    sessionIds: [],
  }

  setHostname(value: string): this {
    this.request_.hostname = value
    return this
  }

  getHostname(): string {
    return this.request_.hostname
  }

  setProcessId(value: number): this {
    this.request_.processId = value
    return this
  }

  getProcessId(): number {
    return this.request_.processId
  }

  setHeartbeatInterval(value: number): this {
    this.request_.heartbeatInterval = value
    return this
  }

  getHeartbeatInterval(): number {
    return this.request_.heartbeatInterval
  }

  setSessionIdsList(value: string[]): this {
    this.request_.sessionIds = [...value]
    return this
  }

  getSessionIdsList(): string[] {
    return [...this.request_.sessionIds]
  }

  toObject(): RawGetHeartbeatRequest {
    return this.toRaw()
  }

  toRaw(): RawGetHeartbeatRequest {
    return {
      ...this.request_,
      sessionIds: [...this.request_.sessionIds],
    }
  }
}

export class ServerControlRequest {
  private request_: RawServerControlRequest = { kind: 0 as RawServerControlRequest['kind'] }

  setKind(value: RawServerControlRequest['kind']): this {
    this.request_.kind = value
    return this
  }

  getKind(): RawServerControlRequest['kind'] {
    return this.request_.kind
  }

  toObject(): RawServerControlRequest {
    return this.toRaw()
  }

  toRaw(): RawServerControlRequest {
    return { ...this.request_ }
  }
}

export class CreateSessionResponse {
  constructor(private readonly response_: RawCreateSessionResponse) {}

  getSessionId(): string {
    return this.response_.sessionId
  }

  getCheckpointDirectory(): string {
    return this.response_.checkpointDirectory
  }

  getFileSize(): number {
    return numberOrZero(this.response_.fileSize)
  }

  hasFileSize(): boolean {
    return this.response_.fileSize !== undefined
  }

  toObject(): RawCreateSessionResponse {
    return { ...this.response_ }
  }
}

export class SaveSessionResponse {
  constructor(private readonly response_: RawSaveSessionResponse) {}

  getSessionId(): string {
    return this.response_.sessionId
  }

  getFilePath(): string {
    return this.response_.filePath
  }

  getSaveStatus(): number {
    return this.response_.saveStatus
  }

  toObject(): RawSaveSessionResponse {
    return { ...this.response_ }
  }
}

export class ServerInfoResponse {
  constructor(private readonly response_: RawGetServerInfoResponse) {}

  getHostname(): string {
    return this.response_.hostname
  }

  getProcessId(): number {
    return this.response_.processId
  }

  getServerVersion(): string {
    return this.response_.serverVersion
  }

  getRuntimeKind(): string {
    return this.response_.runtimeKind
  }

  getRuntimeName(): string {
    return this.response_.runtimeName
  }

  getPlatform(): string {
    return this.response_.platform
  }

  getAvailableProcessors(): number {
    return this.response_.availableProcessors
  }

  getCompiler(): string {
    return this.response_.compiler
  }

  getBuildType(): string {
    return this.response_.buildType
  }

  getCppStandard(): string {
    return this.response_.cppStandard
  }

  toObject(): RawGetServerInfoResponse {
    return { ...this.response_ }
  }
}

export class ServerControlResponse {
  constructor(private readonly response_: RawServerControlResponse) {}

  getKind(): RawServerControlResponse['kind'] {
    return this.response_.kind
  }

  getPid(): number {
    return this.response_.pid
  }

  getResponseCode(): number {
    return this.response_.responseCode
  }

  toObject(): RawServerControlResponse {
    return { ...this.response_ }
  }
}

export class HeartbeatResponse {
  constructor(private readonly response_: RawGetHeartbeatResponse) {}

  getSessionCount(): number {
    return this.response_.sessionCount
  }

  getTimestamp(): number {
    return this.response_.timestamp
  }

  getUptime(): number {
    return this.response_.uptime
  }

  getCpuCount(): number {
    return this.response_.cpuCount
  }

  getCpuLoadAverage(): number | undefined {
    return this.response_.loadAverage ?? this.response_.cpuLoadAverage
  }

  getResidentMemoryBytes(): number | undefined {
    return this.response_.residentMemoryBytes
  }

  getVirtualMemoryBytes(): number | undefined {
    return this.response_.virtualMemoryBytes
  }

  getPeakResidentMemoryBytes(): number | undefined {
    return this.response_.peakResidentMemoryBytes
  }

  toObject(): RawGetHeartbeatResponse {
    return { ...this.response_ }
  }
}

export class ViewportDataResponse {
  constructor(private readonly response_: CompatibilityViewportResponse) {}

  getViewportId(): string {
    return this.response_.viewportId
  }

  getOffset(): number {
    return this.response_.offset
  }

  getLength(): number {
    return this.response_.length
  }

  getData(): Uint8Array {
    return bytesOrEmpty(this.response_.data)
  }

  getData_asU8(): Uint8Array {
    return this.getData()
  }

  getFollowingByteCount(): number {
    return this.response_.followingByteCount
  }

  toObject(): CompatibilityViewportResponse {
    return {
      ...this.response_,
      data: this.getData(),
    }
  }
}

export class ChangeDetailsResponse {
  constructor(private readonly response_: RawGetChangeDetailsResponse) {}

  getSessionId(): string {
    return this.response_.sessionId
  }

  getSerial(): number {
    return this.response_.serial
  }

  getKind(): RawGetChangeDetailsResponse['kind'] {
    return this.response_.kind
  }

  getOffset(): number {
    return this.response_.offset
  }

  getLength(): number {
    return this.response_.length
  }

  getData(): Uint8Array {
    return bytesOrEmpty(this.response_.data)
  }

  getData_asU8(): Uint8Array {
    return this.getData()
  }

  toObject(): RawGetChangeDetailsResponse {
    return {
      ...this.response_,
      data: this.getData(),
    }
  }
}

export class ByteOrderMarkResponse {
  constructor(private readonly response_: RawGetByteOrderMarkResponse) {}

  getSessionId(): string {
    return this.response_.sessionId
  }

  getOffset(): number {
    return this.response_.offset
  }

  getLength(): number {
    return this.response_.length
  }

  getByteOrderMark(): string {
    return this.response_.byteOrderMark
  }

  getByteOrderMarkBytes(): number {
    // The proto models BOM byte count as `length`; this getter preserves the
    // legacy jspb API shape expected by existing consumers.
    return this.response_.length
  }

  toObject(): RawGetByteOrderMarkResponse {
    return { ...this.response_ }
  }
}

export class ContentTypeResponse {
  constructor(private readonly response_: RawGetContentTypeResponse) {}

  getSessionId(): string {
    return this.response_.sessionId
  }

  getOffset(): number {
    return this.response_.offset
  }

  getLength(): number {
    return this.response_.length
  }

  getContentType(): string {
    return this.response_.contentType
  }

  toObject(): RawGetContentTypeResponse {
    return { ...this.response_ }
  }
}

export class LanguageResponse {
  constructor(private readonly response_: RawGetLanguageResponse) {}

  getSessionId(): string {
    return this.response_.sessionId
  }

  getOffset(): number {
    return this.response_.offset
  }

  getLength(): number {
    return this.response_.length
  }

  getLanguage(): string {
    return this.response_.language
  }

  toObject(): RawGetLanguageResponse {
    return { ...this.response_ }
  }
}

export class CharacterCountResponse {
  constructor(private readonly response_: RawGetCharacterCountsResponse) {}

  getSessionId(): string {
    return this.response_.sessionId
  }

  getOffset(): number {
    return this.response_.offset
  }

  getLength(): number {
    return this.response_.length
  }

  getByteOrderMark(): string {
    return this.response_.byteOrderMark
  }

  getByteOrderMarkBytes(): number {
    return this.response_.byteOrderMarkBytes
  }

  getSingleByteChars(): number {
    return this.response_.singleByteChars
  }

  getDoubleByteChars(): number {
    return this.response_.doubleByteChars
  }

  getTripleByteChars(): number {
    return this.response_.tripleByteChars
  }

  getQuadByteChars(): number {
    return this.response_.quadByteChars
  }

  getInvalidBytes(): number {
    return this.response_.invalidBytes
  }

  toObject(): RawGetCharacterCountsResponse {
    return { ...this.response_ }
  }
}

export class SingleCount {
  constructor(private readonly count_: RawSingleCount) {}

  getKind(): RawSingleCount['kind'] {
    return this.count_.kind
  }

  getCount(): number {
    return this.count_.count
  }

  toObject(): RawSingleCount {
    return { ...this.count_ }
  }
}

export class SessionEvent {
  constructor(private readonly response_: RawSubscribeToSessionEventsResponse) {}

  getSessionId(): string {
    return this.response_.sessionId
  }

  getSessionEventKind(): RawSubscribeToSessionEventsResponse['sessionEventKind'] {
    return this.response_.sessionEventKind
  }

  getComputedFileSize(): number {
    return this.response_.computedFileSize
  }

  getChangeCount(): number {
    return this.response_.changeCount
  }

  getUndoCount(): number {
    return this.response_.undoCount
  }

  getSerial(): number {
    return numberOrZero(this.response_.serial)
  }

  toObject(): RawSubscribeToSessionEventsResponse {
    return { ...this.response_ }
  }
}

export class ViewportEvent {
  constructor(private readonly response_: RawSubscribeToViewportEventsResponse) {}

  getSessionId(): string {
    return this.response_.sessionId
  }

  getViewportId(): string {
    return this.response_.viewportId
  }

  getViewportEventKind(): RawSubscribeToViewportEventsResponse['viewportEventKind'] {
    return this.response_.viewportEventKind
  }

  getSerial(): number {
    return numberOrZero(this.response_.serial)
  }

  getOffset(): number {
    return numberOrZero(this.response_.offset)
  }

  getLength(): number {
    return numberOrZero(this.response_.length)
  }

  getData(): Uint8Array {
    return bytesOrEmpty(this.response_.data)
  }

  getData_asU8(): Uint8Array {
    return this.getData()
  }

  toObject(): RawSubscribeToViewportEventsResponse {
    return {
      ...this.response_,
      data: this.getData(),
    }
  }
}

export function wrapCreateSessionResponse(
  response: RawCreateSessionResponse
): CreateSessionResponse {
  return new CreateSessionResponse(response)
}

export function wrapSaveSessionResponse(
  response: RawSaveSessionResponse
): SaveSessionResponse {
  return new SaveSessionResponse(response)
}

export function wrapServerInfoResponse(
  response: RawGetServerInfoResponse
): ServerInfoResponse {
  return new ServerInfoResponse(response)
}

export function wrapServerControlResponse(
  response: RawServerControlResponse
): ServerControlResponse {
  return new ServerControlResponse(response)
}

export function wrapHeartbeatResponse(
  response: RawGetHeartbeatResponse
): HeartbeatResponse {
  return new HeartbeatResponse(response)
}

export function wrapViewportDataResponse(
  response: CompatibilityViewportResponse
): ViewportDataResponse {
  return new ViewportDataResponse(response)
}

export function wrapChangeDetailsResponse(
  response: RawGetChangeDetailsResponse
): ChangeDetailsResponse {
  return new ChangeDetailsResponse(response)
}

export function wrapByteOrderMarkResponse(
  response: RawGetByteOrderMarkResponse
): ByteOrderMarkResponse {
  return new ByteOrderMarkResponse(response)
}

export function wrapContentTypeResponse(
  response: RawGetContentTypeResponse
): ContentTypeResponse {
  return new ContentTypeResponse(response)
}

export function wrapLanguageResponse(
  response: RawGetLanguageResponse
): LanguageResponse {
  return new LanguageResponse(response)
}

export function wrapCharacterCountResponse(
  response: RawGetCharacterCountsResponse
): CharacterCountResponse {
  return new CharacterCountResponse(response)
}

export function wrapSingleCount(response: RawSingleCount): SingleCount {
  return new SingleCount(response)
}

export function wrapSessionEvent(
  response: RawSubscribeToSessionEventsResponse
): SessionEvent {
  return new SessionEvent(response)
}

export function wrapViewportEvent(
  response: RawSubscribeToViewportEventsResponse
): ViewportEvent {
  return new ViewportEvent(response)
}
