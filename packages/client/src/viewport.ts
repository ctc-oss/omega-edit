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
  BooleanResponse,
  CountKind,
  CountRequest,
  CountResponse,
  CreateViewportRequest,
  ModifyViewportRequest,
  ObjectId,
  ViewportDataRequest,
  ViewportDataResponse,
} from './omega_edit_pb'
import { getLogger } from './logger'
import { getClient } from './client'

let autoFixViewportDataLength_ = false

/**
 * Set whether to automatically fix viewport data length
 * @param shouldAutoFix true if the client should automatically fix viewport data length, false otherwise
 */
export function setAutoFixViewportDataLength(shouldAutoFix: boolean): void {
  getLogger().debug({
    fn: 'setAutoFixViewportDataLength',
    shouldAutoFix: shouldAutoFix,
  })
  autoFixViewportDataLength_ = shouldAutoFix
}

/**
 * Create a new viewport in a session
 * @param desired_viewport_id if defined, the viewport ID to assign to this viewport, if undefined a unique viewport ID
 * will be generated by the server
 * @param session_id session to create the viewport in
 * @param offset byte-offset start of the viewport
 * @param capacity capacity of the viewport in bytes
 * @param is_floating false if the viewport is to remain fixed at the given offset, true if the viewport is expected to
 * "float" as bytes are inserted or deleted before the start of this viewport
 * @return created viewport's ID, on success
 */
