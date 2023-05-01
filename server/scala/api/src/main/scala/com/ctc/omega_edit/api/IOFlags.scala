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

import enumeratum.values.{IntEnum, IntEnumEntry}

/** Defines the IO Flags used by session save
  */
sealed abstract class IOFlags(val value: Int) extends IntEnumEntry
object IOFlags extends IntEnum[IOFlags] {
  // must match IOFlags defined in omega_edit.proto
  case object None extends IOFlags(0)
  case object Overwrite extends IOFlags(1)
  case object ForceOverwrite extends IOFlags(2)

  val values: IndexedSeq[IOFlags] = findValues

  object SaveStatus {
    val Success: Int = 0
    val Modified: Int = -100
  }
}
