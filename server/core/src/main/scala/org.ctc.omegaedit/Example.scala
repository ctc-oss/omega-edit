/**********************************************************************************************************************
 * Copyright (c) 2021-2022 Concurrent Technologies Corporation.                                                       *
 *                                                                                                                    *
 * Licensed under the Apache License, Version 2.0 (the "License"): you may not use this file except in compliance     *
 * with the License.  You may obtain a copy of the License at                                                         *
 *                                                                                                                    *
 *     http://www.apache.org/licenses/LICENSE-2.0                                                                     *
 *                                                                                                                    *
 * Unless required by applicable law or agreed to in writing, software is distributed under the License is            *
 * distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or                   *
 * implied.  See the License for the specific language governing permissions and limitations under the License.       *
 *                                                                                                                    *
 **********************************************************************************************************************/

package org.ctc.omegaedit

import jnr.ffi.LibraryLoader
import org.scijava.nativelib._

trait omega_edit {
  def omega_license_get(): String
}

object Example {
  def main(args: Array[String]): Unit = {
    NativeLoader.getJniExtractor().extractJni("omega_edit", "lib")
    lazy val omega_edit = LibraryLoader.create(classOf[omega_edit]).load("omega_edit")
    println(omega_edit.omega_license_get)
  }
}
