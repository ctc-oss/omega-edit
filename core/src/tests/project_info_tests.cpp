/**********************************************************************************************************************
 * Copyright (c) 2021 Concurrent Technologies Corporation.                                                            *
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

#include "omega_edit/license.h"
#include "omega_edit/version.h"

#include <test_util.hpp>

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_contains.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

using Catch::Matchers::Contains;
using Catch::Matchers::EndsWith;
using Catch::Matchers::Equals;

TEST_CASE("Version check", "[VersionCheck]") {
    const auto major = omega_version_major();
    const auto minor = omega_version_minor();
    const auto patch = omega_version_patch();
    const auto version = (major << 24) + (minor << 16) + patch;
    REQUIRE(0 < omega_version());
    REQUIRE(version == omega_version());
    REQUIRE(major == ((omega_version() >> 24) & 0xFF));
    REQUIRE(minor == ((omega_version() >> 16) & 0xFF));
    REQUIRE(patch == (omega_version() & 0xFF));
    const auto libtype = omega_libtype();
    REQUIRE(((strcmp("static", libtype) == 0) || (strcmp("shared", libtype) == 0)));
}

TEST_CASE("License check", "[LicenseCheck]") {
    const auto license = omega_license_get();
    REQUIRE(license);
    REQUIRE(strlen(license) == 576);
    REQUIRE(strstr(license, "Concurrent Technologies Corporation"));
}