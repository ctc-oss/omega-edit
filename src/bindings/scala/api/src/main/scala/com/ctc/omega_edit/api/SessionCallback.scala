package com.ctc.omega_edit.api

import com.ctc.omega_edit.{lib, OmegaFFI, SessionImpl}
import jnr.ffi.Pointer
import jnr.ffi.annotations.Delegate

trait SessionCallback {
  @Delegate def invoke(p: Pointer, e: Pointer, c: Pointer): Unit =
    handle(new SessionImpl(p, lib.omega.asInstanceOf[OmegaFFI]))

  def handle(v: Session): Unit
}

object SessionCallback {
  def apply(cb: (Session) => Unit): SessionCallback =
    (v: Session) => cb(v)
}
