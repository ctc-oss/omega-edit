package com.ctc.omega_edit

import com.ctc.omega_edit.api.OmegaEdit

trait SessionSupport {
  def emptySession(test: api.Session => Unit): Unit =
    test(OmegaEdit.newSession(None))

  def session(bytes: Array[Byte])(test: api.Session => Unit): Unit = {
    val s = OmegaEdit.newSession(None)
    s.push(bytes)
    test(s)
  }

  def session(string: String)(test: api.Session => Unit): Unit =
    session(string.getBytes())(test)
}
