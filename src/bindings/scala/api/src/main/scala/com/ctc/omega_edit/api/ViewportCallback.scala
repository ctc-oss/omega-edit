package com.ctc.omega_edit.api

import com.ctc.omega_edit.{lib, ChangeImpl, OmegaFFI, ViewportImpl}
import jnr.ffi.Pointer
import jnr.ffi.annotations.Delegate

trait ViewportCallback {
  @Delegate def invoke(p: Pointer, c: Pointer): Unit = {
    val i = lib.omega.asInstanceOf[OmegaFFI]
    val change = c.address() match {
      case 0 | 1 | 2 => None
      case _         => Some(new ChangeImpl(c, i))
    }
    handle(new ViewportImpl(p, i), change)
  }

  def handle(v: Viewport, change: Option[Change]): Unit
}

object ViewportCallback {
  def apply(cb: (Viewport, Option[Change]) => Unit): ViewportCallback =
    (v: Viewport, change: Option[Change]) => cb(v, change)
}
