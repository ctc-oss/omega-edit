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
import { getClient, waitForReady } from '../../src/settings'
import {
  createSession,
  destroySession,
  getSessionCount,
} from '../../src/session'

export const deadline = new Date()
deadline.setSeconds(deadline.getSeconds() + 10)

export async function custom_setup() {
  let session_id = ''
  expect(await waitForReady(getClient(), deadline))
  expect(await getSessionCount()).to.equal(0)
  const new_session_id = await createSession(undefined, undefined)
  expect(new_session_id).to.be.a('string').and.not.equal(session_id)

  // C++ RPC server uses 36 character UUIDs and the Scala server uses 8 character IDs
  expect(new_session_id.length).to.satisfy((l) => l === 36 || l === 8)
  expect(await getSessionCount()).to.equal(1)
  return new_session_id
}

export async function cleanup(session_id: string) {
  const session_count = await getSessionCount()
  expect(session_count).to.be.lessThanOrEqual(1)
  if (0 < session_count) {
    expect(await destroySession(session_id)).to.equal(session_id)
  }
}

export async function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function check_callback_count(
  callback_map: Map<string, number>,
  key: string,
  expected_count: number,
  millisecond_delay?: number
) {
  // disable the check unless the OMEGA_EDIT_ENABLE_CLIENT_CALLBACK_COUNT_CHECKS
  // environment variable is defined and is non-zero
  const do_check: boolean = process.env
    .OMEGA_EDIT_ENABLE_CLIENT_CALLBACK_COUNT_CHECKS
    ? process.env.OMEGA_EDIT_ENABLE_CLIENT_CALLBACK_COUNT_CHECKS !== '0'
    : false
  if (!do_check) return
  if (millisecond_delay !== undefined && millisecond_delay > 0) {
    await delay(millisecond_delay)
  }
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
