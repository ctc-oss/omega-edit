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

import { client } from './settings'
import {
  CreateSessionRequest,
  ObjectId,
  SaveSessionRequest,
  SearchRequest,
  SegmentRequest,
} from './omega_edit_pb'
import { Empty } from 'google-protobuf/google/protobuf/empty_pb'
import { TextEncoder } from 'node:util'

export function createSession(
  path: string | undefined,
  sessionIdDesired: string | undefined
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let request = new CreateSessionRequest()
    if (sessionIdDesired && sessionIdDesired.length)
      request.setSessionIdDesired(sessionIdDesired)
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
        return reject('destroySession error: ' + err.message)
      }
      return resolve(r.getId())
    })
  })
}

export function saveSession(
  sessionId: string,
  filePath: string,
  overwrite: boolean
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    client.saveSession(
      new SaveSessionRequest()
        .setSessionId(sessionId)
        .setFilePath(filePath)
        .setAllowOverwrite(overwrite),
      (err, r) => {
        if (err) {
          console.log(err.message)
          return reject('saveSession error: ' + err.message)
        }
        return resolve(r.getFilePath())
      }
    )
  })
}

export function getComputedFileSize(sessionId: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    client.getComputedFileSize(new ObjectId().setId(sessionId), (err, r) => {
      if (err) {
        console.log(err.message)
        return reject('getComputedFileSize error: ' + err.message)
      }
      return resolve(r.getComputedFileSize())
    })
  })
}

export function getSegment(
  sessionId: string,
  offset: number,
  len: number
): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    client.getSegment(
      new SegmentRequest()
        .setSessionId(sessionId)
        .setOffset(offset)
        .setLength(len),
      (err, r) => {
        if (err) {
          console.log(err.message)
          return reject('getSegment error: ' + err.message)
        }
        return resolve(r.getData_asU8())
      }
    )
  })
}

export function getSessionCount(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    client.getSessionCount(new Empty(), (err, r) => {
      if (err) {
        console.log(err.message)
        return reject('getSessionCount error: ' + err.message)
      }
      return resolve(r.getCount())
    })
  })
}

export function searchSession(
  sessionId: string,
  pattern: string | Uint8Array,
  isCaseInsensitive: boolean,
  offset: number,
  length: number,
  limit: number | undefined
): Promise<number[]> {
  return new Promise<number[]>((resolve, reject) => {
    let request = new SearchRequest()
      .setSessionId(sessionId)
      .setPattern(
        typeof pattern == 'string' ? new TextEncoder().encode(pattern) : pattern
      )
      .setIsCaseInsensitive(isCaseInsensitive)
      .setOffset(offset)
      .setLength(length)
    if (limit && limit > 0) request.setLimit(limit)
    client.searchSession(request, (err, r) => {
      if (err) {
        console.log(err.message)
        return reject('searchSession error: ' + err.message)
      }
      return resolve(r.getMatchOffsetList())
    })
  })
}
