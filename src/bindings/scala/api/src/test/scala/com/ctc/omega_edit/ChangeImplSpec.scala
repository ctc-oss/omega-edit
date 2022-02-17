package com.ctc.omega_edit

import com.ctc.omega_edit.api.Change
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

class ChangeImplSpec extends AnyWordSpec with Matchers with OmegaTestSupport {
  "session edits" must {
    // todo;; bug?
    //    "provide" in emptySession { implicit s =>
    //      changeFor(s.insert("abc", 0)) should matchPattern { case Change(1, 0, 3 /*, Change.Insert*/ ) => }
    //    }

    "provide serial number" in emptySession { s =>
      s.isEmpty shouldBe true
      s.push("abc") shouldBe Change.Changed(1)
      s.isEmpty shouldBe false
      s.size shouldBe 3
      s.push("123") shouldBe Change.Changed(2)
      s.size shouldBe 6
    }
  }
}
