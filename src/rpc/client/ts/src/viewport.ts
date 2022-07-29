/*
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
  CountKind,
  CountRequest,
  CreateViewportRequest,
  ObjectId,
  ViewportDataRequest,
  ViewportDataResponse,
} from './omega_edit_pb'
import { ALL_EVENTS, getClient } from './settings'
const client = getClient()

export function createViewport(
  desired_viewport_id: string | undefined,
  session_id: string,
  offset: number,
  capacity: number,
  is_floating: boolean
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let request = new CreateViewportRequest()
    if (desired_viewport_id) request.setViewportIdDesired(desired_viewport_id)
    request.setSessionId(session_id)
    request.setOffset(offset)
    request.setCapacity(capacity)
    request.setIsFloating(is_floating)
    request.setEventInterest(ALL_EVENTS)
    client.createViewport(request, (err, r) => {
      if (err) {
        console.log(err.message)
        return reject('createViewport error: ' + err.message)
      }
      return resolve(r.getViewportId())
    })
  })
}

export function destroyViewport(id: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    client.destroyViewport(new ObjectId().setId(id), (err, r) => {
      if (err) {
        return reject('deleteViewport error: ' + err.message)
      }
      return resolve(r.getId())
    })
  })
}

export function getViewportCount(sesssion_id: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    client.getCount(
      new CountRequest()
        .setSessionId(sesssion_id)
        .setKind(CountKind.COUNT_VIEWPORTS),
      (err, r) => {
        if (err) {
          console.log(err.message)
          return reject('redo error: ' + err.message)
        }
        return resolve(r.getCount())
      }
    )
  })
}

export function getViewportData(
  viewport_id: string
): Promise<ViewportDataResponse> {
  return new Promise<ViewportDataResponse>((resolve, reject) => {
    client.getViewportData(
      new ViewportDataRequest().setViewportId(viewport_id),
      (err, r) => {
        if (err) {
          console.log(err.message)
          return reject('redo error: ' + err.message)
        }
        return resolve(r)
      }
    )
  })
}
