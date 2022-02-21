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

/**
  * The top level type in OmegaEdit, maintains the data and all instances related to it.
  * Provides mutators and viewport factory methods.
  */
trait Session {
  def size: Long
  def isEmpty: Boolean

  def insert(s: String, offset: Long): Result
  def insert(b: Array[Byte], offset: Long): Result

  def overwrite(s: String, offset: Long): Result
  def overwrite(b: Array[Byte], offset: Long): Result

  def delete(offset: Long, len: Long): Result
  def view(offset: Long, size: Long): Viewport

  def viewCb(offset: Long, size: Long, cb: ViewportCallback): Viewport
  def findChange(id: Long): Option[Change]
}
