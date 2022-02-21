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

import com.ctc.omega_edit.api.Change.Changed
import com.ctc.omega_edit.api.{Change, SessionEvent}
import com.ctc.omega_edit.support.SessionSupport
import org.scalatest.OptionValues._
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

  "a callback" should {
    "include the event" in emptySessionWithCallback { (s, cb) =>
      s.insert("foo", 0) should matchPattern { case Changed(_) => }
      cb.event.value shouldBe SessionEvent.Edit
    }

    "include the change" in emptySessionWithCallback { (s, cb) =>
      s.insert("bar", 0)
      cb.change.flatten.value.operation shouldBe Change.Insert
    }
  }
}
