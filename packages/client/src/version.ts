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

import { getLogger } from './logger'
import { OMEGA_EDIT_CLIENT_VERSION } from './client_version'

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
