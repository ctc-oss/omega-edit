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

declare module 'omega-edit/session' {
  export function createSession(
    path: string | undefined,
    sessionIdDesired: string | undefined
  ): Promise<string>

  export function destroySession(id: string): Promise<string>

  export function saveSession(
    sessionId: string,
    filePath: string,
    overwrite: boolean
  ): Promise<string>

  export function getComputedFileSize(sessionId: string): Promise<number>

  export function pauseSessionChanges(sessionId: string): Promise<string>

  export function resumeSessionChanges(sessionId: string): Promise<string>

  export function getSegment(
    sessionId: string,
    offset: number,
    len: number
  ): Promise<Uint8Array>

  export function getSessionCount(): Promise<number>

  export function searchSession(
    sessionId: string,
    pattern: string | Uint8Array,
    isCaseInsensitive: boolean,
    offset: number,
    length: number,
    limit: number | undefined
  ): Promise<number[]>
}
