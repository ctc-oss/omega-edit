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

import * as grpc from '@grpc/grpc-js'
import { expect, initChai } from './common'
import {
  ByteOrderMarkResponse,
  ChangeDetailsResponse,
  CharacterCountResponse,
  ContentTypeResponse,
  CreateSessionResponse,
  EventSubscriptionRequest,
  HeartbeatRequest,
  HeartbeatResponse,
  LanguageResponse,
  SaveSessionResponse,
  ServerControlRequest,
  ServerControlResponse,
  ServerInfoResponse,
  SessionEvent,
  SingleCount,
  ViewportDataResponse,
  ViewportEvent,
  wrapByteOrderMarkResponse,
  wrapChangeDetailsResponse,
  wrapCharacterCountResponse,
  wrapContentTypeResponse,
  wrapCreateSessionResponse,
  wrapHeartbeatResponse,
  wrapLanguageResponse,
  wrapSaveSessionResponse,
  wrapServerControlResponse,
  wrapServerInfoResponse,
  wrapSessionEvent,
  wrapSingleCount,
  wrapViewportDataResponse,
  wrapViewportEvent,
} from '../../src/omega_edit_pb'
import { CountKind, ServerControlKind } from '../../src/proto'
import { EditorClient } from '../../src/omega_edit_grpc_pb'
import {
  CountKind as ProtoCountKind,
  ServerControlKind as ProtoServerControlKind,
  SessionEventKind,
  ViewportEventKind,
} from '../../src/protobuf_ts/generated/omega_edit/v1/omega_edit'
import { EditorServiceClient } from '../../src/protobuf_ts/generated/omega_edit/v1/omega_edit.grpc-client'

type Handler = (...args: any[]) => void

class FakeReadableStream<T> {
  handlers = new Map<string, Handler[]>()

  on(event: string, listener: Handler): this {
    const listeners = this.handlers.get(event) || []
    listeners.push(listener)
    this.handlers.set(event, listeners)
    return this
  }

  emit(event: string, payload: T): void {
    for (const listener of this.handlers.get(event) || []) {
      listener(payload)
    }
  }
}

