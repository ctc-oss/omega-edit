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

class ChangeImplSpec extends AnyWordSpec with Matchers with TestSupport {
  "session edits" must {
    "provide" in emptySession { implicit s =>
      changeFor(s.insert("abc", 0)) should matchPattern { case Change(1, 0, 3, Change.Insert) => }
    }

    "provide serial number" in emptySession { s =>
      s.isEmpty shouldBe true
      s.insert("abc", 0) shouldBe Change.Changed(1)
      s.isEmpty shouldBe false
      s.size shouldBe 3
      s.insert("123", 0) shouldBe Change.Changed(2)
      s.size shouldBe 6
    }
  }
}
