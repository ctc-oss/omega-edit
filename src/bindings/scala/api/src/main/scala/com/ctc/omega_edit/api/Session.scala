package com.ctc.omega_edit.api

import com.ctc.omega_edit.api.Change.Result

trait Session {
  def size: Long
  def isEmpty: Boolean

  def push(s: String): Result
  def push(b: Array[Byte]): Result
  def insert(s: String, offset: Long): Result
  def insert(b: Array[Byte], offset: Long): Result
  def overwrite(s: String, offset: Long): Result
  def overwrite(b: Array[Byte], offset: Long): Result

  def delete(offset: Long, len: Long): Result
  def view(offset: Long, size: Long): Viewport

  def viewCb(offset: Long, size: Long, cb: ViewportCallback): Viewport
  def findChange(id: Long): Option[Change]
}
