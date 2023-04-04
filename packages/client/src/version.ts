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

import { Empty } from 'google-protobuf/google/protobuf/empty_pb'
import { getClient } from './client'
import { getLogger } from './logger'
import { OMEGA_EDIT_CLIENT_VERSION } from './client_version'
import { VersionResponse } from './omega_edit_pb'

// Discover the client version both installed and in the repository source tree
export const ClientVersion: string = OMEGA_EDIT_CLIENT_VERSION

/**
 * Gets the string version of the client
 * @return string version of the client
 */
export function getClientVersion(): string {
  getLogger().debug({ fn: 'getClientVersion', resp: ClientVersion })
  return ClientVersion
}

/**
 * Gets the string version of the running server
 * @return string version of the running server
 */
export function getServerVersion(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    getLogger().debug({ fn: 'getVersion' })
    getClient().getVersion(new Empty(), (err, v: VersionResponse) => {
      if (err) {
        getLogger().error({
          fn: 'getServerVersion',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject('getServerVersion error: ' + err.message)
      }

      if (!v) {
        getLogger().error({
          fn: 'getServerVersion',
          err: { msg: 'undefined version' },
        })
        return reject('undefined version')
      }
      getLogger().debug({ fn: 'getServerVersion', resp: v.toObject() })
      return resolve(`${v.getMajor()}.${v.getMinor()}.${v.getPatch()}`)
    })
  })
}