describe('Proto Compatibility', () => {
  before(async () => {
    await initChai()
  })

  it('should preserve wrapper getter behavior for protobuf-ts compatibility classes', () => {
    const eventRequest = new EventSubscriptionRequest()
      .setId('session-id')
      .setInterest(7)
    expect(eventRequest.getId()).to.equal('session-id')
    expect(eventRequest.getInterest()).to.equal(7)
    expect(eventRequest.hasInterest()).to.be.true
    expect(eventRequest.toObject()).to.deep.equal({
      id: 'session-id',
      interest: 7,
    })

    const heartbeatRequest = new HeartbeatRequest()
      .setHostname('host')
      .setProcessId(42)
      .setHeartbeatInterval(250)
      .setSessionIdsList(['a', 'b'])
    expect(heartbeatRequest.getHostname()).to.equal('host')
    expect(heartbeatRequest.getProcessId()).to.equal(42)
    expect(heartbeatRequest.getHeartbeatInterval()).to.equal(250)
    expect(heartbeatRequest.getSessionIdsList()).to.deep.equal(['a', 'b'])
    expect(heartbeatRequest.toRaw()).to.deep.equal({
      hostname: 'host',
      processId: 42,
      heartbeatInterval: 250,
      sessionIds: ['a', 'b'],
    })

    const serverControlRequest = new ServerControlRequest().setKind(
      ProtoServerControlKind.GRACEFUL_SHUTDOWN
    )
    expect(serverControlRequest.getKind()).to.equal(
      ProtoServerControlKind.GRACEFUL_SHUTDOWN
    )

    const createSession = new CreateSessionResponse({
      sessionId: 'sid',
      checkpointDirectory: 'chk',
      fileSize: 9,
    })
    expect(createSession.getSessionId()).to.equal('sid')
    expect(createSession.getCheckpointDirectory()).to.equal('chk')
    expect(createSession.getFileSize()).to.equal(9)
    expect(createSession.hasFileSize()).to.be.true

    const createSessionWithoutFile = new CreateSessionResponse({
      sessionId: 'sid',
      checkpointDirectory: 'chk',
    })
    expect(createSessionWithoutFile.getFileSize()).to.equal(0)
    expect(createSessionWithoutFile.hasFileSize()).to.be.false

    const saveSession = new SaveSessionResponse({
      sessionId: 'sid',
      filePath: 'file.bin',
      saveStatus: 0,
    })
    expect(saveSession.getSessionId()).to.equal('sid')
    expect(saveSession.getFilePath()).to.equal('file.bin')
    expect(saveSession.getSaveStatus()).to.equal(0)

    const serverInfo = new ServerInfoResponse({
      hostname: 'host',
      processId: 99,
      serverVersion: '1.0.1',
      jvmVersion: '',
      jvmVendor: '',
      jvmPath: '',
      availableProcessors: 16,
    })
    expect(serverInfo.getHostname()).to.equal('host')
    expect(serverInfo.getProcessId()).to.equal(99)
    expect(serverInfo.getServerVersion()).to.equal('1.0.1')
    expect(serverInfo.getJvmVersion()).to.equal('')
    expect(serverInfo.getJvmVendor()).to.equal('')
    expect(serverInfo.getJvmPath()).to.equal('')
    expect(serverInfo.getAvailableProcessors()).to.equal(16)

    const serverControl = new ServerControlResponse({
      kind: ProtoServerControlKind.IMMEDIATE_SHUTDOWN,
      pid: 99,
      responseCode: 0,
    })
    expect(serverControl.getKind()).to.equal(
      ProtoServerControlKind.IMMEDIATE_SHUTDOWN
    )
    expect(serverControl.getPid()).to.equal(99)
    expect(serverControl.getResponseCode()).to.equal(0)

    const heartbeat = new HeartbeatResponse({
      sessionCount: 2,
      timestamp: 3,
      uptime: 4,
      cpuCount: 8,
      cpuLoadAverage: 1.5,
      maxMemory: 10,
      committedMemory: 11,
      usedMemory: 12,
    })
    expect(heartbeat.getSessionCount()).to.equal(2)
    expect(heartbeat.getTimestamp()).to.equal(3)
    expect(heartbeat.getUptime()).to.equal(4)
    expect(heartbeat.getCpuCount()).to.equal(8)
    expect(heartbeat.getCpuLoadAverage()).to.equal(1.5)
    expect(heartbeat.getMaxMemory()).to.equal(10)
    expect(heartbeat.getCommittedMemory()).to.equal(11)
    expect(heartbeat.getUsedMemory()).to.equal(12)

    const viewportData = new ViewportDataResponse({
      viewportId: 'vid',
      offset: 5,
      length: 6,
      data: new Uint8Array([1, 2, 3]),
      followingByteCount: 7,
    })
    expect(viewportData.getViewportId()).to.equal('vid')
    expect(viewportData.getOffset()).to.equal(5)
    expect(viewportData.getLength()).to.equal(6)
    expect(Array.from(viewportData.getData_asU8())).to.deep.equal([1, 2, 3])
    expect(viewportData.getFollowingByteCount()).to.equal(7)

    const viewportDataWithoutBytes = new ViewportDataResponse({
      viewportId: 'vid',
      offset: 0,
      length: 0,
      data: new Uint8Array(),
      followingByteCount: 0,
    })
    expect(Array.from(viewportDataWithoutBytes.getData())).to.deep.equal([])

    const changeDetails = new ChangeDetailsResponse({
      sessionId: 'sid',
      serial: 10,
      kind: 1,
      offset: 3,
      length: 4,
      data: new Uint8Array([4, 5]),
    })
    expect(changeDetails.getSessionId()).to.equal('sid')
    expect(changeDetails.getSerial()).to.equal(10)
    expect(changeDetails.getKind()).to.equal(1)
    expect(changeDetails.getOffset()).to.equal(3)
    expect(changeDetails.getLength()).to.equal(4)
    expect(Array.from(changeDetails.getData())).to.deep.equal([4, 5])

    const bom = new ByteOrderMarkResponse({
      sessionId: 'sid',
      offset: 1,
      length: 3,
      byteOrderMark: 'utf-8',
    })
    expect(bom.getSessionId()).to.equal('sid')
    expect(bom.getOffset()).to.equal(1)
    expect(bom.getLength()).to.equal(3)
    expect(bom.getByteOrderMark()).to.equal('utf-8')
    expect(bom.getByteOrderMarkBytes()).to.equal(3)

    const contentType = new ContentTypeResponse({
      sessionId: 'sid',
      offset: 1,
      length: 2,
      contentType: 'text/plain',
    })
    expect(contentType.getContentType()).to.equal('text/plain')

    const language = new LanguageResponse({
      sessionId: 'sid',
      offset: 1,
      length: 2,
      language: 'english',
    })
    expect(language.getLanguage()).to.equal('english')

    const characterCount = new CharacterCountResponse({
      sessionId: 'sid',
      offset: 1,
      length: 2,
      byteOrderMark: 'none',
      byteOrderMarkBytes: 0,
      singleByteChars: 3,
      doubleByteChars: 4,
      tripleByteChars: 5,
      quadByteChars: 6,
      invalidBytes: 7,
    })
    expect(characterCount.getByteOrderMark()).to.equal('none')
    expect(characterCount.getByteOrderMarkBytes()).to.equal(0)
    expect(characterCount.getSingleByteChars()).to.equal(3)
    expect(characterCount.getDoubleByteChars()).to.equal(4)
    expect(characterCount.getTripleByteChars()).to.equal(5)
    expect(characterCount.getQuadByteChars()).to.equal(6)
    expect(characterCount.getInvalidBytes()).to.equal(7)

    const count = new SingleCount({
      kind: ProtoCountKind.VIEWPORTS,
      count: 12,
    })
    expect(count.getKind()).to.equal(ProtoCountKind.VIEWPORTS)
    expect(count.getCount()).to.equal(12)

    const sessionEvent = new SessionEvent({
      sessionId: 'sid',
      sessionEventKind: SessionEventKind.EDIT,
      computedFileSize: 20,
      changeCount: 2,
      undoCount: 1,
      serial: 8,
    })
    expect(sessionEvent.getSessionId()).to.equal('sid')
    expect(sessionEvent.getSessionEventKind()).to.equal(SessionEventKind.EDIT)
    expect(sessionEvent.getComputedFileSize()).to.equal(20)
    expect(sessionEvent.getChangeCount()).to.equal(2)
    expect(sessionEvent.getUndoCount()).to.equal(1)
    expect(sessionEvent.getSerial()).to.equal(8)

    const sessionEventWithoutSerial = new SessionEvent({
      sessionId: 'sid',
      sessionEventKind: SessionEventKind.CREATE,
      computedFileSize: 1,
      changeCount: 0,
      undoCount: 0,
    })
    expect(sessionEventWithoutSerial.getSerial()).to.equal(0)

    const viewportEvent = new ViewportEvent({
      sessionId: 'sid',
      viewportId: 'vid',
      viewportEventKind: ViewportEventKind.EDIT,
      serial: 1,
      offset: 2,
      length: 3,
      data: new Uint8Array([9]),
    })
    expect(viewportEvent.getSessionId()).to.equal('sid')
    expect(viewportEvent.getViewportId()).to.equal('vid')
    expect(viewportEvent.getViewportEventKind()).to.equal(
      ViewportEventKind.EDIT
    )
    expect(viewportEvent.getSerial()).to.equal(1)
    expect(viewportEvent.getOffset()).to.equal(2)
    expect(viewportEvent.getLength()).to.equal(3)
    expect(Array.from(viewportEvent.getData_asU8())).to.deep.equal([9])

    const viewportEventWithoutOptionalFields = new ViewportEvent({
      sessionId: 'sid',
      viewportId: 'vid',
      viewportEventKind: ViewportEventKind.CREATE,
    })
    expect(viewportEventWithoutOptionalFields.getSerial()).to.equal(0)
    expect(viewportEventWithoutOptionalFields.getOffset()).to.equal(0)
    expect(viewportEventWithoutOptionalFields.getLength()).to.equal(0)
    expect(
      Array.from(viewportEventWithoutOptionalFields.getData())
    ).to.deep.equal([])

    expect(
      wrapCreateSessionResponse(createSession.toObject()).getSessionId()
    ).to.equal('sid')
    expect(
      wrapSaveSessionResponse(saveSession.toObject()).getFilePath()
    ).to.equal('file.bin')
    expect(
      wrapServerInfoResponse(serverInfo.toObject()).getHostname()
    ).to.equal('host')
    expect(
      wrapServerControlResponse(serverControl.toObject()).getPid()
    ).to.equal(99)
    expect(
      wrapHeartbeatResponse(heartbeat.toObject()).getSessionCount()
    ).to.equal(2)
    expect(
      wrapViewportDataResponse(viewportData.toObject()).getFollowingByteCount()
    ).to.equal(7)
    expect(
      wrapChangeDetailsResponse(changeDetails.toObject()).getOffset()
    ).to.equal(3)
    expect(
      wrapByteOrderMarkResponse(bom.toObject()).getByteOrderMark()
    ).to.equal('utf-8')
    expect(
      wrapContentTypeResponse(contentType.toObject()).getContentType()
    ).to.equal('text/plain')
    expect(wrapLanguageResponse(language.toObject()).getLanguage()).to.equal(
      'english'
    )
    expect(
      wrapCharacterCountResponse(characterCount.toObject()).getInvalidBytes()
    ).to.equal(7)
    expect(wrapSingleCount(count.toObject()).getCount()).to.equal(12)
    expect(wrapSessionEvent(sessionEvent.toObject()).getChangeCount()).to.equal(
      2
    )
    expect(wrapViewportEvent(viewportEvent.toObject()).getLength()).to.equal(3)

    expect(CountKind.COUNT_VIEWPORTS).to.equal(ProtoCountKind.VIEWPORTS)
    expect(ServerControlKind.SERVER_CONTROL_GRACEFUL_SHUTDOWN).to.equal(
      ProtoServerControlKind.GRACEFUL_SHUTDOWN
    )
  })

  it('should wrap subscription data events for legacy EditorClient consumers', () => {
    const originalSessionSubscribe =
      EditorServiceClient.prototype.subscribeToSessionEvents
    const originalViewportSubscribe =
      EditorServiceClient.prototype.subscribeToViewportEvents

    const sessionStream = new FakeReadableStream<any>()
    const viewportStream = new FakeReadableStream<any>()

    ;(EditorServiceClient.prototype as any).subscribeToSessionEvents =
      function (request: unknown) {
        expect(request).to.deep.equal({
          id: 'session-id',
          interest: 3,
        })
        return sessionStream
      }
    ;(EditorServiceClient.prototype as any).subscribeToViewportEvents =
      function (request: unknown) {
        expect(request).to.deep.equal({
          id: 'viewport-id',
        })
        return viewportStream
      }

    try {
      const client = new EditorClient(
        '127.0.0.1:0',
        grpc.credentials.createInsecure()
      )

      let wrappedSessionEvent: SessionEvent | undefined
      client
        .subscribeToSessionEvents(
          new EventSubscriptionRequest().setId('session-id').setInterest(3)
        )
        .on('data', (event) => {
          wrappedSessionEvent = event
        })
      sessionStream.emit('data', {
        sessionId: 'session-id',
        sessionEventKind: SessionEventKind.EDIT,
        computedFileSize: 1,
        changeCount: 2,
        undoCount: 3,
        serial: 4,
      })
      expect(wrappedSessionEvent).to.be.instanceOf(SessionEvent)
      expect(wrappedSessionEvent?.getSerial()).to.equal(4)

      let wrappedViewportEvent: ViewportEvent | undefined
      client
        .subscribeToViewportEvents({
          getId() {
            return 'viewport-id'
          },
        })
        .on('data', (event) => {
          wrappedViewportEvent = event
        })
      viewportStream.emit('data', {
        sessionId: 'session-id',
        viewportId: 'viewport-id',
        viewportEventKind: ViewportEventKind.EDIT,
        serial: 5,
        offset: 6,
        length: 7,
        data: new Uint8Array([8]),
      })
      expect(wrappedViewportEvent).to.be.instanceOf(ViewportEvent)
      expect(wrappedViewportEvent?.getOffset()).to.equal(6)
    } finally {
      EditorServiceClient.prototype.subscribeToSessionEvents =
        originalSessionSubscribe
      EditorServiceClient.prototype.subscribeToViewportEvents =
        originalViewportSubscribe
    }
  })
})
