/*
 * Copyright 2021 Concurrent Technologies Corporation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.ctc.omega_edit

import com.ctc.omega_edit.api.Change
import com.ctc.omega_edit.support.TestSupport
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

class ViewportImplSpec extends AnyWordSpec with Matchers with TestSupport {
  "views" should {
    "limit data" in session("abc")(view(0, 1, _) { (s, v) =>
      s.size shouldBe 3
      v.data shouldBe "a"
    })

    "offset data" in session("abc")(view(1, 1, _) { (s, v) =>
      s.size shouldBe 3
      v.data shouldBe "b"
    })

    "move" in session("abc")(view(1, 1, _) { (_, v) =>
      v.data shouldBe "b"
      v.move(0)
      v.data shouldBe "a"
    })

    "resize" in session("abc")(view(0, 1, _) { (_, v) =>
      v.data shouldBe "a"
      v.resize(2)
      v.data shouldBe "ab"
    })

    "move and resize" in session("abc")(view(0, 1, _) { (_, v) =>
      v.data shouldBe "a"
      v.update(1, 2)
      v.data shouldBe "bc"
    })
  }

  "a callback" should {
    "be updated" in emptySession(viewWithCallback(0, 1, _) { (s, v) =>
      s.insert("foo", 0)
      v.data shouldBe Some("f")
    })

    "include the change type" in emptySession(viewWithCallback(0, 1, _) {
      (s, v) =>
        s.insert("foo", 0)
        v.change shouldBe defined
        v.change.get.operation shouldBe Change.Insert
    })
  }
}
