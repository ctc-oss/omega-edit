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
import { enqueueSessionMutation } from './mutation_queue'
import {
  replaceSession as defaultReplaceSession,
  replaceSessionCheckpointed as defaultReplaceSessionCheckpointed,
  SearchCaseFolding,
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
  caseFolding?: SearchCaseFolding
  isReverse?: boolean
}

export interface EditorFindAdjacentRequest extends EditorSearchRequest {
  direction: 'forward' | 'backward'
  anchorOffset: number
  fileSize: number
  viewportOffset?: number
  viewportLength?: number
  viewportLimit?: number
}

export interface EditorViewportMatchWindow {
  offset: number
  length: number
  matches: number[]
  hasMore: boolean
}

export interface EditorFindAdjacentResult {
  offset: number
  patternLength: number
  viewport?: EditorViewportMatchWindow
}

export interface EditorViewportMatchesRequest extends EditorSearchRequest {
  fileSize: number
  viewportOffset: number
  viewportLength: number
  viewportLimit?: number
  focusedOffset?: number
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
  caseFolding: SearchCaseFolding
  patternLength: number
  mode: EditorSearchMode
}

function toPatternBytes(query: string, isHex: boolean): Uint8Array {
  return isHex ? Buffer.from(query, 'hex') : Buffer.from(query, 'utf8')
}

/**
 * Replicates the non-overlapping match selection used by `replaceSession` (C++
 * `omega_edit_replace_matches_bytes`).  Matches are iterated in search order
 * (ascending when !isReverse, descending when isReverse) and any match that
 * overlaps the previously accepted match is discarded.  The returned array is
 * in the same order as the iteration, so callers that need ascending order
 * should sort the result separately.
 */
function filterNonOverlapping(
  offsets: number[],
  patternLength: number,
  isReverse: boolean
): number[] {
  if (offsets.length === 0 || patternLength <= 0) return offsets.slice()
  const sorted = [...offsets].sort((a, b) => (isReverse ? b - a : a - b))
  const result: number[] = []
  let lastAccepted = -1
  for (const offset of sorted) {
    const overlaps =
      lastAccepted >= 0 &&
      (isReverse
        ? offset + patternLength > lastAccepted
        : offset < lastAccepted + patternLength)
    if (!overlaps) {
      result.push(offset)
      lastAccepted = offset
    }
  }
  return result
}

function isUsableNonNegativeInteger(
  value: number | undefined
): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0
}

