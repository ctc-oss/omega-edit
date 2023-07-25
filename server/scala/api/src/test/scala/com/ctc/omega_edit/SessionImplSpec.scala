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
import com.ctc.omega_edit.api._
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
  val binary: Array[Byte] = Array[Byte](1, 2, 3, 4, 0, 5, 6)

  "a session" must {
    "be empty" in emptySession { s =>
      s.isEmpty shouldBe true
      s.size shouldBe 0
      s.numViewports shouldBe 0
      s.numChangeTransactions shouldBe 0
      s.numUndoTransactions shouldBe 0
      s.destroy()
    }

    "be able to create and destroy viewports" in emptySession { s =>
      s.numViewports shouldBe 0
      val v1 = s.view(offset = 0, capacity = 10, isFloating = false)
      v1.offset shouldBe 0L
      v1.capacity shouldBe 10L
      v1.isFloating shouldBe false
      v1.hasChanges shouldBe true
      v1.data.length shouldBe 0L
      v1.hasChanges shouldBe false
      s.numViewports shouldBe 1
      val v2 = s.view(offset = 4, capacity = 8, isFloating = true)
      v2.offset shouldBe 4L
      v2.capacity shouldBe 8L
      v2.isFloating shouldBe true
      v2.hasChanges shouldBe true
      v2.data.length shouldBe 0L
      v2.hasChanges shouldBe false
      s.numViewports shouldBe 2
      v1.destroy()
      s.numViewports shouldBe 1
      v2.destroy()
      s.numViewports shouldBe 0
      s.destroy()
    }

    "have bytes" in session(Array[Byte]('a', 'b', 'c')) { s =>
      s.isEmpty shouldBe false
      s.size shouldBe 3
    }

    "handle binary" in session(binary) { s =>
      s.size shouldBe binary.length
      s.getSegment(0, binary.length.toLong).map(_.data shouldBe binary)
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
      s.insert("foo".getBytes(), 0) should matchPattern { case Changed(_) => }
      cb.event.value shouldBe SessionEvent.Edit
    }

    "include the change" in emptySessionWithCallback { (s, cb) =>
      s.insert("bar".getBytes(), 0)
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
      s.save(empty) shouldBe Success((empty, 0))

      fileContents(empty) shouldBe ""
    }

    "save data from session" in emptySession { s =>
      val dat = tmp.resolve(Paths.get("dat.txt"))
      val expected = UUID.randomUUID().toString

      s.insert(expected.getBytes(), 0)
      s.save(dat) shouldBe Success((dat, 0))

      fileContents(dat) shouldBe expected
    }

    "overwrite if exists" in emptySession { s =>
      val dat = tmp.resolve(Paths.get("dat.txt"))
      dat.toFile.exists() shouldBe true
      val expected = UUID.randomUUID().toString

      s.insert(expected.getBytes(), 0)
      s.save(dat, overwrite = true) shouldBe Success((dat, 0))

      fileContents(dat) shouldBe expected
    }

    "use generated path if exists" in emptySession { s =>
      val dat = tmp.resolve(Paths.get("dat.txt"))
      dat.toFile.exists() shouldBe true

      val expected = UUID.randomUUID().toString
      s.insert(expected.getBytes(), 0)

      val r = s.save(dat, overwrite = false)
      r.isSuccess shouldBe true
      r should not matchPattern { case Success(`dat`) => }

      fileContents(r.get._1) shouldBe expected
      r.get._2 shouldBe 0
    }
  }

  "search" should {
    "find nothing if nothing is there" in session(numbers) { s =>
      s.search("abc".getBytes, 0, 0) shouldBe List.empty
    }

    "find a single match" in session(numbers) { s =>
      s.search("345".getBytes, 0, 0) shouldBe List(2)
    }

    "find multiple matches" in session(as) { s =>
      s.search("a".getBytes, 0, 0) shouldBe List(4, 9, 10, 15)
    }

    "respect offsets" in session(as) { s =>
      s.search("a".getBytes, 1, 0) shouldBe List(4, 9, 10, 15)
      s.search("a".getBytes, 5, 0) shouldBe List(9, 10, 15)
    }

    "respect len" in session(as) { s =>
      s.search("a".getBytes, 0, as.length.toLong - 2) shouldBe List(4, 9, 10)
    }

    "respect caseInsensitive" in session(as) { s =>
      s.search("A".getBytes, 0, 0, caseInsensitive = true) shouldBe List(
        4,
        9,
        10,
        15
      )
    }

    "respect limit" in session(as) { s =>
      s.search("a".getBytes, 0, 0, limit = Some(2)) shouldBe List(4, 9)
    }
  }

  "profiler" should {
    "profile character data" in session(as) { s =>
      s.profile(0, 0) match {
        case Right(prof) =>
          prof('a') shouldBe 4
          prof('b') shouldBe 12
          prof('c') shouldBe 0
        case Left(errorCode) =>
          fail(s"Failed to retrieve profile. Error code: $errorCode")
      }
    }
    "profile binary data" in session(binary) { s =>
      s.profile(1, 5) match {
        case Right(prof) =>
          prof(0) shouldBe 1
          prof(1) shouldBe 0
          prof(2) shouldBe 1
          prof(5) shouldBe 1
          prof(6) shouldBe 0
        case Left(errorCode) =>
          fail(s"Failed to retrieve profile. Error code: $errorCode")
      }
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
