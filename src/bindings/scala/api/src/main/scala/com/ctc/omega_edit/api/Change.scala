package com.ctc.omega_edit.api

trait Change {
  def id: Long
  def offset: Long
  def length: Long
  def data(): Array[Byte]
  def operation: Change.Op
}

object Change {
  def unapply(change: Change): Option[(Long, Long, Long /*, Change.Op*/ )] =
    Some((change.id, change.offset, change.length /*, change.operation*/ ))

  sealed trait Op
  case object Delete extends Op
  case object Insert extends Op
  case object Overwrite extends Op
  case object Undefined extends Op

  sealed trait Result
  case object Fail extends Result
  case class Changed(id: Long) extends Result
}
