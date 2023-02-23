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

// set up logging, declared using let (instead of const) to allow for
// reassignment in tests and in the application layer
export let logger = buildLogger([
  {
    target: 'pino/file',
    options: { destination: 2 }, // use 1 for stdout and 2 for stderr
  },
])

/**
 * Builds a logger
 * @param transports array of transports to log to
 * @param level log level
 */
export function buildLogger(
  transports: any[],
  level = process.env.OMEGA_EDIT_CLIENT_LOG_LEVEL || 'info'
): any {
  return require('pino')({ level: level, transports: transports })
}
