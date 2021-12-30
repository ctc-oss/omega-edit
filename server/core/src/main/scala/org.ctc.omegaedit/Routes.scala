/**********************************************************************************************************************
 * Copyright (c) 2021-2022 Concurrent Technologies Corporation.                                                       *
 *                                                                                                                    *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance     *
 * with the License.  You may obtain a copy of the License at                                                         *
 *                                                                                                                    *
 *     http://www.apache.org/licenses/LICENSE-2.0                                                                     *
 *                                                                                                                    *
 * Unless required by applicable law or agreed to in writing, software is distributed under the License is            *
 * distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or                   *
 * implied.  See the License for the specific language governing permissions and limitations under the License.       *
 *                                                                                                                    *
 **********************************************************************************************************************/

package org.ctc.omegaedit

import akka.http.scaladsl.model._
import akka.http.scaladsl.server.Directives._
import org.ctc.omegaedit.OmegaEdit._

object Routes {
  // Method to define API endpoints
  def getRoutes = {
    concat(
      path("") {
        get {
          complete(HttpEntity(ContentTypes.`text/html(UTF-8)`, "<h1>Homepage</h1>"))
        }
      },
      path("omega_license_get") {
        get {
          complete {
            omega_edit.omega_license_get
          }
        }
      },
      path("OMEGA_VIEWPORT_CAPACITY_LIMIT_get") {
        get {
          complete {
            omega_edit.OMEGA_VIEWPORT_CAPACITY_LIMIT_get.toString
          }
        }
      },
      path("OMEGA_SEARCH_PATTERN_LENGTH_LIMIT_get") {
        get {
          complete {
            omega_edit.OMEGA_SEARCH_PATTERN_LENGTH_LIMIT_get.toString
          }
        }
      },
      path("omega_version_major") {
        get {
          complete {
            omega_edit.omega_version_major.toString
          }
        }
      },
      path("omega_version_minor") {
        get {
          complete {
            omega_edit.omega_version_minor.toString
          }
        }
      },
      path("omega_version_patch") {
        get {
          complete {
            omega_edit.omega_version_patch.toString
          }
        }
      },
      path("omega_version") {
        get {
          complete {
            omega_edit.omega_version.toString
          }
        }
      },
      path("new_SessionOnChangeDirector") {
        get {
          complete {
            omega_edit.new_SessionOnChangeDirector.toString
          }
        }
      },
      path("new_OmegaViewportOnChangeDirector") {
        get {
          complete {
            omega_edit.new_OmegaViewportOnChangeDirector.toString
          }
        }
      }
    )
  } 
}