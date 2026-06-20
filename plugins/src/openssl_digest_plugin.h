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

/*
 * Implementation template for OpenSSL digest plugins. Include this file from exactly one translation unit per plugin
 * target after defining the OMEGA_DIGEST_* macros.
 */

#ifndef OMEGA_EDIT_OPENSSL_DIGEST_PLUGIN_H
#define OMEGA_EDIT_OPENSSL_DIGEST_PLUGIN_H

#include <omega_edit/transform_plugin_sdk.h>
#include <openssl/evp.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

static const int64_t OMEGA_DIGEST_DEFAULT_CHUNK_SIZE = 64 * 1024;
static const int64_t OMEGA_DIGEST_MAX_CHUNK_SIZE = 1024 * 1024;

static int64_t omega_digest_chunk_size(int64_t preferred_chunk_size) {
    if (preferred_chunk_size <= 0) { return OMEGA_DIGEST_DEFAULT_CHUNK_SIZE; }
    return preferred_chunk_size > OMEGA_DIGEST_MAX_CHUNK_SIZE ? OMEGA_DIGEST_MAX_CHUNK_SIZE : preferred_chunk_size;
}

static int omega_digest_update(EVP_MD_CTX *context_ptr, const omega_byte_t *bytes, int64_t length) {
    if (!context_ptr || length < 0 || (length > 0 && !bytes)) { return -1; }
    if (length == 0) { return 0; }
    return EVP_DigestUpdate(context_ptr, bytes, (size_t) length) == 1 ? 0 : -1;
}

static int omega_digest_update_from_request(const omega_transform_plugin_request_t *request_ptr,
                                            EVP_MD_CTX *context_ptr) {
    if (!request_ptr || !context_ptr) { return -1; }
    if (request_ptr->read) {
        const int64_t chunk_size = omega_digest_chunk_size(request_ptr->preferred_chunk_size);
        omega_byte_t *buffer = (omega_byte_t *) malloc((size_t) chunk_size);
        if (!buffer) { return -1; }
        for (int64_t position = 0; position < request_ptr->session_length;) {
            const int64_t remaining = request_ptr->session_length - position;
            const int64_t requested = remaining < chunk_size ? remaining : chunk_size;
            const int64_t bytes_read =
                    request_ptr->read(position, buffer, requested, request_ptr->reader_user_data_ptr);
            if (bytes_read <= 0 || omega_digest_update(context_ptr, buffer, bytes_read) != 0) {
                free(buffer);
                return -1;
            }
            position += bytes_read;
        }
        free(buffer);
        return 0;
    }

    return omega_digest_update(context_ptr, request_ptr->input_bytes, request_ptr->input_length);
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->id = OMEGA_DIGEST_PLUGIN_ID;
    info_ptr->name = OMEGA_DIGEST_PLUGIN_NAME;
    info_ptr->description = OMEGA_DIGEST_PLUGIN_DESCRIPTION;
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_INSPECT;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_TEXT_RESULT | OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE |
                      OMEGA_TRANSFORM_PLUGIN_FLAG_STREAMING;
    info_ptr->help = "No JSON options are used.";
    info_ptr->example = "";
    info_ptr->default_args = "";
    info_ptr->args_schema = OMEGA_TRANSFORM_PLUGIN_NO_ARGS_SCHEMA;
    info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
    return 0;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_apply(const omega_transform_plugin_request_t *request_ptr,
                                                              omega_transform_plugin_response_t *response_ptr) {
    if (!request_ptr || !response_ptr || !request_ptr->alloc || request_ptr->input_length < 0 ||
        request_ptr->session_length < 0) {
        return -1;
    }

    const EVP_MD *digest_ptr = OMEGA_DIGEST_EVP_FUNCTION();
    EVP_MD_CTX *context_ptr = EVP_MD_CTX_new();
    if (!digest_ptr || !context_ptr) {
        EVP_MD_CTX_free(context_ptr);
        return -1;
    }

    unsigned char digest[EVP_MAX_MD_SIZE];
    unsigned int digest_length = 0;
    if (EVP_DigestInit_ex(context_ptr, digest_ptr, NULL) != 1 ||
        omega_digest_update_from_request(request_ptr, context_ptr) != 0 ||
        EVP_DigestFinal_ex(context_ptr, digest, &digest_length) != 1) {
        EVP_MD_CTX_free(context_ptr);
        return -1;
    }
    EVP_MD_CTX_free(context_ptr);

    static const char hex[] = "0123456789abcdef";
    char result[(EVP_MAX_MD_SIZE * 2) + 1];
    for (unsigned int i = 0; i < digest_length; ++i) {
        result[i * 2] = hex[(digest[i] >> 4) & 0x0F];
        result[(i * 2) + 1] = hex[digest[i] & 0x0F];
    }
    result[digest_length * 2] = '\0';

    return omega_transform_plugin_sdk_set_text_result(request_ptr, response_ptr, OMEGA_DIGEST_PLUGIN_LABEL, result,
                                                      "text/plain");
}

#endif// OMEGA_EDIT_OPENSSL_DIGEST_PLUGIN_H
