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

import omega_edit._
import org.scalatest.OptionValues
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AsyncWordSpecLike
import java.nio.file.Files
import java.nio.charset.StandardCharsets

class EmojiInFilename extends AsyncWordSpecLike with Matchers with OptionValues with EditorServiceSupport {
  "client" should useService { implicit service =>
    val tmp = Files.createTempDirectory("omega").toRealPath()
    tmp.toFile.deleteOnExit()

    "should allow emojis in filename" in {
      // Skip this test on windows as currently omega-edit does not support emojis in filenames on windows
      assume(!isWindows, "Skipping emoji filename test on Windows")

      val tempFile = Files.createTempFile(tmp, "emoji_😊", ".txt")
      val content = "Test emoji in filename 😊"

      Files.write(tempFile, content.getBytes(StandardCharsets.UTF_8))

      val req = CreateSessionRequest(filePath = Some(tempFile.toString()), sessionIdDesired = None, None)

      service.createSession(req).map { s =>
        assert(s.sessionId.nonEmpty, "Session ID should not be empty")
      }
    }
  }

  private def isWindows: Boolean =
    System.getProperty("os.name").toLowerCase.contains("windows")
}
