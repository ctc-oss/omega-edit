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

import java.nio.file.{Files, Path}
import java.util.UUID
import scala.collection.immutable.ArraySeq
import scala.concurrent.Future
import scala.concurrent.duration._
import scala.io.Source
import scala.util.Using

/** This unit test is more for demonstration of the testability of the gRPC
  * components than actual coverage
  */
class ExampleSpec
    extends AsyncWordSpecLike
    with Matchers
    with EditorServiceSupport {
  val tmp: Path = Files.createTempDirectory("omega")
  tmp.toFile.deleteOnExit()

  "client" should useService { implicit service =>
    "get version" in service.getVersion(Empty()).map { v =>
      v should matchPattern { case VersionResponse(_, _, _, _) => }
    }

    "have zero sessions when initialized" in service
      .getSessionCount(Empty())
      .map { case SessionCountResponse(count, _) =>
        count should be(0)
      }

    "create session" in service
      .createSession(CreateSessionRequest.defaultInstance)
      .map { v =>
        v.sessionId shouldNot be(empty)
      }

    "have one session counted after creation" in service
      .getSessionCount(Empty())
      .map { case SessionCountResponse(count, _) =>
        count should be(1)
      }

    "create and destroy sessions" in newSession { _ =>
      for {
        sessionCount1 <- service.getSessionCount(Empty())
        sessionResponse2 <- service.createSession(
          CreateSessionRequest(None, Some("session_3"))
        )
        sessionCount2 <- service.getSessionCount(Empty())
        sessionResponse3 <- service.createSession(
          CreateSessionRequest(None, Some("session_4"))
        )
        sessionResponse4 <- service.createSession(
          CreateSessionRequest(None, Some("session_5"))
        )
        sessionCount3 <- service.getSessionCount(Empty())
        destroyedSession1 <- service.destroySession(ObjectId("session_4"))
        sessionCount4 <- service.getSessionCount(Empty())
        destroyedSession2 <- service.destroySession(ObjectId("session_3"))
        sessionCount5 <- service.getSessionCount(Empty())
        destroyedSession3 <- service.destroySession(ObjectId("session_5"))
        sessionCount6 <- service.getSessionCount(Empty())
      } yield {
        sessionCount1.count shouldBe 2L
        sessionResponse2.sessionId shouldBe "session_3"
        sessionCount2.count shouldBe 3L
        sessionResponse3.sessionId shouldBe "session_4"
        sessionResponse4.sessionId shouldBe "session_5"
        sessionCount3.count shouldBe 5L
        destroyedSession1.id shouldBe "session_4"
        sessionCount4.count shouldBe 4L
        destroyedSession2.id shouldBe "session_3"
        sessionCount5.count shouldBe 3L
        destroyedSession3.id shouldBe "session_5"
        sessionCount6.count shouldBe 2L
      }
    }

    "profile session data" in newSession { sid =>
      val testString =
        ByteString.copyFromUtf8("5555544443332210122333444455555")
      val len = testString.size()
      val expectedProfile = ArraySeq(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 4, 6, 8, 10, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0)
      for {
        _ <- service.submitChange(
          ChangeRequest(
            sid,
            ChangeKind.CHANGE_INSERT,
            offset = 0,
            length = len.toLong,
            data = Some(testString)
          )
        )
        profileResponse <- service.getByteFrequencyProfile(
          ByteFrequencyProfileRequest(sid, offset = None, length = None)
        )
      } yield profileResponse should matchPattern {
        case ByteFrequencyProfileResponse(
              `sid`,
              0,
              `len`,
              `expectedProfile`,
              _
            ) =>
      }
    }

    "update session data" in newSession { sid =>
      val testString = ByteString.copyFromUtf8(UUID.randomUUID().toString)
      for {
        sizeBefore <- service
          .getComputedFileSize(ObjectId(sid))
          .map(_.computedFileSize)
        changeResponse <- service.submitChange(
          ChangeRequest(
            sid,
            ChangeKind.CHANGE_INSERT,
            offset = 0,
            length = testString.size.toLong,
            data = Some(testString)
          )
        )
        sizeAfter <- service
          .getComputedFileSize(ObjectId(sid))
          .map(_.computedFileSize)
      } yield {
        sizeBefore shouldBe 0
        changeResponse should matchPattern { case ChangeResponse(`sid`, _, _) =>
        }
        sizeAfter shouldBe testString.size
      }
    }

    "listen to session events" in newSession { sid =>
      import service.system

      val testString = ByteString.copyFromUtf8(UUID.randomUUID().toString)
      val events = service
        .subscribeToSessionEvents(
          EventSubscriptionRequest(sid, None)
        ) // None implies subscribe to all
        .idleTimeout(1.second)
        .runWith(Sink.headOption)

      for {
        _ <- service.submitChange(
          ChangeRequest(
            sid,
            ChangeKind.CHANGE_INSERT,
            offset = 0,
            length = testString.size.toLong,
            data = Some(testString)
          )
        )
        res <- events
      } yield res match {
        case Some(e) =>
          e should matchPattern { case SessionEvent(`sid`, _, _, _, _, _, _) =>
          }
        case None => fail("no message received")
      }
    }

    "save session" in newSession { sid =>
      val testString = UUID.randomUUID().toString
      for {
        _ <- service.submitChange(
          ChangeRequest(
            sid,
            ChangeKind.CHANGE_INSERT,
            offset = 0,
            length = testString.length.toLong,
            data = Some(ByteString.copyFromUtf8(testString))
          )
        )
        saveResponse <- service.saveSession(
          SaveSessionRequest(
            sid,
            filePath = tmp.resolve("dat.txt").toString,
            allowOverwrite = None
          )
        )
        contents = Using(Source.fromFile(saveResponse.filePath))(source =>
          source.mkString
        ).get
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
          ChangeRequest(
            sid,
            ChangeKind.CHANGE_INSERT,
            offset = 0,
            length = testString1.length.toLong,
            data = Some(ByteString.copyFromUtf8(testString1))
          )
        )
        saveResponse1 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = None)
        )

        _ <- service.submitChange(
          ChangeRequest(
            sid,
            ChangeKind.CHANGE_OVERWRITE,
            offset = 0,
            length = testString2.length.toLong,
            data = Some(ByteString.copyFromUtf8(testString2))
          )
        )
        saveResponse2 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = Some(false))
        )

        // to ensure first saved file not overwritten
        contents1 = Using(Source.fromFile(saveResponse1.filePath))(source =>
          source.mkString
        ).get
        contents2 = Using(Source.fromFile(saveResponse2.filePath))(source =>
          source.mkString
        ).get
      } yield {
        saveResponse2.filePath should not be saveResponse1.filePath
        contents1 shouldBe testString1
        contents2 shouldBe testString2
      }
    }

    "redo last undo" in newSession { sid =>
      val testString1 = UUID.randomUUID().toString
      val testString2 = UUID.randomUUID().toString

      val filePath = tmp.resolve("dat.txt").toString

      for {
        _ <- service.submitChange(
          ChangeRequest(
            sid,
            ChangeKind.CHANGE_INSERT,
            offset = 0,
            length = testString1.length.toLong,
            data = Some(ByteString.copyFromUtf8(testString1))
          )
        )

        saveResponse1 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = None)
        )

        _ <- service.submitChange(
          ChangeRequest(
            sid,
            ChangeKind.CHANGE_OVERWRITE,
            offset = 0,
            length = testString2.length.toLong,
            data = Some(ByteString.copyFromUtf8(testString2))
          )
        )

        saveResponse2 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = Some(false))
        )

        _ <- service.undoLastChange(ObjectId(sid))

        saveResponse3 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = Some(false))
        )

        _ <- service.redoLastUndo(ObjectId(sid))
        saveResponse4 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = Some(false))
        )

        // to ensure first saved file not overwritten
        contents1 = Using(Source.fromFile(saveResponse1.filePath))(source =>
          source.mkString
        ).get
        contents2 = Using(Source.fromFile(saveResponse2.filePath))(source =>
          source.mkString
        ).get
        contents3 = Using(Source.fromFile(saveResponse3.filePath))(source =>
          source.mkString
        ).get
        contents4 = Using(Source.fromFile(saveResponse4.filePath))(source =>
          source.mkString
        ).get
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
          ChangeRequest(
            sid,
            ChangeKind.CHANGE_INSERT,
            offset = 0,
            length = testString1.length.toLong,
            data = Some(ByteString.copyFromUtf8(testString1))
          )
        )
        saveResponse1 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = None)
        )

        _ <- service.submitChange(
          ChangeRequest(
            sid,
            ChangeKind.CHANGE_OVERWRITE,
            offset = 0,
            length = testString2.length.toLong,
            data = Some(ByteString.copyFromUtf8(testString2))
          )
        )
        saveResponse2 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = Some(false))
        )

        getBeforeChangeCount <- service
          .getCount(CountRequest(sid, CountKind.COUNT_CHANGES))
          .map(_.count)

        _ <- service.clearChanges(ObjectId(sid))

        getAfterChangeCount <- service
          .getCount(CountRequest(sid, CountKind.COUNT_CHANGES))
          .map(_.count)

        getNumChangeTransactions <- service
          .getCount(CountRequest(sid, CountKind.COUNT_CHANGE_TRANSACTIONS))
          .map(_.count)

        getNumUndoTransactions <- service
          .getCount(CountRequest(sid, CountKind.COUNT_UNDO_TRANSACTIONS))
          .map(_.count)

        // to ensure first saved file not overwritten
        contents1 = Using(Source.fromFile(saveResponse1.filePath))(source =>
          source.mkString
        ).get
        contents2 = Using(Source.fromFile(saveResponse2.filePath))(source =>
          source.mkString
        ).get
      } yield {
        saveResponse2.filePath should not be saveResponse1.filePath
        contents1 shouldBe testString1
        contents2 shouldBe testString2
        getBeforeChangeCount should not be 0
        getAfterChangeCount should be(0)
        getNumChangeTransactions should be(0)
        getNumUndoTransactions should be(0)
      }
    }

    "get last change" in newSession { sid =>
      val testString1 = UUID.randomUUID().toString
      val testString2 = UUID.randomUUID().toString

      val filePath = tmp.resolve("dat.txt").toString

      for {
        _ <- service.submitChange(
          ChangeRequest(
            sid,
            ChangeKind.CHANGE_INSERT,
            offset = 0,
            length = testString1.length.toLong,
            data = Some(ByteString.copyFromUtf8(testString1))
          )
        )
        saveResponse1 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = None)
        )

        _ <- service.submitChange(
          ChangeRequest(
            sid,
            ChangeKind.CHANGE_OVERWRITE,
            offset = 0,
            length = testString2.length.toLong,
            data = Some(ByteString.copyFromUtf8(testString2))
          )
        )
        saveResponse2 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = Some(false))
        )

        _ <- service.getLastChange(ObjectId(sid))
        saveResponse3 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = Some(false))
        )

        // to ensure first saved file not overwritten
        contents1 = Using(Source.fromFile(saveResponse1.filePath))(source =>
          source.mkString
        ).get
        contents2 = Using(Source.fromFile(saveResponse2.filePath))(source =>
          source.mkString
        ).get
        contents3 = Using(Source.fromFile(saveResponse3.filePath))(source =>
          source.mkString
        ).get
      } yield {
        saveResponse2.filePath should not be saveResponse1.filePath
        contents1 shouldBe testString1
        contents2 shouldBe testString2
        contents3 shouldBe testString2
      }
    }

    "get last undo" in newSession { sid =>
      val testString1 = UUID.randomUUID().toString + " change1"
      val testString2 = UUID.randomUUID().toString + " change2"
      val testString3 = UUID.randomUUID().toString + " change3"

      val filePath = tmp.resolve("dat.txt").toString

      for {
        _ <- service.submitChange(
          ChangeRequest(
            sid,
            ChangeKind.CHANGE_INSERT,
            offset = 0,
            length = testString1.length.toLong,
            data = Some(ByteString.copyFromUtf8(testString1))
          )
        )
        saveResponse1 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = None)
        )

        _ <- service.submitChange(
          ChangeRequest(
            sid,
            ChangeKind.CHANGE_OVERWRITE,
            offset = 0,
            length = testString2.length.toLong,
            data = Some(ByteString.copyFromUtf8(testString2))
          )
        )
        saveResponse2 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = Some(false))
        )

        _ <- service.submitChange(
          ChangeRequest(
            sid,
            ChangeKind.CHANGE_OVERWRITE,
            offset = 0,
            length = testString3.length.toLong,
            data = Some(ByteString.copyFromUtf8(testString3))
          )
        )
        saveResponse3 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = Some(false))
        )

        _ <- service.undoLastChange(ObjectId(sid))
        saveResponse4 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = Some(false))
        )

        _ <- service.getLastUndo(ObjectId(sid))
        saveResponse5 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = Some(false))
        )

        // to ensure first saved file not overwritten
        contents1 = Using(Source.fromFile(saveResponse1.filePath))(source =>
          source.mkString
        ).get
        contents2 = Using(Source.fromFile(saveResponse2.filePath))(source =>
          source.mkString
        ).get
        contents3 = Using(Source.fromFile(saveResponse3.filePath))(source =>
          source.mkString
        ).get
        contents4 = Using(Source.fromFile(saveResponse4.filePath))(source =>
          source.mkString
        ).get
        contents5 = Using(Source.fromFile(saveResponse5.filePath))(source =>
          source.mkString
        ).get
      } yield {
        saveResponse2.filePath should not be saveResponse1.filePath
        saveResponse3.filePath should not be saveResponse2.filePath
        saveResponse3.filePath should not be saveResponse1.filePath
        contents1 shouldBe testString1
        contents2 shouldBe testString2
        contents3 shouldBe testString3
        contents4 shouldBe testString2
        contents5 shouldBe testString2
      }
    }

    "create and destroy viewports" in newSession { sid =>
      for {
        numViewports1 <- service.getCount(
          CountRequest(sid, CountKind.COUNT_VIEWPORTS)
        )
        viewportResponse1 <- service.createViewport(
          CreateViewportRequest(
            sid,
            capacity = 10,
            offset = 0,
            isFloating = false,
            viewportIdDesired = Some("viewport_1")
          )
        )
        viewport1HasChanges <- service.viewportHasChanges(
          ObjectId(viewportResponse1.viewportId)
        )
        numViewports2 <- service.getCount(
          CountRequest(sid, CountKind.COUNT_VIEWPORTS)
        )
        viewportResponse2 <- service.createViewport(
          CreateViewportRequest(
            sid,
            capacity = 10,
            offset = 10,
            isFloating = false,
            viewportIdDesired = Some("viewport_2")
          )
        )
        // get data to clear the "has changes" state for this viewport
        viewportDataResponse <- service.getViewportData(
          ViewportDataRequest(viewportResponse2.viewportId)
        )
        viewport2HasChanges <- service.viewportHasChanges(
          ObjectId(viewportResponse2.viewportId)
        )
        viewportResponse3 <- service.createViewport(
          CreateViewportRequest(
            sid,
            capacity = 10,
            offset = 20,
            isFloating = false,
            viewportIdDesired = Some("viewport_3")
          )
        )
        viewportResponse4 <- service.createViewport(
          CreateViewportRequest(
            sid,
            capacity = 10,
            offset = 30,
            isFloating = false,
            viewportIdDesired = Some("viewport_4")
          )
        )
        numViewports3 <- service.getCount(
          CountRequest(sid, CountKind.COUNT_VIEWPORTS)
        )
        destroyedViewport <- service.destroyViewport(
          ObjectId(viewportResponse2.viewportId)
        )
        numViewports4 <- service.getCount(
          CountRequest(sid, CountKind.COUNT_VIEWPORTS)
        )
      } yield {
        numViewports1.sessionId shouldBe sid
        numViewports1.kind shouldBe CountKind.COUNT_VIEWPORTS
        numViewports1.count shouldBe 0L
        viewportResponse1.viewportId shouldBe sid + ":viewport_1"
        viewportDataResponse.data shouldBe ByteString.EMPTY
        viewportDataResponse.offset shouldBe 10L
        viewportDataResponse.length shouldBe 0L
        viewportDataResponse.followingByteCount shouldBe -10L
        viewportDataResponse.viewportId shouldBe viewportResponse2.viewportId
        viewport1HasChanges.response shouldBe false
        viewport2HasChanges.response shouldBe false
        numViewports2.sessionId shouldBe sid
        numViewports2.kind shouldBe CountKind.COUNT_VIEWPORTS
        numViewports2.count shouldBe 1L
        viewportResponse2.viewportId shouldBe sid + ":viewport_2"
        viewportResponse3.viewportId shouldBe sid + ":viewport_3"
        viewportResponse4.viewportId shouldBe sid + ":viewport_4"
        numViewports3.count shouldBe 4L
        destroyedViewport.id shouldBe sid + ":viewport_2"
        numViewports4.count shouldBe 3L
      }
    }

    "pause session changes" in newSession { sid =>
      val testString1 = UUID.randomUUID().toString + " change1"
      val testString2 = UUID.randomUUID().toString + " change2"

      val filePath = tmp.resolve("dat.txt").toString

      for {
        changeId <- service.submitChange(
          ChangeRequest(
            sid,
            ChangeKind.CHANGE_INSERT,
            offset = 0,
            length = testString1.length.toLong,
            data = Some(ByteString.copyFromUtf8(testString1))
          )
        )

        saveResponse1 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = None)
        )

        pausedSid <- service.pauseSessionChanges(ObjectId(sid))

        pausedChangeId <- service.submitChange(
          ChangeRequest(
            sid,
            ChangeKind.CHANGE_INSERT,
            offset = 0,
            length = testString2.length.toLong,
            data = Some(ByteString.copyFromUtf8(testString2))
          )
        )

        saveResponse2 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = None)
        )

        // to ensure first saved file not overwritten
        contents1 = Using(Source.fromFile(saveResponse1.filePath))(source =>
          source.mkString
        ).get
        contents2 = Using(Source.fromFile(saveResponse2.filePath))(source =>
          source.mkString
        ).get
      } yield {
        pausedSid.id shouldBe sid
        changeId.serial shouldBe 1L
        pausedChangeId.serial shouldBe 0L
        contents1 shouldBe testString1
        contents2 shouldBe testString1
      }
    }

    "resume session changes" in newSession { sid =>
      val testString1 = UUID.randomUUID().toString

      val filePath = tmp.resolve("dat.txt").toString

      for {
        _ <- service.resumeSessionChanges(ObjectId(sid))

        _ <- service.submitChange(
          ChangeRequest(
            sid,
            ChangeKind.CHANGE_INSERT,
            offset = 0,
            length = testString1.length.toLong,
            data = Some(ByteString.copyFromUtf8(testString1))
          )
        )

        saveResponse1 <- service.saveSession(
          SaveSessionRequest(sid, filePath, allowOverwrite = None)
        )

        // to ensure first saved file not overwritten
        contents1 = Using(Source.fromFile(saveResponse1.filePath))(source =>
          source.mkString
        ).get
      } yield {
        contents1 shouldBe testString1
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
      .createSession(
        CreateSessionRequest(
          filePath = None,
          sessionIdDesired = None
        )
      )
      .map(_.sessionId)
      .flatMap(test)
  }
}
