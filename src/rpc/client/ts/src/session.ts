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
  ByteFrequencyProfileRequest,
  CreateSessionRequest,
  ObjectId,
  SaveSessionRequest,
  SearchRequest,
  SegmentRequest,
} from './omega_edit_pb'
import { Empty } from 'google-protobuf/google/protobuf/empty_pb'
import { getClient } from './settings'
const client = getClient()

export function createSession(
  path: string | undefined,
  session_id_desired: string | undefined
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let request = new CreateSessionRequest()
    if (session_id_desired !== undefined && session_id_desired.length > 0)
      request.setSessionIdDesired(session_id_desired)
    if (path !== undefined && path.length > 0) request.setFilePath(path)
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
  session_id: string,
  file_path: string,
  overwrite: boolean
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    client.saveSession(
      new SaveSessionRequest()
        .setSessionId(session_id)
        .setFilePath(file_path)
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

export function getComputedFileSize(session_id: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    client.getComputedFileSize(new ObjectId().setId(session_id), (err, r) => {
      if (err) {
        console.log(err.message)
        return reject('getComputedFileSize error: ' + err.message)
      }
      return resolve(r.getComputedFileSize())
    })
  })
}

export function pauseSessionChanges(session_id: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    client.pauseSessionChanges(new ObjectId().setId(session_id), (err, r) => {
      if (err) {
        console.log(err.message)
        return reject('pauseSessionChanges error: ' + err.message)
      }
      return resolve(r.getId())
    })
  })
}

export function resumeSessionChanges(session_id: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    client.resumeSessionChanges(new ObjectId().setId(session_id), (err, r) => {
      if (err) {
        console.log(err.message)
        return reject('resumeSessionChanges error: ' + err.message)
      }
      return resolve(r.getId())
    })
  })
}

export function unsubscribeSession(session_id: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    client.unsubscribeToSessionEvents(
      new ObjectId().setId(session_id),
      (err, r) => {
        if (err) {
          console.log(err.message)
          return reject('unsubscribeSession error: ' + err.message)
        }
        return resolve(r.getId())
      }
    )
  })
}

export function getSegment(
  session_id: string,
  offset: number,
  length: number
): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    client.getSegment(
      new SegmentRequest()
        .setSessionId(session_id)
        .setOffset(offset)
        .setLength(length),
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

export function profileSession(
  session_id: string,
  offset: number | undefined,
  length: number | undefined
): Promise<number[]> {
  return new Promise<number[]>((resolve, reject) => {
    let request = new ByteFrequencyProfileRequest().setSessionId(session_id)
    if (offset !== undefined && offset >= 0) request.setOffset(offset)
    if (length !== undefined && length > 0) request.setLength(length)
    client.getByteFrequencyProfile(request, (err, r) => {
      if (err) {
        console.log(err.message)
        return reject('searchSession error: ' + err.message)
      }
      return resolve(r.getFrequencyList())
    })
  })
}

// Given a computed profile, return the total number of bytes in the 7-bit ASCII range
export function numAscii(profile: number[]): number {
  return profile.slice(0, 128).reduce((accumulator, current) => {
    return accumulator + current
  }, 0)
}

export function searchSession(
  session_id: string,
  pattern: string | Uint8Array,
  is_case_insensitive: boolean | undefined,
  offset: number | undefined,
  length: number | undefined,
  limit: number | undefined
): Promise<number[]> {
  return new Promise<number[]>((resolve, reject) => {
    let request = new SearchRequest()
      .setSessionId(session_id)
      .setPattern(typeof pattern == 'string' ? Buffer.from(pattern) : pattern)
      .setIsCaseInsensitive(is_case_insensitive ?? false)
    if (offset !== undefined && offset >= 0) request.setOffset(offset)
    if (length !== undefined && length > 0) request.setLength(length)
    if (limit !== undefined && limit > 0) request.setLimit(limit)
    client.searchSession(request, (err, r) => {
      if (err) {
        console.log(err.message)
        return reject('searchSession error: ' + err.message)
      }
      return resolve(r.getMatchOffsetList())
    })
  })
}
