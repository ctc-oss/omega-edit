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

declare module 'omega-edit/viewport' {
  export function createViewport(
    desired_viewport_id: string | undefined,
    session_id: string,
    offset: number,
    capacity: number
  ): Promise<string>
  export function destroyViewport(id: string): Promise<string>
  export function getViewportCount(sesssion_id: string): Promise<number>
  export function getViewportData(viewport_id: string): Promise<Uint8Array>
}
