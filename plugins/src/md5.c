/**********************************************************************************************************************
 * Copyright (c) 2021 Concurrent Technologies Corporation.                                                            *
 *                                                                                                                    *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance     *
 * with the License.  You may obtain a copy of the License at                                                         *
 *                                                                                                                    *
 *     http://www.apache.org/licenses/LICENSE-2.0                                                                     *
 *                                                                                                                    *
 * Unless required by applicable law or agreed to in writing, software is distributed on an "AS IS" BASIS, WITHOUT    *
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.  See the License for the specific language         *
 * governing permissions and limitations under the License.                                                           *
 *                                                                                                                    *
 **********************************************************************************************************************/

#include <openssl/evp.h>

#define OMEGA_DIGEST_PLUGIN_ID "omega.example.md5"
#define OMEGA_DIGEST_PLUGIN_NAME "MD5"
#define OMEGA_DIGEST_PLUGIN_DESCRIPTION "Calculate an MD5 digest over the selected range."
#define OMEGA_DIGEST_PLUGIN_LABEL "md5"
#define OMEGA_DIGEST_EVP_FUNCTION EVP_md5

#include "openssl_digest_plugin.h"
