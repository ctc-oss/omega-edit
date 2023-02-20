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
import { getClient, logger } from './client'
export const ClientVersion = require('../package.json').version

/**
 * Gets the string version of the server editor library
 * @return string version of the server editor library
 */
export function getVersion(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    logger.debug({ fn: 'getVersion' })
    getClient().getVersion(new Empty(), (err, v) => {
      if (err) {
        logger.error({
          fn: 'getVersion',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject('getVersion error: ' + err.message)
      }

      if (!v) {
        logger.error({
          fn: 'getVersion',
          err: { msg: 'undefined version' },
        })
        return reject('undefined version')
      }
      logger.debug({ fn: 'getVersion', resp: v.toObject() })
      return resolve(`${v.getMajor()}.${v.getMinor()}.${v.getPatch()}`)
    })
  })
}