function matchOverlapsRange(
  matchOffset: number,
  patternLength: number,
  rangeOffset: number,
  rangeLength: number
): boolean {
  return (
    patternLength > 0 &&
    rangeLength > 0 &&
    matchOffset < rangeOffset + rangeLength &&
    matchOffset + patternLength > rangeOffset
  )
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
    const caseFolding = request.caseFolding ?? SearchCaseFolding.NONE
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
      caseFolding,
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
      caseFolding,
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
    const buildResult = async (
      offset: number
    ): Promise<EditorFindAdjacentResult> => {
      const viewport =
        offset >= 0
          ? await this.collectViewportMatches(
              pattern,
              request.caseFolding ?? SearchCaseFolding.NONE,
              request.fileSize,
              request.viewportOffset,
              request.viewportLength,
              request.viewportLimit,
              offset
            )
          : undefined
      return {
        offset,
        patternLength: pattern.length,
        ...(viewport ? { viewport } : {}),
      }
    }

    if (request.direction === 'forward') {
      const nextOffset = clampedAnchor >= 0 ? clampedAnchor + 1 : 0
      if (nextOffset < request.fileSize) {
        const matches = await this.searchSession(
          this.sessionId,
          pattern,
          request.caseFolding ?? SearchCaseFolding.NONE,
          false,
          nextOffset,
          0,
          1
        )
        if (matches.length > 0) {
          return await buildResult(matches[0])
        }
      }

      const wrapLength =
        clampedAnchor >= 0
          ? Math.min(request.fileSize, clampedAnchor + pattern.length - 1)
          : 0
      const wrappedMatches = await this.searchSession(
        this.sessionId,
        pattern,
        request.caseFolding ?? SearchCaseFolding.NONE,
        false,
        0,
        wrapLength,
        1
      )
      return await buildResult(wrappedMatches[0] ?? -1)
    }

    const reverseLength =
      clampedAnchor >= 0
        ? Math.min(request.fileSize, clampedAnchor + pattern.length - 1)
        : request.fileSize
    if (reverseLength > 0) {
      const matches = await this.searchSession(
        this.sessionId,
        pattern,
        request.caseFolding ?? SearchCaseFolding.NONE,
        true,
        0,
        reverseLength,
        1
      )
      if (matches.length > 0) {
        return await buildResult(matches[0])
      }
    }

    const wrapOffset = clampedAnchor >= 0 ? clampedAnchor + 1 : 0
    const wrappedMatches = await this.searchSession(
      this.sessionId,
      pattern,
      request.caseFolding ?? SearchCaseFolding.NONE,
      true,
      wrapOffset,
      0,
      1
    )
    return await buildResult(wrappedMatches[0] ?? -1)
  }

  public async findViewportMatches(
    request: EditorViewportMatchesRequest
  ): Promise<EditorViewportMatchWindow | undefined> {
    const normalizedQuery = request.query.trim()
    const pattern = toPatternBytes(normalizedQuery, request.isHex)
    if (!normalizedQuery || pattern.length === 0 || request.fileSize <= 0) {
      return undefined
    }

    return await this.collectViewportMatches(
      pattern,
      request.caseFolding ?? SearchCaseFolding.NONE,
      request.fileSize,
      request.viewportOffset,
      request.viewportLength,
      request.viewportLimit,
      request.focusedOffset ?? -1
    )
  }

  private async collectViewportMatches(
    pattern: Uint8Array,
    caseFolding: SearchCaseFolding,
    fileSize: number,
    viewportOffset: number | undefined,
    viewportLength: number | undefined,
    viewportLimit: number | undefined,
    focusedOffset: number
  ): Promise<EditorViewportMatchWindow | undefined> {
    if (
      pattern.length === 0 ||
      fileSize <= 0 ||
      !isUsableNonNegativeInteger(viewportOffset) ||
      !isUsableNonNegativeInteger(viewportLength) ||
      viewportLength === 0 ||
      viewportOffset >= fileSize
    ) {
      return undefined
    }

    const visibleOffset = Math.min(viewportOffset, fileSize)
    const visibleLength = Math.min(viewportLength, fileSize - visibleOffset)
    if (visibleLength <= 0) {
      return undefined
    }

    const boundaryPadding = Math.max(0, pattern.length - 1)
    const viewportSizedLimit = visibleLength + boundaryPadding + 1
    const limit =
      isUsableNonNegativeInteger(viewportLimit) && viewportLimit > 0
        ? viewportLimit
        : viewportSizedLimit
    const boundedLimit = Math.max(1, limit)
    const searchOffset = Math.max(0, visibleOffset - boundaryPadding)
    const searchEnd = Math.min(
      fileSize,
      visibleOffset + visibleLength + boundaryPadding
    )
    const rawMatches = await this.searchSession(
      this.sessionId,
      pattern,
      caseFolding,
      false,
      searchOffset,
      searchEnd - searchOffset,
      boundedLimit + 1
    )
    const visibleMatches = rawMatches
      .filter((matchOffset) =>
        matchOverlapsRange(
          matchOffset,
          pattern.length,
          visibleOffset,
          visibleLength
        )
      )
      .sort((a, b) => a - b)

    let matches = visibleMatches.slice(0, boundedLimit + 1)
    let hasMore = visibleMatches.length > boundedLimit

    if (
      focusedOffset >= 0 &&
      matchOverlapsRange(
        focusedOffset,
        pattern.length,
        visibleOffset,
        visibleLength
      ) &&
      !matches.includes(focusedOffset)
    ) {
      hasMore = true
      matches = Array.from(
        new Set([...matches.slice(0, boundedLimit), focusedOffset])
      ).sort((a, b) => a - b)
    }

    return {
      offset: visibleOffset,
      length: visibleLength,
      matches,
      hasMore,
    }
  }

  public async replaceAll(
    request: EditorReplaceAllRequest
  ): Promise<EditorReplaceAllResult> {
    return enqueueSessionMutation(this.sessionId, async () => {
      const normalizedQuery = request.query.trim()
      const pattern = toPatternBytes(normalizedQuery, request.isHex)
      const caseFolding = request.caseFolding ?? SearchCaseFolding.NONE
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
        caseFolding,
        request.isReverse ?? false,
        0,
        0,
        this.windowLimit + 1
      )
      // Filter to the same non-overlapping set that replaceSession uses so that
      // orderedOffsets and the limit passed to replaceSession are consistent.
      const nonOverlappingOffsets = filterNonOverlapping(
        searchProbe,
        pattern.length,
        request.isReverse ?? false
      )
      const orderedOffsets = [...nonOverlappingOffsets].sort((a, b) => a - b)
      const firstOffset = orderedOffsets[0] ?? -1

      if (searchProbe.length > this.windowLimit) {
        const replacedCount = await this.replaceSessionCheckpointed(
          this.sessionId,
          pattern,
          request.replacement,
          caseFolding,
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
                  query: normalizedQuery,
                  isHex: request.isHex,
                  caseFolding,
                  data: request.replacementData,
                }
              : undefined,
        }
      }

      // The search and replace run inside the same enqueueSessionMutation slot
      // so no other mutation can interleave and invalidate the match list.
      const replacedCount = await this.replaceSession(
        this.sessionId,
        pattern,
        request.replacement,
        caseFolding,
        request.isReverse ?? false,
        0,
        0,
        nonOverlappingOffsets.length,
        true,
        false,
        undefined
      )

      return {
        strategy: 'bounded',
        replacedCount,
        selectionOffset:
          replacedCount > 0 && request.replacement.length > 0
            ? firstOffset
            : -1,
        orderedOffsets: orderedOffsets.slice(0, replacedCount),
      }
    })
  }
}
