package com.ctc.omega_edit

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

class SessionImplSpec extends AnyWordSpec with Matchers with SessionSupport {
  "a session" must {
    "be empty" in emptySession { s =>
      s.isEmpty shouldBe true
      s.size shouldBe 0
    }

    "have bytes" in session(Array[Byte]('a', 'b', 'c')) { s =>
      s.isEmpty shouldBe false
      s.size shouldBe 3
    }

    "have string" in session("abc") { s =>
      s.isEmpty shouldBe false
      s.size shouldBe 3
    }
  }
}
