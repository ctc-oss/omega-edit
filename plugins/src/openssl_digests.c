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

#include "c_plugin_options.h"

#include <omega_edit/transform_plugin_sdk.h>
#include <openssl/evp.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef const EVP_MD *(*omega_digest_evp_function_t)(void);

typedef struct omega_digest_algorithm_t {
    const char *id;
    const char *label;
    omega_digest_evp_function_t evp_function;
} omega_digest_algorithm_t;

static const int64_t OMEGA_DIGEST_DEFAULT_CHUNK_SIZE = 64 * 1024;
static const int64_t OMEGA_DIGEST_MAX_CHUNK_SIZE = 1024 * 1024;

static const omega_digest_algorithm_t OMEGA_DIGEST_ALGORITHMS[] = {
        {"md5", "md5", EVP_md5},
        {"sha1", "sha1", EVP_sha1},
        {"sha224", "sha224", EVP_sha224},
        {"sha256", "sha256", EVP_sha256},
        {"sha384", "sha384", EVP_sha384},
        {"sha512", "sha512", EVP_sha512},
        {"sha3-256", "sha3-256", EVP_sha3_256},
        {"sha3-512", "sha3-512", EVP_sha3_512},
        {"blake2b-512", "blake2b-512", EVP_blake2b512},
        {"blake2s-256", "blake2s-256", EVP_blake2s256},
};

static const char DIGEST_ARGS_SCHEMA[] =
        "{\"type\":\"object\",\"properties\":{\"algorithm\":{\"type\":\"string\",\"title\":\"Algorithm\","
        "\"description\":\"OpenSSL digest algorithm to calculate.\",\"default\":\"sha256\","
        "\"enum\":[\"md5\",\"sha1\",\"sha224\",\"sha256\",\"sha384\",\"sha512\",\"sha3-256\","
        "\"sha3-512\",\"blake2b-512\",\"blake2s-256\"],\"x-omega-enumGroups\":[{\"label\":\"Legacy\","
        "\"values\":[\"md5\",\"sha1\"]},{\"label\":\"SHA-2\",\"values\":[\"sha224\",\"sha256\","
        "\"sha384\",\"sha512\"]},{\"label\":\"SHA-3\",\"values\":[\"sha3-256\",\"sha3-512\"]},"
        "{\"label\":\"BLAKE2\",\"values\":[\"blake2b-512\",\"blake2s-256\"]}]}},"
        "\"additionalProperties\":false}";

static const omega_digest_algorithm_t *digest_find_algorithm(const char *algorithm) {
    if (!algorithm) { return NULL; }
    const size_t count = sizeof(OMEGA_DIGEST_ALGORITHMS) / sizeof(OMEGA_DIGEST_ALGORITHMS[0]);
    for (size_t i = 0; i < count; ++i) {
        if (strcmp(OMEGA_DIGEST_ALGORITHMS[i].id, algorithm) == 0) { return &OMEGA_DIGEST_ALGORITHMS[i]; }
    }
    return NULL;
}

static int digest_parse_options(const char *options_json, const omega_digest_algorithm_t **algorithm_out) {
    if (!algorithm_out) { return -1; }
    *algorithm_out = digest_find_algorithm("sha256");
    if (!*algorithm_out) { return -1; }
    if (!options_json || !*options_json) { return 0; }

    const char *cursor = options_json;
    omega_plugin_json_skip_ws(&cursor);
    if (*cursor != '{') { return -1; }
    ++cursor;
    omega_plugin_json_skip_ws(&cursor);
    if (*cursor == '}') {
        ++cursor;
        omega_plugin_json_skip_ws(&cursor);
        return *cursor == '\0' ? 0 : -1;
    }

    char key[32];
    if (omega_plugin_json_parse_string(&cursor, key, sizeof(key)) != 0 || strcmp(key, "algorithm") != 0) { return -1; }
    omega_plugin_json_skip_ws(&cursor);
    if (*cursor != ':') { return -1; }
    ++cursor;
    omega_plugin_json_skip_ws(&cursor);

    char algorithm[32];
    if (omega_plugin_json_parse_string(&cursor, algorithm, sizeof(algorithm)) != 0) { return -1; }
    *algorithm_out = digest_find_algorithm(algorithm);
    if (!*algorithm_out) { return -1; }

    omega_plugin_json_skip_ws(&cursor);
    if (*cursor != '}') { return -1; }
    ++cursor;
    omega_plugin_json_skip_ws(&cursor);
    return *cursor == '\0' ? 0 : -1;
}

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
            if (omega_transform_plugin_sdk_is_cancelled(request_ptr)) {
                free(buffer);
                return -1;
            }
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

    if (omega_transform_plugin_sdk_is_cancelled(request_ptr)) { return -1; }
    return omega_digest_update(context_ptr, request_ptr->input_bytes, request_ptr->input_length);
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->id = "omega.example.openssl_digests";
    info_ptr->name = "OpenSSL Digests";
    info_ptr->description = "Calculate MD5, SHA, SHA-3, or BLAKE2 digests over the selected range.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_INSPECT;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_TEXT_RESULT | OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE |
                      OMEGA_TRANSFORM_PLUGIN_FLAG_STREAMING;
    info_ptr->help = "Choose a digest algorithm. MD5 and SHA-1 are included for legacy inspection workflows.";
    info_ptr->example = "{\"algorithm\":\"sha256\"}";
    info_ptr->default_args = "{\"algorithm\":\"sha256\"}";
    info_ptr->args_schema = DIGEST_ARGS_SCHEMA;
    info_ptr->support = OMEGA_TRANSFORM_PLUGIN_SUPPORT_PRODUCTION;
    info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
    return 0;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_apply(const omega_transform_plugin_request_t *request_ptr,
                                                               omega_transform_plugin_response_t *response_ptr) {
    if (!request_ptr || !response_ptr || !request_ptr->alloc || request_ptr->input_length < 0 ||
        request_ptr->session_length < 0) {
        return -1;
    }

    const omega_digest_algorithm_t *algorithm = NULL;
    if (digest_parse_options(request_ptr->options_json, &algorithm) != 0) { return -1; }

    const EVP_MD *digest_ptr = algorithm->evp_function();
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

    return omega_transform_plugin_sdk_set_text_result(request_ptr, response_ptr, algorithm->label, result,
                                                      "text/plain");
}
