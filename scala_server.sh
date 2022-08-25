#!/usr/bin/env bash
set -ex
########################################################################################################################
# Copyright (c) 2021 Concurrent Technologies Corporation.                                                              #
#                                                                                                                      #
# Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance       #
# with the License.  You may obtain a copy of the License at                                                           #
#                                                                                                                      #
#     http://www.apache.org/licenses/LICENSE-2.0                                                                       #
#                                                                                                                      #
# Unless required by applicable law or agreed to in writing, software is distributed under the License is              #
# distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or                     #
# implied.  See the License for the specific language governing permissions and limitations under the License.         #
#                                                                                                                      #
########################################################################################################################

function build_api {
    m2OrLocal=${1:-"m2"}

    if [[ $m2OrLocal == "m2" ]]; then
        sbt installM2
    else
        sbt installLocal
    fi
}

function serv {
    currentDir=${PWD}
    cd src/rpc/server/scala && sbt run
}

function serv_build {
    build_api $1
    serv
}

$@
