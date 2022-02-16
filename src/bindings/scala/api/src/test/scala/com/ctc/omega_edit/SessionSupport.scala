package com.ctc.omega_edit

trait SessionSupport {
  def emptySession(test: api.Session => Unit): Unit =
    test(lib.omega.newSession(None))

  def session(bytes: Array[Byte])(test: api.Session => Unit): Unit = {
    val s = lib.omega.newSession(None)
    s.push(bytes)
    test(s)
  }

  def session(string: String)(test: api.Session => Unit): Unit =
    session(string.getBytes())(test)
}
