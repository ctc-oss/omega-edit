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
import com.ctc.omega_edit.api.Session.OverwriteStrategy

import java.nio.file.Path
import scala.util.Try

/**
  * The top level type in OmegaEdit, maintains the data and all instances related to it.
  * Provides mutators and viewport factory methods.
  */
trait Session {
  def size: Long
  def isEmpty: Boolean = size == 0

  def numChanges: Long
  def numCheckpoints: Long
  def numUndos: Long
  def numViewports: Long
  
  def callback: Option[SessionCallback]

  def eventInterest: Int
  def eventInterest_=(eventInterest: Int): Unit

  def insert(s: String, offset: Long): Result
  def insert(b: Array[Byte], offset: Long): Result

  def overwrite(s: String, offset: Long): Result
  def overwrite(b: Array[Byte], offset: Long): Result

  def delete(offset: Long, len: Long): Result
  def view(offset: Long, size: Long): Viewport

  def undoLast(): Result
  def redoUndo(): Result

  def clearChanges(): Result

  def getLastChange(): Result

  def getLastUndo(): Result

  def viewCb(offset: Long, size: Long, cb: ViewportCallback, eventInterest: Int): Viewport
  def findChange(id: Long): Option[Change]

  def save(to: Path): Try[Path]
  def save(to: Path, overwrite: OverwriteStrategy): Try[Path]

  def search(pattern: String, offset: Long, length: Option[Long] = None, caseInsensitive: Boolean = false, limit: Option[Long] = None): List[Long]

  def getSegment(offset: Long, length: Long): Option[Segment]

  def pauseSessionChanges(): Result
  def resumeSessionChanges(): Result
}

object Session {
  sealed trait OverwriteStrategy
  object OverwriteStrategy {
    case object OverwriteExisting extends OverwriteStrategy
    case object GenerateFilename extends OverwriteStrategy
  }
}
