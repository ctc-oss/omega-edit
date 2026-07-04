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

#include <ctype.h>
#include <limits.h>
#include <omega_edit/transform_plugin_sdk.h>
#include <openssl/evp.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef const EVP_CIPHER *(*omega_cipher_evp_function_t)(void);

typedef enum omega_cipher_action_t { OMEGA_CIPHER_ENCRYPT, OMEGA_CIPHER_DECRYPT } omega_cipher_action_t;

typedef struct omega_cipher_algorithm_t {
    const char *id;
    const char *label;
    size_t key_length;
    size_t iv_length;
    int uses_padding;
    omega_cipher_evp_function_t evp_function;
} omega_cipher_algorithm_t;

typedef struct omega_cipher_options_t {
    omega_cipher_action_t action;
    const omega_cipher_algorithm_t *algorithm;
    omega_byte_t key[32];
    size_t key_length;
    omega_byte_t iv[16];
    size_t iv_length;
    int padding;
} omega_cipher_options_t;

static const size_t OMEGA_CIPHER_CHUNK_SIZE = 1024 * 1024;

static const omega_cipher_algorithm_t OMEGA_CIPHER_ALGORITHMS[] = {
        {"aes-128-cbc", "aes-128-cbc", 16, 16, 1, EVP_aes_128_cbc},
        {"aes-192-cbc", "aes-192-cbc", 24, 16, 1, EVP_aes_192_cbc},
        {"aes-256-cbc", "aes-256-cbc", 32, 16, 1, EVP_aes_256_cbc},
        {"aes-128-ctr", "aes-128-ctr", 16, 16, 0, EVP_aes_128_ctr},
        {"aes-192-ctr", "aes-192-ctr", 24, 16, 0, EVP_aes_192_ctr},
        {"aes-256-ctr", "aes-256-ctr", 32, 16, 0, EVP_aes_256_ctr},
};

static const char CIPHER_ARGS_SCHEMA[] =
        "{\"type\":\"object\",\"required\":[\"action\",\"algorithm\",\"keyHex\",\"ivHex\"],"
        "\"oneOf\":[{\"type\":\"object\",\"properties\":{\"algorithm\":{\"enum\":[\"aes-128-cbc\",\"aes-128-ctr\"]},"
        "\"keyHex\":{\"pattern\":\"^[0-9A-Fa-f]{32}$\"},\"ivHex\":{\"pattern\":\"^[0-9A-Fa-f]{32}$\"}}},"
        "{\"type\":\"object\",\"properties\":{\"algorithm\":{\"enum\":[\"aes-192-cbc\",\"aes-192-ctr\"]},"
        "\"keyHex\":{\"pattern\":\"^[0-9A-Fa-f]{48}$\"},\"ivHex\":{\"pattern\":\"^[0-9A-Fa-f]{32}$\"}}},"
        "{\"type\":\"object\",\"properties\":{\"algorithm\":{\"enum\":[\"aes-256-cbc\",\"aes-256-ctr\"]},"
        "\"keyHex\":{\"pattern\":\"^[0-9A-Fa-f]{64}$\"},\"ivHex\":{\"pattern\":\"^[0-9A-Fa-f]{32}$\"}}}],"
        "\"properties\":{\"action\":{\"type\":\"string\",\"title\":\"Action\","
        "\"description\":\"Encrypt or decrypt the selected bytes.\",\"default\":\"encrypt\","
        "\"enum\":[\"encrypt\",\"decrypt\"]},\"algorithm\":{\"type\":\"string\",\"title\":\"Algorithm\","
        "\"description\":\"AES cipher and mode. CBC can pad; CTR preserves byte length.\","
        "\"default\":\"aes-256-ctr\",\"enum\":[\"aes-128-cbc\",\"aes-192-cbc\",\"aes-256-cbc\","
        "\"aes-128-ctr\",\"aes-192-ctr\",\"aes-256-ctr\"],\"x-omega-enumGroups\":[{\"label\":\"AES-CBC\","
        "\"values\":[\"aes-128-cbc\",\"aes-192-cbc\",\"aes-256-cbc\"]},{\"label\":\"AES-CTR\","
        "\"values\":[\"aes-128-ctr\",\"aes-192-ctr\",\"aes-256-ctr\"]}]},\"keyHex\":{\"type\":\"string\","
        "\"title\":\"Key hex\",\"description\":\"Raw key bytes as hex: 16 bytes for AES-128, 24 for AES-192, "
        "or 32 for AES-256.\",\"pattern\":\"^([0-9A-Fa-f][0-9A-Fa-f])+$\"},\"ivHex\":{\"type\":\"string\","
        "\"title\":\"IV hex\",\"description\":\"Raw IV/counter bytes as hex. AES-CBC and AES-CTR use 16 bytes.\","
        "\"pattern\":\"^([0-9A-Fa-f][0-9A-Fa-f])+$\"},\"padding\":{\"type\":\"boolean\",\"title\":\"CBC padding\","
        "\"description\":\"Use PKCS#7 padding for CBC encryption/decryption. Ignored by CTR.\",\"default\":true}},"
        "\"additionalProperties\":false}";

