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

import { ChangeDetailsResponse } from './omega_edit_pb'

declare module 'omega-edit/change' {
  export const insert: (
    session_id: string,
    offset: number,
    data: string | Uint8Array
  ) => Promise<number>

  export const del: (
    session_id: string,
    offset: number,
    data: string,
    len: number
  ) => Promise<number>

  export const overwrite: (
    session_id: string,
    offset: number,
    data: string | Uint8Array
  ) => Promise<number>

  export const undo: (session_id: string) => Promise<number>

  export const redo: (session_id: string) => Promise<number>

  export const clear: (session_id: string) => Promise<string>

  export const getLastChange: (
    session_id: string
  ) => Promise<ChangeDetailsResponse>

  export const getLastUndo: (
    session_id: string
  ) => Promise<ChangeDetailsResponse>

  export const getChangeCount: (session_id: string) => Promise<number>

  export const getUndoCount: (session_id: string) => Promise<number>
}
