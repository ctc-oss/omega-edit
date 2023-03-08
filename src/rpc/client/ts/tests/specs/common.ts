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

import { expect } from 'chai'
import { getClient, waitForReady } from '../../src/client'
import {
  SessionEventKind,
  createSession,
  destroySession,
  getSessionCount,
} from '../../src/session'
import { ViewportEventKind } from '../../src/viewport'
import { EventSubscriptionRequest } from '../../src/omega_edit_pb'

export let session_callbacks = new Map()
export let viewport_callbacks = new Map()
export const testPort = parseInt(process.env.OMEGA_EDIT_TEST_PORT || '9010')

export async function createTestSession(port: number) {
  let session_id = ''
  expect(await waitForReady(getClient(port)))
  expect(await getSessionCount()).to.equal(0)
  const new_session_id = await createSession()
  expect(new_session_id).to.be.a('string').and.not.equal(session_id)

  // Generated IDs are 36 character UUIDs
  expect(new_session_id.length).to.equal(36)
  expect(await getSessionCount()).to.equal(1)
  return new_session_id
}

export async function destroyTestSession(session_id: string) {
  const session_count = await getSessionCount()
  expect(session_count).to.be.lessThanOrEqual(1)
  if (0 < session_count) {
    expect(await destroySession(session_id)).to.equal(session_id)
  }
}

export async function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function checkCallbackCount(
  callback_map: Map<string, number>,
  key: string,
  expected_count: number
) {
  // disable the check unless the OMEGA_EDIT_ENABLE_CLIENT_CALLBACK_COUNT_CHECKS
  // environment variable is defined and is non-zero
  const do_check: boolean = process.env
    .OMEGA_EDIT_ENABLE_CLIENT_CALLBACK_COUNT_CHECKS
    ? process.env.OMEGA_EDIT_ENABLE_CLIENT_CALLBACK_COUNT_CHECKS !== '0'
    : false
  if (!do_check) return
  log_info(callback_map)
  if (0 < expected_count) {
    expect(callback_map.has(key)).to.be.true
    const value = callback_map.get(key)
    log_info(
      'check_callback_count key: ' +
        key +
        ', value: ' +
        value +
        ', expected: ' +
        expected_count
    )
    expect(value).to.equal(expected_count)
  } else {
    expect(callback_map.has(key)).to.be.false
  }
}

export function log_info(message?: any, ...optionalParams: any[]) {
  const do_log: boolean = process.env.OMEGA_EDIT_ENABLE_INFO_LOGS
    ? process.env.OMEGA_EDIT_ENABLE_INFO_LOGS !== '0'
    : false
  if (do_log) {
    console.log(message, optionalParams)
  }
}

export function log_error(message?: any, ...optionalParams: any[]) {
  console.log(message, optionalParams)
}

export async function subscribeSession(
  session_id: string,
  interest?: number
): Promise<string> {
  let subscriptionRequest = new EventSubscriptionRequest().setId(session_id)
  if (interest !== undefined) subscriptionRequest.setInterest(interest)
  getClient()
    .subscribeToSessionEvents(subscriptionRequest)
    .on('data', (sessionEvent) => {
      session_callbacks.set(
        session_id,
        session_callbacks.has(session_id)
          ? 1 + session_callbacks.get(session_id)
          : 1
      )
      const event = sessionEvent.getSessionEventKind()
      if (SessionEventKind.SESSION_EVT_EDIT == event) {
        log_info(
          'session: ' +
            session_id +
            ', event: ' +
            sessionEvent.getSessionEventKind() +
            ', serial: ' +
            sessionEvent.getSerial() +
            ', count: ' +
            session_callbacks.get(session_id)
        )
      } else {
        log_info(
          'session: ' +
            session_id +
            ', event: ' +
            sessionEvent.getSessionEventKind() +
            ', count: ' +
            session_callbacks.get(session_id)
        )
      }
    })
    .on('error', (err) => {
      // Call cancelled thrown when server is shutdown
      if (!err.message.includes('Call cancelled')) {
        throw err
      }
    })

  return session_id
}

export async function subscribeViewport(
  viewport_id: string,
  interest?: number
): Promise<string> {
  let subscriptionRequest = new EventSubscriptionRequest().setId(viewport_id)
  if (interest) {
    subscriptionRequest.setInterest(interest)
  }
  getClient()
    .subscribeToViewportEvents(subscriptionRequest)
    .on('data', (viewportEvent) => {
      viewport_callbacks.set(
        viewport_id,
        viewport_callbacks.has(viewport_id)
          ? 1 + viewport_callbacks.get(viewport_id)
          : 1
      )
      const event = viewportEvent.getViewportEventKind()
      if (ViewportEventKind.VIEWPORT_EVT_EDIT == event) {
        log_info(
          'viewport_id: ' +
            viewport_id +
            ', event: ' +
            event +
            ', serial: ' +
            viewportEvent.getSerial() +
            ', offset: ' +
            viewportEvent.getOffset() +
            ', length: ' +
            viewportEvent.getLength() +
            ', data: "' +
            viewportEvent.getData() +
            '", callbacks: ' +
            viewport_callbacks.get(viewport_id)
        )
      } else {
        log_info(
          'viewport: ' +
            viewport_id +
            ', event: ' +
            event +
            ', count: ' +
            viewport_callbacks.get(viewport_id)
        )
      }
    })
    .on('error', (err) => {
      // Call cancelled thrown when server is shutdown
      if (!err.message.includes('Call cancelled')) {
        throw err
      }
    })

  return viewport_id
}
