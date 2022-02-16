package com.ctc.omega_edit

import com.ctc.omega_edit.api.Change.Changed
import com.ctc.omega_edit.api.{Change, Session}

trait OmegaTestSupport extends SessionSupport with ViewportSupport {
  def changeFor(result: Change.Result)(implicit session: Session): Change = result match {
    case Changed(id) =>
      session.findChange(id) match {
        case Some(c) => c
        case None    => throw new RuntimeException(s"Change $id not found")
      }
    case Change.Fail => throw new RuntimeException("Change failed")
  }
}
