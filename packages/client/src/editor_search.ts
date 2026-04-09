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

import { type EditorCheckpointReplaceAllTransaction } from './editor_history'
import {
  replaceSession as defaultReplaceSession,
  replaceSessionCheckpointed as defaultReplaceSessionCheckpointed,
  searchSession as defaultSearchSession,
} from './session'

export type EditorSearchMode = 'bounded' | 'large'

export interface EditorSearchResults {
  mode: EditorSearchMode
  matches: number[]
  currentOffset: number
  firstOffset: number
  patternLength: number
  windowLimit: number
}

export interface EditorSearchRequest {
  query: string
  isHex: boolean
  caseInsensitive?: boolean
  isReverse?: boolean
}

export interface EditorFindAdjacentRequest extends EditorSearchRequest {
  direction: 'forward' | 'backward'
  anchorOffset: number
  fileSize: number
}

export interface EditorFindAdjacentResult {
  offset: number
  patternLength: number
}

export interface EditorReplaceAllRequest extends EditorSearchRequest {
  length: number
  replacement: Uint8Array
  replacementData?: string
}

export interface EditorReplaceAllResult {
  strategy: 'bounded' | 'checkpointed'
  replacedCount: number
  selectionOffset: number
  orderedOffsets: number[]
  checkpointTransaction?: EditorCheckpointReplaceAllTransaction
}

interface EditorSearchControllerOptions {
  windowLimit?: number
  searchSession?: typeof defaultSearchSession
  replaceSession?: typeof defaultReplaceSession
  replaceSessionCheckpointed?: typeof defaultReplaceSessionCheckpointed
}

interface ActiveSearchState {
  query: string
  isHex: boolean
  caseInsensitive: boolean
  patternLength: number
  mode: EditorSearchMode
}

function toPatternBytes(query: string, isHex: boolean): Uint8Array {
  return isHex ? Buffer.from(query, 'hex') : Buffer.from(query, 'utf8')
}

export class EditorSearchController {
  private readonly windowLimit: number
  private readonly searchSession: typeof defaultSearchSession
  private readonly replaceSession: typeof defaultReplaceSession
  private readonly replaceSessionCheckpointed: typeof defaultReplaceSessionCheckpointed
  private preserveDepth = 0
  private activeSearch: ActiveSearchState | undefined

  constructor(
    private readonly sessionId: string,
    options: EditorSearchControllerOptions = {}
  ) {
    this.windowLimit = options.windowLimit ?? 1000
    this.searchSession = options.searchSession ?? defaultSearchSession
    this.replaceSession = options.replaceSession ?? defaultReplaceSession
    this.replaceSessionCheckpointed =
      options.replaceSessionCheckpointed ?? defaultReplaceSessionCheckpointed
  }

  public clear(): boolean {
    const hadSearch = this.activeSearch !== undefined
    this.activeSearch = undefined
    return hadSearch
  }

  public shouldClearAfterExternalEdit(): boolean {
    return this.preserveDepth === 0 && this.activeSearch !== undefined
  }

  public async preserveState<T>(work: () => Promise<T>): Promise<T> {
    this.preserveDepth += 1
    try {
      return await work()
    } finally {
      this.preserveDepth -= 1
    }
  }

  public async search(
    request: EditorSearchRequest
  ): Promise<EditorSearchResults> {
    const normalizedQuery = request.query.trim()
    const pattern = toPatternBytes(normalizedQuery, request.isHex)
    const caseInsensitive = request.caseInsensitive ?? false
    const isReverse = request.isReverse ?? false

    if (!normalizedQuery || pattern.length === 0) {
      this.activeSearch = undefined
      return {
        mode: 'bounded',
        matches: [],
        currentOffset: -1,
        firstOffset: -1,
        patternLength: 0,
        windowLimit: this.windowLimit,
      }
    }

    const matches = await this.searchSession(
      this.sessionId,
      pattern,
      caseInsensitive,
      isReverse,
      0,
      0,
      this.windowLimit + 1
    )
    const mode: EditorSearchMode =
      matches.length > this.windowLimit ? 'large' : 'bounded'
    const firstOffset = matches[0] ?? -1

    this.activeSearch = {
      query: normalizedQuery,
      isHex: request.isHex,
      caseInsensitive,
      patternLength: pattern.length,
      mode,
    }

    return {
      mode,
      matches: mode === 'large' ? [] : matches,
      currentOffset: mode === 'large' ? firstOffset : -1,
      firstOffset,
      patternLength: pattern.length,
      windowLimit: this.windowLimit,
    }
  }

