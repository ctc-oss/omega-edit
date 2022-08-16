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

package com.ctc.omega_edit

import com.ctc.omega_edit.api._
import com.ctc.omega_edit.api.Change.{Changed, Result}
import com.ctc.omega_edit.api.Session.OverwriteStrategy
import com.ctc.omega_edit.api.Session.OverwriteStrategy.{
  GenerateFilename,
  OverwriteExisting
}
import jnr.ffi.Pointer

import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.nio.file.{Path, Paths}
import scala.util.{Failure, Success, Try}
import com.ctc.omega_edit.api.SessionCallback

private[omega_edit] class SessionImpl(p: Pointer, i: FFI) extends Session {
  require(p != null, "native session pointer was null")

  def size: Long =
    i.omega_session_get_computed_file_size(p)

  def numChanges: Long =
    i.omega_session_get_num_changes(p)

  def numCheckpoints: Long =
    i.omega_session_get_num_checkpoints(p)

  def numUndos: Long =
    i.omega_session_get_num_undone_changes(p)

  def numViewports: Long =
    i.omega_session_get_num_viewports(p)

  def numSearchContexts: Long =
    i.omega_session_get_num_search_contexts(p)

  def callback: Option[SessionCallback] =
    Option(i.omega_session_get_event_cbk(p))

  def eventInterest: Int =
    i.omega_session_get_event_interest(p)

  def eventInterest_=(eventInterest: Int): Unit =
    i.omega_session_set_event_interest(p, eventInterest)

  def pauseSessionChanges(): Unit =
    i.omega_session_pause_changes(p)

  def resumeSessionChanges(): Unit =
    i.omega_session_resume_changes(p)

  def pauseViewportEvents(): Unit =
    i.omega_session_pause_viewport_event_callbacks(p)

  def resumeViewportEvents(): Unit =
    i.omega_session_resume_viewport_event_callbacks(p)

  def delete(offset: Long, len: Long): Result =
    Edit(i.omega_edit_delete(p, offset, len))

  def insert(b: Array[Byte], offset: Long): Result =
    Edit(i.omega_edit_insert_bytes(p, offset, b, 0))

  def insert(s: String, offset: Long): Result =
    Edit(i.omega_edit_insert(p, offset, s, 0))

  def overwrite(b: Array[Byte], offset: Long): Result =
    Edit(i.omega_edit_overwrite_bytes(p, offset, b, 0))

  def overwrite(s: String, offset: Long): Result =
    Edit(i.omega_edit_overwrite(p, offset, s, 0))

  /** omega_edit_undo_last_change returns the *negative* serial number of the
    * change, so negate it to use same success/fail logic.
    *
    * @see
    *   https://github.com/ctc-oss/omega-edit/wiki#undo
    */
  def undoLast(): Result =
    Edit(i.omega_edit_undo_last_change(p))

  def redoUndo(): Result =
    Edit(i.omega_edit_redo_last_undo(p))

  def clearChanges(): Result =
    Edit(i.omega_edit_clear_changes(p))

  def getLastChange(): Option[Change] =
    Option(i.omega_session_get_last_change(p)).map(new ChangeImpl(_, i))

  def getLastUndo(): Option[Change] =
    Option(i.omega_session_get_last_undo(p)).map(new ChangeImpl(_, i))

  def view(offset: Long, size: Long): Viewport = {
    val vp =
      i.omega_edit_create_viewport(p, offset, size, false, null, null, 0)
    new ViewportImpl(vp, i)
  }

  def viewCb(
      offset: Long,
      size: Long,
      cb: ViewportCallback,
      eventInterest: Int
  ): Viewport = {
    val vp = i.omega_edit_create_viewport(
      p,
      offset,
      size,
      false,
      cb,
      null,
      eventInterest
    )
    new ViewportImpl(vp, i)
  }

  def findChange(id: Long): Option[Change] =
    i.omega_session_get_change(p, id) match {
      case null => None
      case ptr  => Some(new ChangeImpl(ptr, i))
    }

  def save(to: Path): Try[Path] =
    save(to, OverwriteExisting)

  def save(to: Path, onExists: OverwriteStrategy): Try[Path] = {
    // todo;; obtain an accurate and portable number here
    val buffer = ByteBuffer.allocate(4096)
    val overwrite = onExists match {
      case OverwriteExisting => true
      case GenerateFilename  => false
    }
    i.omega_edit_save(
      p,
      to.toString,
      overwrite,
      Pointer.wrap(p.getRuntime, buffer)
    ) match {
      case 0 =>
        val path = StandardCharsets.UTF_8.decode(buffer)
        Success(Paths.get(path.toString.trim))

      case ec =>
        Failure(new RuntimeException(s"Failed to save session to file, $ec"))
    }
  }

  def search(
      pattern: String,
      offset: Long,
      length: Option[Long] = None,
      caseInsensitive: Boolean = false,
      limit: Option[Long] = None
  ): List[Long] = {
    val context =
      i.omega_search_create_context(
        p,
        pattern,
        0,
        offset,
        length.getOrElse(0),
        caseInsensitive
      )

    try {
      Iterator
        .unfold(context -> 0) { case (context, numMatches) =>
          Option.when(
            limit.map(numMatches < _).getOrElse(true) && i
              .omega_search_next_match(context, 1) > 0
          )(
            i.omega_search_context_get_offset(
              context
            ) -> (context, numMatches + 1)
          )
        }
        .toList
    } finally i.omega_search_destroy_context(context)
  }

  def getSegment(offset: Long, length: Long): Option[Segment] = {
    val sp = i.omega_segment_create(length)

    try {
      val result = i.omega_session_get_segment(p, sp, offset)

      Option.when(result == 0)(
        Segment(offset, i.omega_segment_get_data(sp).getBytes)
      )
    } finally i.omega_segment_destroy(sp)
  }
}

private object Edit {
  def apply(op: => Long): Change.Result =
    op match {
      case 0          => Change.Paused
      case v if v < 0 => Change.Fail
      case v          => Changed(v)
    }
}
