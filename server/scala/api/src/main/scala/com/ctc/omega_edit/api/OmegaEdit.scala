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

import com.ctc.omega_edit.FFI.{i => ffi}
import com.ctc.omega_edit.SessionImpl

import java.nio.file.Path
import scala.util.Try

/** The entrypoint to the OmegaEdit library. Provides Session instances and version information.
  */
object OmegaEdit extends OmegaEdit {
  def newSession(path: Option[Path] = None, chkptDir: Option[Path] = None): Session = newSessionCb(path, chkptDir, null)

  def newSessionCb(path: Option[Path], chkptDir: Option[Path], cb: SessionCallback): Session = {
    require(path.forall(_.toFile.exists()), s"specified file path \"${path.getOrElse("N/A")}\" does not exist")
    val pathArg = path.map[String](_.toString()).orNull
    val chkptDirArg = chkptDir.map[String](_.toString()).orNull

    new SessionImpl(
      ffi.omega_edit_create_session(
        pathArg,
        cb,
        null,
        0,
        chkptDirArg
      ),
      ffi
    )
  }

  /** Not strictly required to call this prior to interacting with the API, though this function is the convenient way
    * to check that the native library is ready to use.
    *
    * @return
    *   Try[Version]
    */
  def initialize(): Try[Version] =
    Try(version())

  def version(): Version =
    Version(
      ffi.omega_version_major(),
      ffi.omega_version_minor(),
      ffi.omega_version_patch()
    )
}

trait OmegaEdit {
  def version(): Version

  def newSession(path: Option[Path], chkptDir: Option[Path]): Session

  def newSessionCb(path: Option[Path], chkptDir: Option[Path], cb: SessionCallback): Session
}