static void cipher_skip_ws(const char **cursor) {
    while (cursor && *cursor && isspace((unsigned char) **cursor)) { ++(*cursor); }
}

static int cipher_parse_json_string(const char **cursor, char *out, size_t out_size) {
    if (!cursor || !*cursor || **cursor != '"' || out_size == 0) { return -1; }
    ++(*cursor);
    size_t length = 0;
    while (**cursor && **cursor != '"') {
        char ch = **cursor;
        if (ch == '\\') {
            ++(*cursor);
            if (!**cursor) { return -1; }
            ch = **cursor;
        }
        if (length + 1 >= out_size) { return -1; }
        out[length++] = ch;
        ++(*cursor);
    }
    if (**cursor != '"') { return -1; }
    ++(*cursor);
    out[length] = '\0';
    return 0;
}

static int cipher_parse_boolean(const char **cursor, int *value_out) {
    if (!cursor || !*cursor || !value_out) { return -1; }
    if (strncmp(*cursor, "true", 4) == 0) {
        *cursor += 4;
        *value_out = 1;
        return 0;
    }
    if (strncmp(*cursor, "false", 5) == 0) {
        *cursor += 5;
        *value_out = 0;
        return 0;
    }
    return -1;
}

static int cipher_hex_value(char ch) {
    if (ch >= '0' && ch <= '9') { return ch - '0'; }
    if (ch >= 'a' && ch <= 'f') { return 10 + ch - 'a'; }
    if (ch >= 'A' && ch <= 'F') { return 10 + ch - 'A'; }
    return -1;
}

static int cipher_parse_hex_bytes(const char *value, omega_byte_t *out, size_t out_capacity, size_t *length_out) {
    if (!value || !out || !length_out) { return -1; }
    const size_t hex_length = strlen(value);
    if (hex_length == 0 || (hex_length % 2) != 0) { return -1; }
    const size_t byte_length = hex_length / 2;
    if (byte_length > out_capacity) { return -1; }

    for (size_t index = 0; index < byte_length; ++index) {
        const int high = cipher_hex_value(value[index * 2]);
        const int low = cipher_hex_value(value[(index * 2) + 1]);
        if (high < 0 || low < 0) { return -1; }
        out[index] = (omega_byte_t) ((high << 4) | low);
    }
    *length_out = byte_length;
    return 0;
}

static const omega_cipher_algorithm_t *cipher_find_algorithm(const char *algorithm) {
    if (!algorithm) { return NULL; }
    const size_t count = sizeof(OMEGA_CIPHER_ALGORITHMS) / sizeof(OMEGA_CIPHER_ALGORITHMS[0]);
    for (size_t i = 0; i < count; ++i) {
        if (strcmp(OMEGA_CIPHER_ALGORITHMS[i].id, algorithm) == 0) { return &OMEGA_CIPHER_ALGORITHMS[i]; }
    }
    return NULL;
}

static int cipher_parse_action_text(const char *value, omega_cipher_action_t *action_out) {
    if (!value || !action_out) { return -1; }
    if (strcmp(value, "encrypt") == 0) {
        *action_out = OMEGA_CIPHER_ENCRYPT;
        return 0;
    }
    if (strcmp(value, "decrypt") == 0) {
        *action_out = OMEGA_CIPHER_DECRYPT;
        return 0;
    }
    return -1;
}

