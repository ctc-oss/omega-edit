/*
 * Copyright 2021 Concurrent Technologies Corporation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.ctc.omega_edit.api

import com.ctc.omega_edit.api.Change.Result

import java.nio.file.Path
import scala.util.Try

/** The top level type in OmegaEdit, maintains the data and all instances related to it. Provides mutators and viewport
  * factory methods.
  */
trait Session {
  def size: Long
  def isEmpty: Boolean = size == 0

  def numChanges: Long
  def numCheckpoints: Long
  def numUndos: Long
  def numViewports: Long
  def numSearchContexts: Long
  def numChangeTransactions: Long
  def numUndoTransactions: Long
  def callback: Option[SessionCallback]

  def eventInterest: Int
  def eventInterest_=(eventInterest: Int): Unit

  def insert(b: Array[Byte], offset: Long): Result

  def overwrite(b: Array[Byte], offset: Long): Result

  def delete(offset: Long, len: Long): Result
  def view(offset: Long, capacity: Long, isFloating: Boolean): Viewport

  def undoLast(): Result
  def redoUndo(): Result

  def clearChanges(): Result

  def getLastChange(): Option[Change]

  def getLastUndo(): Option[Change]

  def viewCb(
      offset: Long,
      size: Long,
      isFloating: Boolean,
      cb: ViewportCallback
  ): Viewport
  def findChange(id: Long): Option[Change]

  def save(to: Path): Try[(Path, Int)]
  def save(to: Path, overwrite: Boolean): Try[(Path, Int)]
  def save(to: Path, flags: Int): Try[(Path, Int)]
  def save(to: Path, flags: Int, offset: Long, length: Long): Try[(Path, Int)]
  def detectByteOrderMark(offset: Long): String
  def detectByteOrderMark: String
  def byteOrderMarkSize(bom: String): Long
  def byteOrderMarkSize(bom: Int): Long
  def profile(offset: Long, length: Long): Either[Int, Array[Long]]
  def charCount(offset: Long, length: Long, bom: Int): Either[Int, CharCounts]
  def charCount(offset: Long, length: Long, bom: String): Either[Int, CharCounts]

  def detectContentType(offset: Long, length: Long): String
  def detectLanguage(offset: Long, length: Long, bom: String): String
  def search(
      pattern: Array[Byte],
      offset: Long,
      length: Long,
      caseInsensitive: Boolean = false,
      reverseSearch: Boolean = false,
      limit: Option[Long] = None
  ): List[Long]

  def getSegment(offset: Long, length: Long): Option[Segment]

  def pauseSessionChanges(): Unit
  def resumeSessionChanges(): Unit
  def pauseViewportEvents(): Unit
  def resumeViewportEvents(): Unit
  def notifyChangedViewports: Int
  def beginTransaction: Int
  def endTransaction: Int
  def checkpointDirectory: Path
  def destroy(): Unit
}
