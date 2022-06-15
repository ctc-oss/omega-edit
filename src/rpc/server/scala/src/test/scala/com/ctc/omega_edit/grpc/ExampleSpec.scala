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
class ExampleSpec
    extends AsyncWordSpecLike
    with Matchers
    with EditorServiceSupport {
  val tmp = Files.createTempDirectory("omega")
  tmp.toFile.deleteOnExit()

  "client" should useService { implicit service =>
    "get version" in service.getVersion(Empty()).map { v =>
      v should matchPattern { case VersionResponse(_, _, _, _) => }
    }

    "have zero sessions when initialized" in service
      .getSessionCount(Empty())
      .map {
        case SessionCountResponse(count, _) =>
          count should be(0)
      }

    "create session" in service.createSession(CreateSessionRequest()).map {
      v =>
        v.sessionId shouldNot be(empty)
    }

    "have one session counted after creation" in service
      .getSessionCount(Empty())
      .map {
        case SessionCountResponse(count, _) =>
          count should be(1)
      }

    "update session data" in newSession { sid =>
      val testString = UUID.randomUUID().toString
      for {
        sizeBefore <- service
          .getComputedFileSize(ObjectId(sid))
          .map(_.computedFileSize)
        changeResponse <- service.submitChange(
          ChangeRequest(sid,
                        ChangeKind.CHANGE_INSERT,
                        data = Some(ByteString.copyFromUtf8(testString)))
        )
        sizeAfter <- service
          .getComputedFileSize(ObjectId(sid))
          .map(_.computedFileSize)
      } yield {
        sizeBefore shouldBe 0
        changeResponse should matchPattern {
          case ChangeResponse(`sid`, _, _) =>
        }
        changeResponse should matchPattern {
          case ChangeResponse(`sid`, _, _) =>
        }
        sizeAfter shouldBe testString.length
      }
    }

    "listen to session events" in newSession { sid =>
      import service.system
      service
        .subscribeToSessionEvents(ObjectId(sid))
        .runWith(Sink.headOption)
        .map {
          case Some(e) =>
            e should matchPattern {
              case SessionEvent(`sid`, _, _, _, _, _, _) =>
            }
          case None => fail("no message received")
        }
    }

    "save session" in newSession { sid =>
      val testString = UUID.randomUUID().toString
      for {
        _ <- service.submitChange(
          ChangeRequest(sid,
                        ChangeKind.CHANGE_INSERT,
                        data = Some(ByteString.copyFromUtf8(testString)))
        )
        saveResponse <- service.saveSession(
          SaveSessionRequest(sid, filePath = tmp.resolve("dat.txt").toString)
        )
        contents = Source.fromFile(saveResponse.filePath).mkString
      } yield {
        contents shouldBe testString
      }
    }

    "save session without overwrites writes to new file" in newSession { sid =>
      val testString1 = UUID.randomUUID().toString
      val testString2 = UUID.randomUUID().toString

      val filePath = tmp.resolve("dat.txt").toString

      for {
        _ <- service.submitChange(
          ChangeRequest(sid,
                        ChangeKind.CHANGE_INSERT,
                        data = Some(ByteString.copyFromUtf8(testString1)))
        )
        saveResponse1 <- service.saveSession(SaveSessionRequest(sid, filePath))

        _ <- service.submitChange(
          ChangeRequest(sid,
                        ChangeKind.CHANGE_OVERWRITE,
                        data = Some(ByteString.copyFromUtf8(testString2)))
        )
        saveResponse2 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = Some(false)))

        contents1 = Source
          .fromFile(saveResponse1.filePath)
          .mkString // to ensure first saved file not overwritten
        contents2 = Source.fromFile(saveResponse2.filePath).mkString
      } yield {
        saveResponse2.filePath should not be saveResponse1.filePath
        contents1 shouldBe testString1
        contents2 shouldBe testString2
      }
    }

    "undo changes" in newSession { sid =>
      val testString1 = UUID.randomUUID().toString
      val testString2 = UUID.randomUUID().toString

      val filePath = tmp.resolve("dat.txt").toString

      for {
        _ <- service.submitChange(
          ChangeRequest(sid,
                        ChangeKind.CHANGE_INSERT,
                        data = Some(ByteString.copyFromUtf8(testString1)))
        )
        saveResponse1 <- service.saveSession(SaveSessionRequest(sid, filePath))

<<<<<<< HEAD
=======
        _ <- service.submitChange(
>>>>>>> 039b784f9a6823fc2d9505b833bea72ecb287bbf
          ChangeRequest(sid,
                        ChangeKind.CHANGE_OVERWRITE,
                        data = Some(ByteString.copyFromUtf8(testString2)))
        )
        saveResponse2 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = Some(false)))

<<<<<<< HEAD
        saveResponse3_ <- service.undoLastChange(ObjectId(sid))
=======
        _ <- service.undoLastChange(ObjectId(sid))
