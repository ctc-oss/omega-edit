package com.ctc.omega_edit

import com.ctc.omega_edit.api.{Change, Session, Viewport}

trait ViewportSupport {
  def view(offset: Long, capacity: Long, session: Session)(test: (Session, Viewport) => Unit): Unit =
    test(session, session.view(offset, capacity))

  trait WithCallback {
    def data: Option[String]
    def change: Option[Change]
  }

  def viewWithCallback(offset: Long, capacity: Long, session: Session)(test: (Session, WithCallback) => Unit): Unit = {
    var _data: Option[String] = None
    var _change: Option[Change] = None
    val cb = new WithCallback {
      def data: Option[String] = _data
      def change: Option[Change] = _change
    }
    session.viewCb(offset, capacity, (v, c) => {
      _data = Some(v.data())
      _change = c
    })
    test(session, cb)
  }
}