static int cipher_parse_options(const char *options_json, omega_cipher_options_t *options_out) {
    if (!options_out || !options_json || !*options_json) { return -1; }
    memset(options_out, 0, sizeof(*options_out));
    options_out->action = OMEGA_CIPHER_ENCRYPT;
    options_out->padding = 1;

    int saw_action = 0;
    int saw_algorithm = 0;
    int saw_key = 0;
    int saw_iv = 0;

    const char *cursor = options_json;
    cipher_skip_ws(&cursor);
    if (*cursor != '{') { return -1; }
    ++cursor;
    cipher_skip_ws(&cursor);

    while (*cursor && *cursor != '}') {
        char key[32];
        if (cipher_parse_json_string(&cursor, key, sizeof(key)) != 0) { return -1; }
        cipher_skip_ws(&cursor);
        if (*cursor != ':') { return -1; }
        ++cursor;
        cipher_skip_ws(&cursor);

        if (strcmp(key, "action") == 0) {
            char action[16];
            if (cipher_parse_json_string(&cursor, action, sizeof(action)) != 0 ||
                cipher_parse_action_text(action, &options_out->action) != 0) {
                return -1;
            }
            saw_action = 1;
        } else if (strcmp(key, "algorithm") == 0) {
            char algorithm[32];
            if (cipher_parse_json_string(&cursor, algorithm, sizeof(algorithm)) != 0) { return -1; }
            options_out->algorithm = cipher_find_algorithm(algorithm);
            if (!options_out->algorithm) { return -1; }
            saw_algorithm = 1;
        } else if (strcmp(key, "keyHex") == 0) {
            char key_hex[96];
            if (cipher_parse_json_string(&cursor, key_hex, sizeof(key_hex)) != 0 ||
                cipher_parse_hex_bytes(key_hex, options_out->key, sizeof(options_out->key), &options_out->key_length) !=
                        0) {
                return -1;
            }
            saw_key = 1;
        } else if (strcmp(key, "ivHex") == 0) {
            char iv_hex[64];
            if (cipher_parse_json_string(&cursor, iv_hex, sizeof(iv_hex)) != 0 ||
                cipher_parse_hex_bytes(iv_hex, options_out->iv, sizeof(options_out->iv), &options_out->iv_length) !=
                        0) {
                return -1;
            }
            saw_iv = 1;
        } else if (strcmp(key, "padding") == 0) {
            if (cipher_parse_boolean(&cursor, &options_out->padding) != 0) { return -1; }
        } else {
            return -1;
        }

        cipher_skip_ws(&cursor);
        if (*cursor == '}') { break; }
        if (*cursor != ',') { return -1; }
        ++cursor;
        cipher_skip_ws(&cursor);
    }

    if (*cursor != '}') { return -1; }
    ++cursor;
    cipher_skip_ws(&cursor);
    if (*cursor != '\0' || !saw_action || !saw_algorithm || !saw_key || !saw_iv) { return -1; }
    if (options_out->key_length != options_out->algorithm->key_length ||
        options_out->iv_length != options_out->algorithm->iv_length) {
        return -1;
    }
    return 0;
}

