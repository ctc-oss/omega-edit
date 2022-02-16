package com.ctc.omega_edit.api

trait Viewport {
  def length: Long
  def data(): String

  def offset(): Long
  def capacity(): Long

  def move(offset: Long): Boolean
  def resize(capacity: Long): Boolean
  def update(offset: Long, capacity: Long): Boolean
}
