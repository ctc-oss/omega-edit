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
    "limit data" in session("abc")(view(0, 1, false, _) { (s, v) =>
      s.size shouldBe 3
      v.offset shouldBe 0
      v.capacity shouldBe 1
      v.isFloating shouldBe false
      v.hasChanges shouldBe true
      v.data shouldBe "a".getBytes()
      v.hasChanges shouldBe false
      s.notifyChangedViewports shouldBe 0
      v.modify(1, 2, true)
      v.offset shouldBe 1
      v.capacity shouldBe 2
      v.isFloating shouldBe true
      v.hasChanges shouldBe true
      v.data shouldBe "bc".getBytes()
      v.hasChanges shouldBe false
      s.notifyChangedViewports shouldBe 0
    })

    "offset data" in session("abc")(view(1, 1, false, _) { (s, v) =>
      s.size shouldBe 3
      v.hasChanges shouldBe true
      s.notifyChangedViewports shouldBe 0
      v.data shouldBe "b".getBytes()
      v.hasChanges shouldBe false
      s.notifyChangedViewports shouldBe 0
    })

    "move" in session("abc")(view(1, 1, false, _) { (_, v) =>
      v.hasChanges shouldBe true
      v.data shouldBe "b".getBytes()
      v.hasChanges shouldBe false
      v.move(0)
      v.hasChanges shouldBe true
      v.data shouldBe "a".getBytes()
      v.hasChanges shouldBe false
    })

    "resize" in session("abc")(view(0, 1, false, _) { (_, v) =>
      v.hasChanges shouldBe true
      v.data shouldBe "a".getBytes()
      v.hasChanges shouldBe false
      v.resize(2)
      v.hasChanges shouldBe true
      v.data shouldBe "ab".getBytes()
      v.hasChanges shouldBe false
    })

    "move and resize" in session("abc")(view(0, 1, false, _) { (_, v) =>
      v.hasChanges shouldBe true
      v.data shouldBe "a".getBytes()
      v.hasChanges shouldBe false
      v.modify(1, 2, false)
      v.hasChanges shouldBe true
      v.data shouldBe "bc".getBytes()
      v.hasChanges shouldBe false
    })
  }

  "a callback" should {
    "be updated" in emptySession(viewWithCallback(0, 1, false, _) { (s, v) =>
      s.insert("foo".getBytes(), 0)
      withClue(v) { v.data.map(_ shouldBe "f".getBytes()) }
    })

    "include the change type" in emptySession(viewWithCallback(0, 1, false, _) {
      (s, v) =>
        s.insert("foo".getBytes(), 0)
        v.change shouldBe defined
        v.change.get.operation shouldBe Change.Insert
    })
  }
}
