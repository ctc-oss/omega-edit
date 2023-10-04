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

package com.ctc.omega_edit.spi

/** Thrown when the native library version does not match the API version.
  *
  * @param api
  *   The API version.
  * @param native
  *   The native library version.
  */
final case class VersionMismatch(api: String, native: String)
    extends IllegalStateException(
      s"Native library mismatch: api: $api, native: $native"
    )
