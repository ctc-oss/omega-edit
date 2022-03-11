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

package com.ctc.omega_edit.grpc

import akka.actor.ActorSystem
import akka.stream.scaladsl.Sink
import com.google.protobuf.ByteString
import com.google.protobuf.empty.Empty
import omega_edit._
import org.scalatest.Assertion
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AsyncWordSpecLike

import java.nio.file.Files
import java.util.UUID
import scala.concurrent.Future
import scala.io.Source

/**
  * This unit test is more for demonstration of the testability of the gRPC components than actual coverage
  */
class ExampleSpec extends AsyncWordSpecLike with Matchers with EditorServiceSupport {
  val tmp = Files.createTempDirectory("omega")
  tmp.toFile.deleteOnExit()

  "client" should useService { implicit service =>
    "to get version" in service.getOmegaVersion(Empty()).map { v =>
      v should matchPattern { case VersionResponse(_, _, _, _) => }
    }

    "to create session" in service.createSession(CreateSessionRequest()).map { v =>
      v.sessionId shouldNot be(empty)
    }

    "to update session data" in newSession { sid =>
      val testString = UUID.randomUUID().toString
      for {
        sizeBefore <- service.getComputedFileSize(ObjectId(sid)).map(_.computedFileSize)
        changeResponse <- service.submitChange(
          ChangeRequest(sid, ChangeKind.CHANGE_INSERT, data = Some(ByteString.copyFromUtf8(testString)))
        )
        sizeAfter <- service.getComputedFileSize(ObjectId(sid)).map(_.computedFileSize)
      } yield {
        sizeBefore shouldBe 0
        changeResponse should matchPattern { case ChangeResponse(`sid`, _, _) => }
        changeResponse should matchPattern { case ChangeResponse(`sid`, _, _) => }
        sizeAfter shouldBe testString.length
      }
    }

    "listen to session events" in newSession { sid =>
      import service.system
      service.subscribeToSessionEvents(ObjectId(sid)).runWith(Sink.headOption).map {
        case Some(e) => e should matchPattern { case SessionEvent(`sid`, _, _, _) => }
        case None    => fail("no message received")
      }
    }

    "save session" in newSession { sid =>
      val testString = UUID.randomUUID().toString
      for {
        _ <- service.submitChange(
          ChangeRequest(sid, ChangeKind.CHANGE_INSERT, data = Some(ByteString.copyFromUtf8(testString)))
        )
        saveResponse <- service.saveSession(
          SaveSessionRequest(sid, filePath = tmp.resolve("dat.txt").toString)
        )
        contents = Source.fromFile(saveResponse.filePath).mkString
      } yield {
        contents shouldBe testString
      }
    }
  }
}

// fixture helper
trait EditorServiceSupport {
  def useService(test: EditorService => Unit): Unit =
    test(new EditorService()(ActorSystem()))

  def newSession(
      test: String => Future[Assertion]
  )(implicit service: EditorService): Future[Assertion] = {
    import service.system.dispatcher
    service.createSession(CreateSessionRequest()).map(_.sessionId).flatMap(test)
  }
}
