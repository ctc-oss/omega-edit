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

import com.ctc.omega_edit.api.{OmegaEdit, Version}
import com.ctc.omega_edit.support.TestSupport
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.util.Success

class OmegaEditEntrypointSpec
    extends AnyWordSpec
    with Matchers
    with TestSupport {
  "entrypoint" should {
    "initialize" in {
      OmegaEdit.initialize() should matchPattern {
        case Success(Version(_, _, _)) =>
      }
    }

    "provide version" in {
      OmegaEdit.version() should matchPattern { case Version(_, _, _) => }
    }

    "provide session" in {
      OmegaEdit.newSession(None).size shouldBe 0
    }
  }
}
