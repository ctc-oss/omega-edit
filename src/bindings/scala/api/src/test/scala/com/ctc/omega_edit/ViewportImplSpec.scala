package com.ctc.omega_edit

import com.ctc.omega_edit.api.Change
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

class ViewportImplSpec extends AnyWordSpec with Matchers with OmegaTestSupport {
  "views" should {
    "limit data" in session("abc")(view(0, 1, _) { (s, v) =>
      s.size shouldBe 3
      v.data() shouldBe "a"
    })

    "offset data" in session("abc")(view(1, 1, _) { (s, v) =>
      s.size shouldBe 3
      v.data() shouldBe "b"
    })

    "move" in session("abc")(view(1, 1, _) { (s, v) =>
      v.data() shouldBe "b"
      v.move(0)
      v.data() shouldBe "a"
    })

    "resize" in session("abc")(view(0, 1, _) { (s, v) =>
      v.data() shouldBe "a"
      v.resize(2)
      v.data() shouldBe "ab"
    })

    "move and resize" in session("abc")(view(0, 1, _) { (s, v) =>
      v.data() shouldBe "a"
      v.update(1, 2)
      v.data() shouldBe "bc"
    })
  }

  "a callback" should {
    "be updated" in emptySession(viewWithCallback(0, 1, _) { (s, v) =>
      s.push("foo")
      v.data shouldBe Some("f")
    })

    "include the change type" in emptySession(viewWithCallback(0, 1, _) { (s, v) =>
      s.push("foo")
      v.change shouldBe Some(Change.Insert)
    })
  }
}