export function createViewport(
  desired_viewport_id: string | undefined,
  session_id: string,
  offset: number,
  capacity: number,
  is_floating: boolean = false
): Promise<ViewportDataResponse> {
  return new Promise<ViewportDataResponse>((resolve, reject) => {
    let request = new CreateViewportRequest()
      .setSessionId(session_id)
      .setOffset(offset)
      .setCapacity(capacity)
      .setIsFloating(is_floating)
    if (desired_viewport_id !== undefined && desired_viewport_id.length > 0) {
      request.setViewportIdDesired(desired_viewport_id)
    }
    getLogger().debug({ fn: 'createViewport', rqst: request.toObject() })
    getClient().createViewport(request, (err, r: ViewportDataResponse) => {
      if (err) {
        getLogger().error({
          fn: 'createViewport',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(`createViewport error: ${err.message}`)
      }
      getLogger().debug({ fn: 'createViewport', resp: r.toObject() })
      return resolve(r)
    })
  })
}

/**
 * Modify a given viewport
 * @param viewport_id viewport to modify
 * @param offset new byte-offset start of the viewport
 * @param capacity new capacity of the viewport in bytes
 * @param is_floating false if the viewport is to remain fixed at the given offset, true if the viewport is expected to
 * "float" as bytes are inserted or deleted before the start of this viewport
 * @return ViewportDataResponse, on success
 */
export function modifyViewport(
  viewport_id: string,
  offset: number,
  capacity: number,
  is_floating: boolean = false
): Promise<ViewportDataResponse> {
  return new Promise<ViewportDataResponse>((resolve, reject) => {
    const request = new ModifyViewportRequest()
      .setViewportId(viewport_id)
      .setOffset(offset)
      .setCapacity(capacity)
      .setIsFloating(is_floating)
    getLogger().debug({ fn: 'modifyViewport', rqst: request.toObject() })
    getClient().modifyViewport(request, (err, r: ViewportDataResponse) => {
      if (err) {
        getLogger().error({
          fn: 'modifyViewport',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(`modifyViewport error: ${err.message}`)
      }
      getLogger().debug({ fn: 'modifyViewport', resp: r.toObject() })
      return resolve(r)
    })
  })
}

/**
 * Destroy a given viewport
 * @param viewport_id viewport to destroy
 * @return destroyed viewport's ID, on success
 */
export function destroyViewport(viewport_id: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const request = new ObjectId().setId(viewport_id)
    getLogger().debug({ fn: 'destroyViewport', rqst: request.toObject() })
    getClient().destroyViewport(request, (err, r) => {
      if (err) {
        getLogger().error({
          fn: 'destroyViewport',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(`destroyViewport error: ${err.message}`)
      }
      getLogger().debug({ fn: 'destroyViewport', resp: r.toObject() })
      return resolve(r.getId())
    })
  })
}

/**
 * Given a session, return the number of viewports in that session
 * @param sesssion_id session to get the number of viewports in
 * @return number of viewports in the given session, on success
 */
export function getViewportCount(sesssion_id: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const request = new CountRequest()
      .setSessionId(sesssion_id)
      .setKindList([CountKind.COUNT_VIEWPORTS])
    getLogger().debug({ fn: 'getViewportCount', rqst: request.toObject() })
    getClient().getCount(request, (err, r: CountResponse) => {
      if (err) {
        getLogger().error({
          fn: 'getViewportCount',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(`getViewportCount error: ${err.message}`)
      }
      getLogger().debug({ fn: 'getViewportCount', resp: r.toObject() })
      return resolve(r.getCountsList()[0].getCount())
    })
  })
}

/**
 * Given a viewport ID, return the data in the viewport
 * @param viewport_id viewport to get the data from
 * @return ViewportDataResponse with the data and where it is in the session, on success
 * @remarks viewport length can be less than the viewport capacity
 */
export function getViewportData(
  viewport_id: string
): Promise<ViewportDataResponse> {
  return new Promise<ViewportDataResponse>((resolve, reject) => {
    const request = new ViewportDataRequest().setViewportId(viewport_id)
    getLogger().debug({ fn: 'getViewportData', rqst: request.toObject() })
    getClient().getViewportData(request, (err, r: ViewportDataResponse) => {
      if (err) {
        getLogger().error({
          fn: 'getViewportData',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(`getViewportData error: ${err.message}`)
      }

      getLogger().debug({ fn: 'getViewportData', resp: r.toObject() })

      // TODO: remove this once the server issue is discovered and fixed
      if (autoFixViewportDataLength_) {
        const dataLength = r.getData().length
        const expectedLength = r.getLength()
        if (dataLength !== expectedLength) {
          if (dataLength > expectedLength) {
            getLogger().error({
              fn: 'getViewportData',
              err: {
                msg: `AUTO FIX: truncating data length to ${expectedLength}`,
              },
            })
            r.setData(r.getData().slice(0, expectedLength))
          } else {
            const errorMsg = 'data has unexpected length'
            getLogger().error({
              fn: 'getViewportData',
              err: {
                msg: errorMsg,
                datalength: dataLength,
                length: expectedLength,
              },
            })
            return reject(errorMsg)
          }
        }
      }

      return resolve(r)
    })
  })
}

/**
 * Given a viewport ID, returns true if the viewport has changes and false otherwise
 * @param viewport_id viewport to check for changes
 * @return true if the viewport has changes and false otherwise
 */
export function viewportHasChanges(viewport_id: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const request = new ObjectId().setId(viewport_id)
    getLogger().debug({ fn: 'viewportHasChanges', rqst: request.toObject() })
    getClient().viewportHasChanges(request, (err, r: BooleanResponse) => {
      if (err) {
        getLogger().error({
          fn: 'viewportHasChanges',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(`viewportHasChanges error: ${err.message}`)
      }
      getLogger().debug({ fn: 'viewportHasChanges', resp: r.toObject() })
      return resolve(r.getResponse())
    })
  })
}

/**
 * Pause viewport events being triggered on this session
 * @param session_id session to pause viewport events on
 * @return session ID that has had its viewport events paused, on success
 */
export function pauseViewportEvents(session_id: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const request = new ObjectId().setId(session_id)
    getLogger().debug({ fn: 'pauseViewportEvents', rqst: request.toObject() })
    getClient().pauseViewportEvents(request, (err, r: ObjectId) => {
      if (err) {
        getLogger().error({
          fn: 'pauseViewportEvents',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(`pauseViewportEvents error: ${err.message}`)
      }
      getLogger().debug({ fn: 'pauseViewportEvents', resp: r.toObject() })
      return resolve(r.getId())
    })
  })
}

/**
 * Resume events on viewports in the given session
 * @param session_id to resume viewport events on
 * @return session ID that has had its viewport events resumed, on success
 */
export function resumeViewportEvents(session_id: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const request = new ObjectId().setId(session_id)
    getLogger().debug({ fn: 'resumeViewportEvents', rqst: request.toObject() })
    getClient().resumeViewportEvents(request, (err, r: ObjectId) => {
      if (err) {
        getLogger().error({
          fn: 'resumeViewportEvents',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(`resumeViewportEvents error: ${err.message}`)
      }
      getLogger().debug({ fn: 'resumeViewportEvents', resp: r.toObject() })
      return resolve(r.getId())
    })
  })
}

/**
 * Unsubscribe from events for the given viewport
 * @param viewport_id viewport to unsubscribe from events
 * @return viewport ID that has been unsubscribed from events, on success
 */
export function unsubscribeViewport(viewport_id: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const request = new ObjectId().setId(viewport_id)
    getLogger().debug({ fn: 'unsubscribeViewport', rqst: request.toObject() })
    getClient()
      .unsubscribeToViewportEvents(request, (err, r: ObjectId) => {
        if (err) {
          getLogger().error({
            fn: 'unsubscribeViewport',
            err: {
              msg: err.message,
              details: err.details,
              code: err.code,
              stack: err.stack,
            },
          })
          return reject(`unsubscribeViewport error: ${err.message}`)
        }
        getLogger().debug({ fn: 'unsubscribeViewport', resp: r.toObject() })
        return resolve(r.getId())
      })
      .on('error', (err) => {
        // Call cancelled thrown when server is shutdown
        if (!err.message.includes('Call cancelled')) {
          throw err
        }
      })
  })
}