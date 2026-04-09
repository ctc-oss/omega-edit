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

import {
  createViewport as rawCreateViewport,
  destroyViewport as rawDestroyViewport,
  getViewportCount as rawGetViewportCount,
  getViewportData as rawGetViewportData,
  modifyViewport as rawModifyViewport,
  pauseViewportEvents as rawPauseViewportEvents,
  resumeViewportEvents as rawResumeViewportEvents,
  unsubscribeViewport as rawUnsubscribeViewport,
  viewportHasChanges as rawViewportHasChanges,
} from './protobuf_ts/viewport'
import {
  wrapViewportDataResponse,
  type ViewportDataResponse,
} from './omega_edit_pb'
import { requireSafeIntegerInput, requireSafeIntegerOutput } from './safe_int'

export async function createViewport(
  desired_viewport_id: string | undefined,
  session_id: string,
  offset: number,
  capacity: number,
  is_floating: boolean = false
): Promise<ViewportDataResponse> {
  return wrapViewportDataResponse(
    await rawCreateViewport(
      desired_viewport_id,
      session_id,
      requireSafeIntegerInput('createViewport offset', offset),
      requireSafeIntegerInput('createViewport capacity', capacity),
      is_floating
    )
  )
}

export async function modifyViewport(
  viewport_id: string,
  offset: number,
  capacity: number,
  is_floating: boolean = false
): Promise<ViewportDataResponse> {
  return wrapViewportDataResponse(
    await rawModifyViewport(
      viewport_id,
      requireSafeIntegerInput('modifyViewport offset', offset),
      requireSafeIntegerInput('modifyViewport capacity', capacity),
      is_floating
    )
  )
}

export function destroyViewport(viewport_id: string): Promise<string> {
  return rawDestroyViewport(viewport_id)
}

export function getViewportCount(session_id: string): Promise<number> {
  return rawGetViewportCount(session_id).then((count) =>
    requireSafeIntegerOutput('viewport count', count)
  )
}

export async function getViewportData(
  viewport_id: string
): Promise<ViewportDataResponse> {
  return wrapViewportDataResponse(await rawGetViewportData(viewport_id))
}

export function viewportHasChanges(viewport_id: string): Promise<boolean> {
  return rawViewportHasChanges(viewport_id)
}

export function pauseViewportEvents(session_id: string): Promise<string> {
  return rawPauseViewportEvents(session_id)
}

export function resumeViewportEvents(session_id: string): Promise<string> {
  return rawResumeViewportEvents(session_id)
}

export function unsubscribeViewport(viewport_id: string): Promise<string> {
  return rawUnsubscribeViewport(viewport_id)
}
