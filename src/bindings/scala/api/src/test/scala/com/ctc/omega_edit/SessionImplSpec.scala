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

import com.ctc.omega_edit.api._
import com.ctc.omega_edit.api.Change.Changed
import com.ctc.omega_edit.api.Session.OverwriteStrategy
import com.ctc.omega_edit.support.SessionSupport
import org.scalatest.OptionValues._
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.{Files, Paths}
import java.util.UUID
import scala.util.Success

class SessionImplSpec extends AnyWordSpec with Matchers with SessionSupport {

  val numbers = "123456789"
  //        0         1
  //        0123456789012345
  //            |    ||    |
  val as = "bbbbabbbbaabbbba"

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

    "throw if file doesnt exist" in {
      assertThrows[IllegalArgumentException](
        OmegaEdit.newSession(Some(Paths.get("/does-not-exist")))
      )
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

  "saving" should {
    /* On MacOSX, temp files are in /tmp which is a symlink to /private/tmp.
     * Session.save() seems to resolve symlinks, so we resolve our paths
     * to ensure they match what is returned. */
    val tmp = Files.createTempDirectory("omega").toRealPath()
    tmp.toFile.deleteOnExit()

    "save empty session" in emptySession { s =>
      val empty = tmp.resolve(Paths.get("empty.txt"))
      s.save(empty) shouldBe Success(empty)

      fileContents(empty) shouldBe ""
    }

    "save data from session" in emptySession { s =>
      val dat = tmp.resolve(Paths.get("dat.txt"))
      val expected = UUID.randomUUID().toString

      s.insert(expected, 0)
      s.save(dat) shouldBe Success(dat)

      fileContents(dat) shouldBe expected
    }

    "overwrite if exists" in emptySession { s =>
      val dat = tmp.resolve(Paths.get("dat.txt"))
      dat.toFile.exists() shouldBe true
      val expected = UUID.randomUUID().toString

      s.insert(expected, 0)
      s.save(dat, OverwriteStrategy.OverwriteExisting) shouldBe Success(dat)

      fileContents(dat) shouldBe expected
    }

    "use generated path if exists" in emptySession { s =>
      val dat = tmp.resolve(Paths.get("dat.txt"))
      dat.toFile.exists() shouldBe true

      val expected = UUID.randomUUID().toString
      s.insert(expected, 0)

      val r = s.save(dat, OverwriteStrategy.GenerateFilename)
      r.isSuccess shouldBe true
      r should not matchPattern { case Success(`dat`) => }

      fileContents(r.get) shouldBe expected
    }
  }

  "search" should {
    "find nothing if nothing is there" in session(numbers) { s =>
      s.search("abc".getBytes, 0) shouldBe List.empty
    }

    "find a single match" in session(numbers) { s =>
      s.search("345".getBytes, 0) shouldBe List(2)
    }

    "find multiple matches" in session(as) { s =>
      s.search("a".getBytes, 0) shouldBe List(4, 9, 10, 15)
    }

    "respect offsets" in session(as) { s =>
      s.search("a".getBytes, 1) shouldBe List(4, 9, 10, 15)
      s.search("a".getBytes, 5) shouldBe List(9, 10, 15)
    }

    "respect len" in session(as) { s =>
      s.search("a".getBytes, 0, Some(as.length.toLong - 2)) shouldBe List(4, 9, 10)
    }

    "respect caseInsensitive" in session(as) { s =>
      s.search("A".getBytes, 0, caseInsensitive = true) shouldBe List(4, 9, 10, 15)
    }

    "respect limit" in session(as) { s =>
      s.search("a".getBytes, 0, limit = Some(2)) shouldBe List(4, 9)
    }
  }

  "segments" should {
    "find stuff" in session(numbers) { s =>
      s.getSegment(3, 4) match {
        case Some(Segment(3, data)) =>
          data should equal(numbers.substring(3, 3 + 4).getBytes())
        case _ => fail()
      }
    }
  }
}
