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

import {client} from './settings'
import {
    CreateSessionRequest,
    ObjectId,
    SaveSessionRequest,
    SegmentRequest,
} from '../../omega_edit_pb'

export function createSession(path: string | undefined, sessionIdDesired: string | undefined): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        let request = new CreateSessionRequest()
        if (sessionIdDesired && sessionIdDesired.length) request.setSessionIdDesired(sessionIdDesired)
        if (path && path.length) request.setFilePath(path)
        client.createSession(request, (err, r) => {
            if (err) {
                console.log(err.message)
                return reject('createSession error: ' + err.message)
            }

            return resolve(r.getSessionId())
        })
    })
}

export function destroySession(id: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        client.destroySession(new ObjectId().setId(id), (err, r) => {
            if (err) {
                console.log(err.message)
                return reject('deleteSession error: ' + err.message)
            }

            return resolve(r.getId())
        })
    })
}

export function saveSession(sessionId: string, filePath: string, overwrite: boolean): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        let saveSessionReq = new SaveSessionRequest()
        saveSessionReq.setSessionId(sessionId)
        saveSessionReq.setFilePath(filePath)
        saveSessionReq.setAllowOverwrite(overwrite)

        client.saveSession(saveSessionReq, (err, r) => {
            if (err) {
                console.log(err.message)
                return reject('saveSession error: ' + err.message)
            }

            return resolve(r.getFilePath())
        })
    })
}

export function  getComputedFileSize(sessionId: string): Promise<number> {
    return new Promise<number>((resolve, reject) => {
        let request = new ObjectId()
        request.setId(sessionId)
        client.getComputedFileSize(request, (err, r) => {
            if (err) {
                console.log(err.message)
                return reject('getComputedFileSize error: ' + err.message)
            }

            return resolve(r.getComputedFileSize())
        })
    })
}

export function getSegment(sessionId: string, offset: number, len: number): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
        let request = new SegmentRequest()
        request.setSessionId(sessionId)
        request.setOffset(offset)
        request.setLength(len)

        client.getSegment(request, (err, r) => {
            if (err) {
                console.log(err.message)
                return reject('getSegment error: ' + err.message)
            }

            return resolve(r.getData_asU8())
        })
    })
}