>>>>>>> 039b784f9a6823fc2d9505b833bea72ecb287bbf
        saveResponse3 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = Some(false)))

        contents1 = Source
          .fromFile(saveResponse1.filePath)
          .mkString // to ensure first saved file not overwritten
        contents2 = Source.fromFile(saveResponse2.filePath).mkString
        contents3 = Source.fromFile(saveResponse3.filePath).mkString
      } yield {
        saveResponse2.filePath should not be saveResponse1.filePath
        saveResponse3.filePath should not be saveResponse2.filePath
        saveResponse3.filePath should not be saveResponse1.filePath
        contents1 shouldBe testString1
        contents2 shouldBe testString2
        contents3 shouldBe testString1
      }
    }

    "redo last undo" in newSession { sid =>
      val testString1 = UUID.randomUUID().toString
      val testString2 = UUID.randomUUID().toString

      val filePath = tmp.resolve("dat.txt").toString

      for {
        _ <- service.submitChange(
          ChangeRequest(sid,
                        ChangeKind.CHANGE_INSERT,
                        data = Some(ByteString.copyFromUtf8(testString1)))
        )
        saveResponse1 <- service.saveSession(SaveSessionRequest(sid, filePath))

        _ <- service.submitChange(
          ChangeRequest(sid,
                        ChangeKind.CHANGE_OVERWRITE,
                        data = Some(ByteString.copyFromUtf8(testString2)))
        )
        saveResponse2 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = Some(false)))

        _ <- service.undoLastChange(ObjectId(sid))
        saveResponse3 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = Some(false)))

        _ <- service.redoLastUndo(ObjectId(sid))
        saveResponse4 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = Some(false)))

        contents1 = Source
          .fromFile(saveResponse1.filePath)
          .mkString // to ensure first saved file not overwritten
        contents2 = Source.fromFile(saveResponse2.filePath).mkString
        contents3 = Source.fromFile(saveResponse3.filePath).mkString
        contents4 = Source.fromFile(saveResponse4.filePath).mkString
      } yield {
        saveResponse2.filePath should not be saveResponse1.filePath
        saveResponse3.filePath should not be saveResponse2.filePath
        saveResponse3.filePath should not be saveResponse1.filePath
        saveResponse4.filePath should not be saveResponse1.filePath
        saveResponse4.filePath should not be saveResponse2.filePath
        saveResponse4.filePath should not be saveResponse3.filePath
        contents1 shouldBe testString1
        contents2 shouldBe testString2
        contents3 shouldBe testString1
        contents4 shouldBe testString2
      }
    }

    "clear all session changes" in newSession { sid =>
      val testString1 = UUID.randomUUID().toString
      val testString2 = UUID.randomUUID().toString

      val filePath = tmp.resolve("dat.txt").toString

      for {
        _ <- service.submitChange(
          ChangeRequest(sid,
                        ChangeKind.CHANGE_INSERT,
                        data = Some(ByteString.copyFromUtf8(testString1)))
        )
        saveResponse1 <- service.saveSession(SaveSessionRequest(sid, filePath))

        _ <- service.submitChange(
          ChangeRequest(sid,
                        ChangeKind.CHANGE_OVERWRITE,
                        data = Some(ByteString.copyFromUtf8(testString2)))
        )
        saveResponse2 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = Some(false)))

        getBeforeChangeCount <- service.getCount(sid,
                                          CountKind.COUNT_CHANGES)

        _ <- service.clearChanges(objectId(sid))
        getAfterChangeCount < service.getCount(sid,
                                                CountKind.COUNT_CHANGES)

        contents1 = Source
          .fromFile(saveResponse1.filePath)
          .mkString // to ensure first saved file not overwritten
        contents2 = Source.fromFile(saveResponse2.filePath).mkString
      } yield {
        saveResponse2.filePath should not be saveResponse1.filePath
        contents1 shouldBe testString1
        contents2 shouldBe testString2
        getBeforeChangeCount shouldBe 2
        getAfterChangeCount shouldBe 0
      }
    }


    "get last change" in newSession { sid =>
      val testString1 = UUID.randomUUID().toString
      val testString2 = UUID.randomUUID().toString

      val filePath = tmp.resolve("dat.txt").toString

      for {
        _ <- service.submitChange(
          ChangeRequest(sid,
                        ChangeKind.CHANGE_INSERT,
                        data = Some(ByteString.copyFromUtf8(testString1)))
        )
        saveResponse1 <- service.saveSession(SaveSessionRequest(sid, filePath))

        _ <- service.submitChange(
          ChangeRequest(sid,
                        ChangeKind.CHANGE_OVERWRITE,
                        data = Some(ByteString.copyFromUtf8(testString2)))
        )
        saveResponse2 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = Some(false)))

        _ <- service.getLastChange(ObjectId(sid))
        saveResponse3 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = Some(false)))
       

        contents1 = Source
          .fromFile(saveResponse1.filePath)
          .mkString // to ensure first saved file not overwritten
        contents2 = Source.fromFile(saveResponse2.filePath).mkString
        contents3 = Source.fromFile(saveResponse3.filePath).mkString
      } yield {
        saveResponse2.filePath should not be saveResponse1.filePath
        contents1 shouldBe testString1
        contents2 shouldBe testString2
        contents2 shouldBe testString2

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
    service
      .createSession(CreateSessionRequest())
      .map(_.sessionId)
      .flatMap(test)
  }
}