static int cipher_transform(const omega_transform_plugin_request_t *request_ptr,
                            omega_transform_plugin_response_t *response_ptr, const omega_cipher_options_t *options) {
    if (!request_ptr || !response_ptr || !options || !options->algorithm || !request_ptr->alloc ||
        request_ptr->input_length < 0 || (request_ptr->input_length > 0 && !request_ptr->input_bytes)) {
        return -1;
    }
    if ((uint64_t) request_ptr->input_length > SIZE_MAX) { return -1; }

    const EVP_CIPHER *cipher_ptr = options->algorithm->evp_function();
    EVP_CIPHER_CTX *context_ptr = EVP_CIPHER_CTX_new();
    if (!cipher_ptr || !context_ptr) {
        EVP_CIPHER_CTX_free(context_ptr);
        return -1;
    }

    const int encrypt = options->action == OMEGA_CIPHER_ENCRYPT ? 1 : 0;
    if (EVP_CipherInit_ex(context_ptr, cipher_ptr, NULL, options->key, options->iv, encrypt) != 1) {
        EVP_CIPHER_CTX_free(context_ptr);
        return -1;
    }
    if (options->algorithm->uses_padding && EVP_CIPHER_CTX_set_padding(context_ptr, options->padding ? 1 : 0) != 1) {
        EVP_CIPHER_CTX_free(context_ptr);
        return -1;
    }

    int block_size = EVP_CIPHER_get_block_size(cipher_ptr);
    if (block_size < 1) { block_size = 1; }
    if (request_ptr->input_length > INT64_MAX - (int64_t) block_size) {
        EVP_CIPHER_CTX_free(context_ptr);
        return -1;
    }
    const size_t input_length = (size_t) request_ptr->input_length;
    if (input_length > SIZE_MAX - (size_t) block_size) {
        EVP_CIPHER_CTX_free(context_ptr);
        return -1;
    }

    const size_t output_capacity = input_length + (size_t) block_size;
    omega_byte_t *output = (omega_byte_t *) omega_transform_plugin_sdk_alloc(request_ptr, output_capacity);
    if (!output) {
        EVP_CIPHER_CTX_free(context_ptr);
        return -1;
    }

    size_t input_offset = 0;
    size_t output_offset = 0;
    while (input_offset < input_length) {
        if (omega_transform_plugin_sdk_is_cancelled(request_ptr)) {
            EVP_CIPHER_CTX_free(context_ptr);
            return -1;
        }
        size_t chunk_size = input_length - input_offset;
        if (chunk_size > OMEGA_CIPHER_CHUNK_SIZE) { chunk_size = OMEGA_CIPHER_CHUNK_SIZE; }
        if (chunk_size > INT_MAX) { chunk_size = INT_MAX; }

        int update_length = 0;
        if (EVP_CipherUpdate(context_ptr, output + output_offset, &update_length,
                             request_ptr->input_bytes + input_offset, (int) chunk_size) != 1 ||
            update_length < 0) {
            EVP_CIPHER_CTX_free(context_ptr);
            return -1;
        }
        if (output_offset > output_capacity - (size_t) update_length) {
            EVP_CIPHER_CTX_free(context_ptr);
            return -1;
        }
        output_offset += (size_t) update_length;
        input_offset += chunk_size;
    }

    int final_length = 0;
    if (omega_transform_plugin_sdk_is_cancelled(request_ptr) ||
        EVP_CipherFinal_ex(context_ptr, output + output_offset, &final_length) != 1 || final_length < 0) {
        EVP_CIPHER_CTX_free(context_ptr);
        return -1;
    }
    EVP_CIPHER_CTX_free(context_ptr);

    if (output_offset > output_capacity - (size_t) final_length) { return -1; }
    output_offset += (size_t) final_length;
    if (output_offset > (size_t) INT64_MAX) { return -1; }
    if (output_offset == 0 && request_ptr->input_length == 0) {
        return omega_transform_plugin_sdk_set_no_content_change(response_ptr);
    }

    response_ptr->replacement_bytes = output;
    response_ptr->replacement_length = (int64_t) output_offset;
    return 0;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->id = "omega.example.openssl_ciphers";
    info_ptr->name = "OpenSSL Ciphers";
    info_ptr->description = "Encrypt or decrypt selected bytes with OpenSSL EVP AES ciphers.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_EXPAND | OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_SHRINK |
                      OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
    info_ptr->help = "Provide raw hex key and IV/counter bytes. This transform does not derive keys and does not "
                     "authenticate data. CBC uses PKCS#7 padding when enabled; CTR preserves byte length.";
    info_ptr->example = "{\"action\":\"encrypt\",\"algorithm\":\"aes-128-cbc\","
                        "\"keyHex\":\"2b7e151628aed2a6abf7158809cf4f3c\","
                        "\"ivHex\":\"000102030405060708090a0b0c0d0e0f\",\"padding\":false}";
    info_ptr->default_args = "{\"action\":\"encrypt\",\"algorithm\":\"aes-256-ctr\","
                             "\"keyHex\":\"0000000000000000000000000000000000000000000000000000000000000000\","
                             "\"ivHex\":\"00000000000000000000000000000000\"}";
    info_ptr->args_schema = CIPHER_ARGS_SCHEMA;
    info_ptr->support = OMEGA_TRANSFORM_PLUGIN_SUPPORT_EXPERIMENTAL;
    info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
    return 0;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_apply(const omega_transform_plugin_request_t *request_ptr,
                                                               omega_transform_plugin_response_t *response_ptr) {
    omega_cipher_options_t options;
    if (cipher_parse_options(request_ptr ? request_ptr->options_json : NULL, &options) != 0) { return -1; }
    return cipher_transform(request_ptr, response_ptr, &options);
}
