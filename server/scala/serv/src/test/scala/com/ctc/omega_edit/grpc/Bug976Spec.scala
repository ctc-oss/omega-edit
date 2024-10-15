/*
 * Copyright 2024 Concurrent Technologies Corporation
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

import com.google.protobuf.ByteString
import omega_edit.ChangeKind.CHANGE_INSERT
import omega_edit._
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.Sink
import org.scalatest.OptionValues
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AsyncWordSpecLike

import scala.concurrent.duration.DurationInt

class Bug976Spec extends AsyncWordSpecLike with Matchers with OptionValues with EditorServiceSupport {
  "GitHub issue 976" should useService { implicit svc =>
    val requested_vid = "my_viewport"
    implicit val mat = Materializer.matFromSystem(svc.system)

    "validate vid on viewport events and unsubs" in {
      for {
        s <- svc.createSession(CreateSessionRequest.defaultInstance)
        sid = s.sessionId
        v <- svc.createViewport(CreateViewportRequest(s.sessionId, 1, 0, false, Some(requested_vid)))
        vid = v.viewportId
        sub = svc.subscribeToViewportEvents(EventSubscriptionRequest(vid, None))
        _ = svc.submitChange(ChangeRequest(sid, CHANGE_INSERT, 0, 1, Some(ByteString.fromHex("ff"))))
        evt <- sub.completionTimeout(1.second).runWith(Sink.headOption)
        unsub <- svc.unsubscribeToViewportEvents(ObjectId(vid))
      } yield {
        vid should startWith(sid)
        evt.value should matchPattern { case ViewportEvent(`sid`, `vid`, _, _, _, _, _, _) => }
        unsub.id shouldBe vid
        val Array(s, v) = vid.split(":")
        s shouldBe sid
        v shouldBe requested_vid
      }
    }
  }
}