  public async findAdjacent(
    request: EditorFindAdjacentRequest
  ): Promise<EditorFindAdjacentResult> {
    const normalizedQuery = request.query.trim()
    const pattern = toPatternBytes(normalizedQuery, request.isHex)
    if (!normalizedQuery || pattern.length === 0 || request.fileSize <= 0) {
      return { offset: -1, patternLength: pattern.length }
    }

    const clampedAnchor =
      Number.isSafeInteger(request.anchorOffset) && request.anchorOffset >= 0
        ? Math.min(request.anchorOffset, Math.max(0, request.fileSize - 1))
        : -1

    if (request.direction === 'forward') {
      if (clampedAnchor >= 0 && clampedAnchor + 1 < request.fileSize) {
        const matches = await this.searchSession(
          this.sessionId,
          pattern,
          request.caseInsensitive ?? false,
          false,
          clampedAnchor + 1,
          0,
          1
        )
        if (matches.length > 0) {
          return { offset: matches[0], patternLength: pattern.length }
        }
      }

      const wrappedMatches = await this.searchSession(
        this.sessionId,
        pattern,
        request.caseInsensitive ?? false,
        false,
        0,
        clampedAnchor > 0 ? clampedAnchor : 0,
        1
      )
      return {
        offset: wrappedMatches[0] ?? -1,
        patternLength: pattern.length,
      }
    }

    if (clampedAnchor > 0) {
      const matches = await this.searchSession(
        this.sessionId,
        pattern,
        request.caseInsensitive ?? false,
        true,
        0,
        clampedAnchor,
        1
      )
      if (matches.length > 0) {
        return { offset: matches[0], patternLength: pattern.length }
      }
    }

    const wrappedMatches = await this.searchSession(
      this.sessionId,
      pattern,
      request.caseInsensitive ?? false,
      true,
      clampedAnchor >= 0 ? clampedAnchor + 1 : 0,
      0,
      1
    )
    return {
      offset: wrappedMatches[0] ?? -1,
      patternLength: pattern.length,
    }
  }

  public async replaceAll(
    request: EditorReplaceAllRequest
  ): Promise<EditorReplaceAllResult> {
    const normalizedQuery = request.query.trim()
    const pattern = toPatternBytes(normalizedQuery, request.isHex)
    if (!normalizedQuery || pattern.length === 0) {
      return {
        strategy: 'bounded',
        replacedCount: 0,
        selectionOffset: -1,
        orderedOffsets: [],
      }
    }

    const searchProbe = await this.searchSession(
      this.sessionId,
      pattern,
      request.caseInsensitive ?? false,
      request.isReverse ?? false,
      0,
      0,
      this.windowLimit + 1
    )
    const orderedOffsets = [...searchProbe].sort((a, b) => a - b)
    const firstOffset = orderedOffsets[0] ?? -1

    if (searchProbe.length > this.windowLimit) {
      const replacedCount = await this.replaceSessionCheckpointed(
        this.sessionId,
        pattern,
        request.replacement,
        request.caseInsensitive ?? false,
        0,
        0
      )
      return {
        strategy: 'checkpointed',
        replacedCount,
        selectionOffset:
          replacedCount > 0 && request.replacement.length > 0
            ? firstOffset
            : -1,
        orderedOffsets: [],
        checkpointTransaction:
          replacedCount > 0 && request.replacementData !== undefined
            ? {
                kind: 'CHECKPOINT_REPLACE_ALL',
                query: request.query,
                isHex: request.isHex,
                caseInsensitive: request.caseInsensitive ?? false,
                data: request.replacementData,
              }
            : undefined,
      }
    }

    const replacedCount = await this.replaceSession(
      this.sessionId,
      pattern,
      request.replacement,
      request.caseInsensitive ?? false,
      request.isReverse ?? false,
      0,
      0,
      searchProbe.length
    )

    return {
      strategy: 'bounded',
      replacedCount,
      selectionOffset:
        replacedCount > 0 && request.replacement.length > 0 ? firstOffset : -1,
      orderedOffsets: orderedOffsets.slice(0, replacedCount),
    }
  }
}
