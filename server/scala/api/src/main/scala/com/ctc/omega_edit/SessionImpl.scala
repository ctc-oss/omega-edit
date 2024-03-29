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

import com.ctc.omega_edit.api.Change.{Changed, Result}
import com.ctc.omega_edit.api._
import jnr.ffi.{Memory, Pointer}

import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.nio.file.{Path, Paths}
import scala.util.{Failure, Success, Try}
import org.apache.tika.detect.DefaultDetector
import org.apache.tika.langdetect.optimaize.OptimaizeLangDetector
import org.apache.tika.metadata.Metadata

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

  def numChangeTransactions: Long =
    i.omega_session_get_num_change_transactions(p)

  def numUndoTransactions: Long =
    i.omega_session_get_num_undone_change_transactions(p)

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

  def notifyChangedViewports: Int =
    i.omega_session_notify_changed_viewports(p)

  def beginTransaction: Int =
    i.omega_session_begin_transaction(p)

  def endTransaction: Int =
    i.omega_session_end_transaction(p)

  def checkpointDirectory: Path = Paths.get(i.omega_session_get_checkpoint_directory(p).getString(0))

  def delete(offset: Long, len: Long): Result =
    Edit(i.omega_edit_delete(p, offset, len))

  def insert(b: Array[Byte], offset: Long): Result =
    Edit(i.omega_edit_insert_bytes(p, offset, b, b.length.toLong))

  def overwrite(b: Array[Byte], offset: Long): Result =
    Edit(i.omega_edit_overwrite_bytes(p, offset, b, b.length.toLong))

  /** omega_edit_undo_last_change returns the *negative* serial number of the change, so perform different matching for
    * change id
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

  def view(offset: Long, capacity: Long, isFloating: Boolean): Viewport = {
    val vp =
      i.omega_edit_create_viewport(
        p,
        offset,
        capacity,
        isFloating,
        null,
        null,
        0
      )
    new ViewportImpl(vp, i)
  }

  def viewCb(
      offset: Long,
      capacity: Long,
      isFloating: Boolean = false,
      cb: ViewportCallback
  ): Viewport = {
    val vp = i.omega_edit_create_viewport(
      p,
      offset,
      capacity,
      isFloating,
      cb,
      null,
      0
    )
    new ViewportImpl(vp, i)
  }

  def findChange(id: Long): Option[Change] =
    i.omega_session_get_change(p, id) match {
      case null => None
      case ptr  => Some(new ChangeImpl(ptr, i))
    }

  def save(to: Path): Try[(Path, Int)] =
    save(to, overwrite = true)

  def save(to: Path, overwrite: Boolean): Try[(Path, Int)] =
    save(
      to,
      if (overwrite) {
        IOFlags.Overwrite.value
      } else {
        IOFlags.None.value
      }
    )

  def save(to: Path, flags: Int): Try[(Path, Int)] =
    save(to, flags, 0, 0)

  def save(to: Path, flags: Int, offset: Long, length: Long): Try[(Path, Int)] = {
    // todo;; obtain an accurate and portable number here
    val buffer = ByteBuffer.allocate(4096)

    val resultCode = i.omega_edit_save_segment(
      p,
      to.toString,
      flags,
      Pointer.wrap(p.getRuntime, buffer),
      offset,
      length
    )

    resultCode match {
      case IOFlags.SaveStatus.Success | IOFlags.SaveStatus.Modified =>
        Success((Paths.get(StandardCharsets.UTF_8.decode(buffer).toString.trim), resultCode))
      case _ =>
        Failure(new RuntimeException(s"Failed to save session to file: $resultCode"))
    }
  }
  def detectByteOrderMark(offset: Long): String =
    i.omega_util_BOM_to_cstring(i.omega_session_detect_BOM(p, offset)).getString(0)

  def detectByteOrderMark: String =
    detectByteOrderMark(0)

  def byteOrderMarkSize(bom: Int): Long =
    i.omega_util_BOM_size(bom)
  def byteOrderMarkSize(bom: String): Long =
    byteOrderMarkSize(i.omega_util_cstring_to_BOM(bom))

  def profile(offset: Long, length: Long): Either[Int, Array[Long]] = {
    lazy val ProfileSize = i.omega_session_byte_frequency_profile_size()
    val profilePtr = Memory.allocateDirect(p.getRuntime, ProfileSize * 8)
    i.omega_session_byte_frequency_profile(p, profilePtr, offset, length) match {
      case 0 => // success
        val profile = new Array[Long](ProfileSize)
        for (i <- 0 until ProfileSize)
          profile(i) = profilePtr.getLong(i.toLong * 8L)
        Right(profile)
      case result => Left(result)
    }
  }

  def charCount(offset: Long, length: Long, bom: Int): Either[Int, CharCounts] = {
    val pCounts = i.omega_character_counts_set_BOM(i.omega_character_counts_create(), bom)
    try
      i.omega_session_character_counts(p, pCounts, offset, length, bom) match {
        case 0 =>
          Right(
            CharCounts(
              i.omega_util_BOM_to_cstring(i.omega_character_counts_get_BOM(pCounts)).getString(0),
              i.omega_character_counts_bom_bytes(pCounts),
              i.omega_character_counts_single_byte_chars(pCounts),
              i.omega_character_counts_double_byte_chars(pCounts),
              i.omega_character_counts_triple_byte_chars(pCounts),
              i.omega_character_counts_quad_byte_chars(pCounts),
              i.omega_character_counts_invalid_bytes(pCounts)
            )
          )
        case result => Left(result)
      }
    finally
      i.omega_character_counts_destroy(pCounts)
  }

  def charCount(offset: Long, length: Long, bom: String): Either[Int, CharCounts] =
    charCount(offset, length, i.omega_util_cstring_to_BOM(bom))

  def search(
      pattern: Array[Byte],
      offset: Long,
      length: Long,
      caseInsensitive: Boolean = false,
      reverseSearch: Boolean = false,
      limit: Option[Long] = None
  ): List[Long] =
    i.omega_search_create_context_bytes(
      p,
      pattern,
      pattern.length.toLong,
      offset,
      length,
      caseInsensitive,
      reverseSearch
    ) match {
      case null => List.empty[Long]
      case context =>
        try
          Iterator
            .unfold(context -> 0) { case (context, numMatches) =>
              Option.when(
                limit.forall(numMatches < _) && i
                  .omega_search_next_match(context, 1) > 0
              )(
                i.omega_search_context_get_match_offset(
                  context
                ) -> (context, numMatches + 1)
              )
            }
            .toList
        finally i.omega_search_destroy_context(context)
    }

  def getSegment(offset: Long, length: Long): Option[Segment] = {
    val sp = i.omega_segment_create(length)
    try {
      val result = i.omega_session_get_segment(p, sp, offset)
      Option.when(result == 0) {
        val data = i.omega_segment_get_data(sp)
        val out = Array.ofDim[Byte](length.toInt)
        data.get(0, out, 0, length.toInt)
        Segment(offset, out)
      }
    } finally i.omega_segment_destroy(sp)
  }

  def detectContentType(offset: Long, length: Long): String =
    getSegment(offset, length) match {
      case Some(segment) =>
        val detector = new DefaultDetector()
        val metadata = new Metadata()
        val stream = new java.io.ByteArrayInputStream(segment.data)
        val mediaType = detector.detect(stream, metadata)
        mediaType.toString
      case None => throw new RuntimeException(s"Failed to get segment at offset $offset and length $length")
    }

  def detectLanguage(offset: Long, length: Long, bom: String): String =
    getSegment(offset, length) match {
      case Some(segment) =>
        val detector = new OptimaizeLangDetector()
        detector.loadModels()

        // Convert byte array to String
        val content = new String(segment.data, if (bom == "none" || bom == "unknown") "UTF-8" else bom)

        val languageResult = detector.detect(content) // Noq metadata argument
        if (languageResult.isReasonablyCertain) languageResult.getLanguage.toString else "unknown"

      case None => throw new RuntimeException(s"Failed to get segment at offset $offset and length $length")
    }

  def destroy(): Unit =
    i.omega_edit_destroy_session(p)
}

private object Edit {
  def apply(op: => Long): Change.Result =
    op match {
      case v => Changed(v)
    }
}
