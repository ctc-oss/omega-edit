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

#include "plugin_options.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdint>
#include <string>
#include <vector>

namespace {

    constexpr const char *TEXT_CODEC_ARGS_SCHEMA =
            "{\"type\":\"object\",\"properties\":{\"codec\":{\"type\":\"string\",\"title\":\"Codec\","
            "\"description\":\"Text-safe encoding to apply.\",\"default\":\"hex\",\"enum\":[\"hex\",\"base16\","
            "\"base64url\",\"base32\",\"base32-crockford\",\"ascii85\",\"base85\",\"z85\",\"base58\",\"percent\","
            "\"url\",\"quoted-printable\",\"uuencode\",\"yenc\"]},\"direction\":{\"type\":\"string\",\"title\":"
            "\"Direction\",\"default\":\"encode\",\"enum\":[\"encode\",\"decode\"]}},\"additionalProperties\":false}";

    int hex_value(omega_byte_t byte) {
        if (byte >= '0' && byte <= '9') { return byte - '0'; }
        if (byte >= 'a' && byte <= 'f') { return byte - 'a' + 10; }
        if (byte >= 'A' && byte <= 'F') { return byte - 'A' + 10; }
        return -1;
    }

    bool is_ascii_space(omega_byte_t byte) { return std::isspace(static_cast<unsigned char>(byte)) != 0; }

    bool is_ascii_alnum(omega_byte_t byte) { return std::isalnum(static_cast<unsigned char>(byte)) != 0; }

    omega_byte_t uppercase_ascii(omega_byte_t byte) {
        return static_cast<omega_byte_t>(std::toupper(static_cast<unsigned char>(byte)));
    }

    std::vector<omega_byte_t> hex_encode(const std::vector<omega_byte_t> &input) {
        static constexpr char alphabet[] = "0123456789abcdef";
        std::vector<omega_byte_t> out;
        out.reserve(input.size() * 2);
        for (const auto byte : input) {
            out.push_back(static_cast<omega_byte_t>(alphabet[(byte >> 4U) & 0x0FU]));
            out.push_back(static_cast<omega_byte_t>(alphabet[byte & 0x0FU]));
        }
        return out;
    }

    bool hex_decode(const std::vector<omega_byte_t> &input, std::vector<omega_byte_t> &out) {
        out.clear();
        int high = -1;
        for (const auto byte : input) {
            if (is_ascii_space(byte)) { continue; }
            const int value = hex_value(byte);
            if (value < 0) { return false; }
            if (high < 0) {
                high = value;
            } else {
                out.push_back(static_cast<omega_byte_t>((high << 4U) | value));
                high = -1;
            }
        }
        return high < 0;
    }

    std::vector<omega_byte_t> base64url_encode(const std::vector<omega_byte_t> &input) {
        static constexpr char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        std::vector<omega_byte_t> out;
        out.reserve(((input.size() + 2) / 3) * 4);
        for (size_t i = 0; i < input.size();) {
            const unsigned int a = input[i++];
            const bool has_b = i < input.size();
            const unsigned int b = has_b ? input[i++] : 0;
            const bool has_c = i < input.size();
            const unsigned int c = has_c ? input[i++] : 0;
            const unsigned int triple = (a << 16U) | (b << 8U) | c;
            out.push_back(static_cast<omega_byte_t>(alphabet[(triple >> 18U) & 0x3FU]));
            out.push_back(static_cast<omega_byte_t>(alphabet[(triple >> 12U) & 0x3FU]));
            if (has_b) { out.push_back(static_cast<omega_byte_t>(alphabet[(triple >> 6U) & 0x3FU])); }
            if (has_c) { out.push_back(static_cast<omega_byte_t>(alphabet[triple & 0x3FU])); }
        }
        return out;
    }

    int base64url_value(omega_byte_t byte) {
        if (byte >= 'A' && byte <= 'Z') { return byte - 'A'; }
        if (byte >= 'a' && byte <= 'z') { return byte - 'a' + 26; }
        if (byte >= '0' && byte <= '9') { return byte - '0' + 52; }
        if (byte == '-' || byte == '+') { return 62; }
        if (byte == '_' || byte == '/') { return 63; }
        if (byte == '=') { return -2; }
        return -1;
    }

    bool base64url_decode(const std::vector<omega_byte_t> &input, std::vector<omega_byte_t> &out) {
        std::vector<int> values;
        size_t padding_count = 0;
        bool saw_padding = false;
        for (const auto byte : input) {
            if (is_ascii_space(byte)) { continue; }
            const int value = base64url_value(byte);
            if (value == -1) { return false; }
            if (value == -2) {
                saw_padding = true;
                if (++padding_count > 2) { return false; }
                continue;
            }
            if (saw_padding) { return false; }
            values.push_back(value);
        }
        const size_t value_count = values.size();
        if ((value_count % 4) == 1) { return false; }
        if (padding_count > 0) {
            if (((value_count + padding_count) % 4) != 0) { return false; }
            if ((padding_count == 1 && (value_count % 4) != 3) || (padding_count == 2 && (value_count % 4) != 2)) {
                return false;
            }
        }
        while ((values.size() % 4) != 0) { values.push_back(0); }
        out.clear();
        for (size_t i = 0; i < values.size(); i += 4) {
            const unsigned int triple =
                    (static_cast<unsigned int>(values[i]) << 18U) | (static_cast<unsigned int>(values[i + 1]) << 12U) |
                    (static_cast<unsigned int>(values[i + 2]) << 6U) | static_cast<unsigned int>(values[i + 3]);
            out.push_back(static_cast<omega_byte_t>((triple >> 16U) & 0xFFU));
            if (i + 2 < values.size()) { out.push_back(static_cast<omega_byte_t>((triple >> 8U) & 0xFFU)); }
            if (i + 3 < values.size()) { out.push_back(static_cast<omega_byte_t>(triple & 0xFFU)); }
        }
        out.resize((value_count * 6U) / 8U);
        return true;
    }

    std::vector<omega_byte_t> base32_encode(const std::vector<omega_byte_t> &input, bool crockford) {
        const char *alphabet = crockford ? "0123456789ABCDEFGHJKMNPQRSTVWXYZ" : "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        std::vector<omega_byte_t> out;
        uint32_t buffer = 0;
        int bits = 0;
        for (const auto byte : input) {
            buffer = (buffer << 8U) | byte;
            bits += 8;
            while (bits >= 5) {
                out.push_back(static_cast<omega_byte_t>(alphabet[(buffer >> (bits - 5)) & 0x1FU]));
                bits -= 5;
            }
        }
        if (bits > 0) { out.push_back(static_cast<omega_byte_t>(alphabet[(buffer << (5 - bits)) & 0x1FU])); }
        if (!crockford) {
            while ((out.size() % 8) != 0) { out.push_back('='); }
        }
        return out;
    }

    int base32_value(omega_byte_t byte, bool crockford) {
        byte = uppercase_ascii(byte);
        if (crockford) {
            if (byte == 'O') { return 0; }
            if (byte == 'I' || byte == 'L') { return 1; }
            static constexpr char alphabet[] = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
            const char *found = std::find(std::begin(alphabet), std::end(alphabet) - 1, byte);
            return found == std::end(alphabet) - 1 ? -1 : static_cast<int>(found - alphabet);
        }
        if (byte >= 'A' && byte <= 'Z') { return byte - 'A'; }
        if (byte >= '2' && byte <= '7') { return byte - '2' + 26; }
        return -1;
    }

    bool base32_decode(const std::vector<omega_byte_t> &input, bool crockford, std::vector<omega_byte_t> &out) {
        out.clear();
        uint32_t buffer = 0;
        int bits = 0;
        for (const auto byte : input) {
            if (is_ascii_space(byte) || byte == '=') { continue; }
            const int value = base32_value(byte, crockford);
            if (value < 0) { return false; }
            buffer = (buffer << 5U) | static_cast<uint32_t>(value);
            bits += 5;
            if (bits >= 8) {
                out.push_back(static_cast<omega_byte_t>((buffer >> (bits - 8)) & 0xFFU));
                bits -= 8;
            }
        }
        return true;
    }

    std::vector<omega_byte_t> base58_encode(const std::vector<omega_byte_t> &input) {
        static constexpr char alphabet[] = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
        std::vector<omega_byte_t> digits(1, 0);
        for (const auto byte : input) {
            int carry = byte;
            for (auto &digit : digits) {
                carry += digit << 8U;
                digit = static_cast<omega_byte_t>(carry % 58);
                carry /= 58;
            }
            while (carry) {
                digits.push_back(static_cast<omega_byte_t>(carry % 58));
                carry /= 58;
            }
        }
        std::vector<omega_byte_t> out;
        for (const auto byte : input) {
            if (byte == 0) {
                out.push_back('1');
            } else {
                break;
            }
        }
        for (auto iter = digits.rbegin(); iter != digits.rend(); ++iter) {
            out.push_back(static_cast<omega_byte_t>(alphabet[*iter]));
        }
        return out;
    }

    bool base58_decode(const std::vector<omega_byte_t> &input, std::vector<omega_byte_t> &out) {
        static constexpr char alphabet[] = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
        std::vector<omega_byte_t> bytes(1, 0);
        for (const auto ch : input) {
            if (is_ascii_space(ch)) { continue; }
            const char *found = std::find(std::begin(alphabet), std::end(alphabet) - 1, ch);
            if (found == std::end(alphabet) - 1) { return false; }
            int carry = static_cast<int>(found - alphabet);
            for (auto &byte : bytes) {
                carry += byte * 58;
                byte = static_cast<omega_byte_t>(carry & 0xFF);
                carry >>= 8U;
            }
            while (carry) {
                bytes.push_back(static_cast<omega_byte_t>(carry & 0xFF));
                carry >>= 8U;
            }
        }
        out.clear();
        for (const auto ch : input) {
            if (ch == '1') {
                out.push_back(0);
            } else if (!is_ascii_space(ch)) {
                break;
            }
        }
        for (auto iter = bytes.rbegin(); iter != bytes.rend(); ++iter) { out.push_back(*iter); }
        return true;
    }

    std::vector<omega_byte_t> percent_encode(const std::vector<omega_byte_t> &input) {
        static constexpr char alphabet[] = "0123456789ABCDEF";
        std::vector<omega_byte_t> out;
        for (const auto byte : input) {
            if (is_ascii_alnum(byte) || byte == '-' || byte == '_' || byte == '.' || byte == '~') {
                out.push_back(byte);
            } else {
                out.push_back('%');
                out.push_back(static_cast<omega_byte_t>(alphabet[(byte >> 4U) & 0x0FU]));
                out.push_back(static_cast<omega_byte_t>(alphabet[byte & 0x0FU]));
            }
        }
        return out;
    }

    bool percent_decode(const std::vector<omega_byte_t> &input, std::vector<omega_byte_t> &out) {
        out.clear();
        for (size_t i = 0; i < input.size(); ++i) {
            if (input[i] != '%') {
                out.push_back(input[i]);
                continue;
            }
            if (i + 2 >= input.size()) { return false; }
            const int high = hex_value(input[++i]);
            const int low = hex_value(input[++i]);
            if (high < 0 || low < 0) { return false; }
            out.push_back(static_cast<omega_byte_t>((high << 4U) | low));
        }
        return true;
    }

    std::vector<omega_byte_t> quoted_printable_encode(const std::vector<omega_byte_t> &input) {
        static constexpr char alphabet[] = "0123456789ABCDEF";
        std::vector<omega_byte_t> out;
        for (const auto byte : input) {
            if ((byte >= 33 && byte <= 60) || (byte >= 62 && byte <= 126) || byte == '\t' || byte == ' ') {
                out.push_back(byte);
            } else {
                out.push_back('=');
                out.push_back(static_cast<omega_byte_t>(alphabet[(byte >> 4U) & 0x0FU]));
                out.push_back(static_cast<omega_byte_t>(alphabet[byte & 0x0FU]));
            }
        }
        return out;
    }

    bool quoted_printable_decode(const std::vector<omega_byte_t> &input, std::vector<omega_byte_t> &out) {
        out.clear();
        for (size_t i = 0; i < input.size(); ++i) {
            if (input[i] != '=') {
                out.push_back(input[i]);
                continue;
            }
            if (i + 1 < input.size() && (input[i + 1] == '\r' || input[i + 1] == '\n')) {
                while (i + 1 < input.size() && (input[i + 1] == '\r' || input[i + 1] == '\n')) { ++i; }
                continue;
            }
            if (i + 2 >= input.size()) { return false; }
            const int high = hex_value(input[++i]);
            const int low = hex_value(input[++i]);
            if (high < 0 || low < 0) { return false; }
            out.push_back(static_cast<omega_byte_t>((high << 4U) | low));
        }
        return true;
    }

    omega_byte_t uu_char(unsigned int value) {
        value &= 0x3FU;
        return static_cast<omega_byte_t>(value == 0 ? '`' : value + 32U);
    }

    int uu_value(omega_byte_t byte) {
        if (byte == '`' || byte == ' ') { return 0; }
        if (byte >= 33 && byte <= 95) { return (byte - 32) & 0x3F; }
        return -1;
    }

    std::vector<omega_byte_t> uuencode(const std::vector<omega_byte_t> &input) {
        std::vector<omega_byte_t> out;
        for (size_t line = 0; line < input.size(); line += 45) {
            const size_t count = std::min<size_t>(45, input.size() - line);
            out.push_back(uu_char(static_cast<unsigned int>(count)));
            for (size_t i = 0; i < count; i += 3) {
                const unsigned int a = input[line + i];
                const unsigned int b = i + 1 < count ? input[line + i + 1] : 0;
                const unsigned int c = i + 2 < count ? input[line + i + 2] : 0;
                out.push_back(uu_char(a >> 2U));
                out.push_back(uu_char(((a << 4U) | (b >> 4U))));
                out.push_back(uu_char(((b << 2U) | (c >> 6U))));
                out.push_back(uu_char(c));
            }
            out.push_back('\n');
        }
        out.push_back('`');
        out.push_back('\n');
        return out;
    }

    bool uudecode(const std::vector<omega_byte_t> &input, std::vector<omega_byte_t> &out) {
        out.clear();
        size_t cursor = 0;
        while (cursor < input.size()) {
            while (cursor < input.size() && (input[cursor] == '\r' || input[cursor] == '\n')) { ++cursor; }
            if (cursor >= input.size()) { break; }
            const int count = uu_value(input[cursor++]);
            if (count < 0) { return false; }
            if (count == 0) { return true; }
            int produced = 0;
            while (produced < count) {
                if (cursor + 4 > input.size()) { return false; }
                const int a = uu_value(input[cursor++]);
                const int b = uu_value(input[cursor++]);
                const int c = uu_value(input[cursor++]);
                const int d = uu_value(input[cursor++]);
                if (a < 0 || b < 0 || c < 0 || d < 0) { return false; }
                const omega_byte_t one = static_cast<omega_byte_t>((a << 2U) | (b >> 4U));
                const omega_byte_t two = static_cast<omega_byte_t>((b << 4U) | (c >> 2U));
                const omega_byte_t three = static_cast<omega_byte_t>((c << 6U) | d);
                out.push_back(one);
                if (++produced < count) {
                    out.push_back(two);
                    ++produced;
                }
                if (produced < count) {
                    out.push_back(three);
                    ++produced;
                }
            }
            while (cursor < input.size() && input[cursor] != '\n') { ++cursor; }
        }
        return true;
    }

    std::vector<omega_byte_t> yenc_encode(const std::vector<omega_byte_t> &input) {
        std::vector<omega_byte_t> out;
        for (const auto byte : input) {
            omega_byte_t encoded = static_cast<omega_byte_t>(byte + 42U);
            if (encoded == 0 || encoded == '\n' || encoded == '\r' || encoded == '=') {
                out.push_back('=');
                encoded = static_cast<omega_byte_t>(encoded + 64U);
            }
            out.push_back(encoded);
        }
        return out;
    }

    bool yenc_decode(const std::vector<omega_byte_t> &input, std::vector<omega_byte_t> &out) {
        out.clear();
        for (size_t i = 0; i < input.size(); ++i) {
            omega_byte_t byte = input[i];
            if (byte == '=') {
                if (++i >= input.size()) { return false; }
                byte = static_cast<omega_byte_t>(input[i] - 64U);
            }
            out.push_back(static_cast<omega_byte_t>(byte - 42U));
        }
        return true;
    }

    std::vector<omega_byte_t> ascii85_encode(const std::vector<omega_byte_t> &input, bool z85) {
        static constexpr char z85_alphabet[] =
                "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#";
        std::vector<omega_byte_t> out;
        for (size_t i = 0; i < input.size(); i += 4) {
            const size_t count = std::min<size_t>(4, input.size() - i);
            uint32_t value = 0;
            for (size_t j = 0; j < 4; ++j) { value = (value << 8U) | (j < count ? input[i + j] : 0); }
            if (!z85 && count == 4 && value == 0) {
                out.push_back('z');
                continue;
            }
            std::array<omega_byte_t, 5> encoded{};
            for (int j = 4; j >= 0; --j) {
                encoded[static_cast<size_t>(j)] =
                        static_cast<omega_byte_t>(z85 ? z85_alphabet[value % 85U] : (value % 85U) + 33U);
                value /= 85U;
            }
            const size_t emit = z85 ? 5 : count + 1;
            out.insert(out.end(), encoded.begin(),
                       encoded.begin() + static_cast<std::array<omega_byte_t, 5>::difference_type>(emit));
        }
        return out;
    }

    int ascii85_value(omega_byte_t byte, bool z85) {
        static constexpr char z85_alphabet[] =
                "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#";
        if (z85) {
            const char *found = std::find(std::begin(z85_alphabet), std::end(z85_alphabet) - 1, byte);
            return found == std::end(z85_alphabet) - 1 ? -1 : static_cast<int>(found - z85_alphabet);
        }
        return byte >= '!' && byte <= 'u' ? byte - '!' : -1;
    }

    bool ascii85_decode(const std::vector<omega_byte_t> &input, bool z85, std::vector<omega_byte_t> &out) {
        out.clear();
        std::array<int, 5> group{};
        int group_size = 0;
        for (const auto byte : input) {
            if (is_ascii_space(byte)) { continue; }
            if (!z85 && byte == 'z') {
                if (group_size != 0) { return false; }
                out.insert(out.end(), {0, 0, 0, 0});
                continue;
            }
            const int value = ascii85_value(byte, z85);
            if (value < 0) { return false; }
            group[static_cast<size_t>(group_size++)] = value;
            if (group_size != 5) { continue; }
            uint32_t decoded = 0;
            for (const int item : group) { decoded = (decoded * 85U) + static_cast<uint32_t>(item); }
            out.push_back(static_cast<omega_byte_t>((decoded >> 24U) & 0xFFU));
            out.push_back(static_cast<omega_byte_t>((decoded >> 16U) & 0xFFU));
            out.push_back(static_cast<omega_byte_t>((decoded >> 8U) & 0xFFU));
            out.push_back(static_cast<omega_byte_t>(decoded & 0xFFU));
            group_size = 0;
        }
        if (group_size > 0) {
            if (z85 || group_size == 1) { return false; }
            for (int i = group_size; i < 5; ++i) { group[static_cast<size_t>(i)] = 84; }
            uint32_t decoded = 0;
            for (const int item : group) { decoded = (decoded * 85U) + static_cast<uint32_t>(item); }
            for (int i = 0; i < group_size - 1; ++i) {
                out.push_back(static_cast<omega_byte_t>((decoded >> (24U - (8U * i))) & 0xFFU));
            }
        }
        return true;
    }

}// namespace

extern "C" OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->id = "omega.example.text_codecs";
    info_ptr->name = "Text Codecs";
    info_ptr->description = "Encode or decode common binary-to-text and legacy transfer encodings.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_EXPAND | OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_SHRINK |
                      OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
    info_ptr->help =
            "Choose a text codec and encode or decode direction. Codecs include hex/base16, base64url, base32, "
            "base32-crockford, ascii85/base85, z85, base58, percent/url, quoted-printable, uuencode, and yenc.";
    info_ptr->example = "{\"codec\":\"base32\",\"direction\":\"encode\"}";
    info_ptr->default_args = "{\"codec\":\"hex\",\"direction\":\"encode\"}";
    info_ptr->args_schema = TEXT_CODEC_ARGS_SCHEMA;
    info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
    return 0;
}

extern "C" OMEGA_TRANSFORM_PLUGIN_EXPORT int
omega_transform_plugin_apply(const omega_transform_plugin_request_t *request_ptr,
                             omega_transform_plugin_response_t *response_ptr) {
    std::vector<omega_byte_t> input;
    if (!omega_edit::plugin::selected_bytes(request_ptr, input) || !response_ptr || !request_ptr->alloc) { return -1; }
    std::map<std::string, std::string> options;
    if (!omega_edit::plugin::parse_string_options(request_ptr->options_json, options)) { return -1; }
    std::string codec = omega_edit::plugin::option_or(options, "codec", "hex");
    const std::string direction = omega_edit::plugin::option_or(options, "direction", "encode");
    if (codec == "base16") { codec = "hex"; }
    if (codec == "url") { codec = "percent"; }
    if (codec == "base85") { codec = "ascii85"; }

    std::vector<omega_byte_t> output;
    bool ok = true;
    if (codec == "hex") {
        if (direction == "encode") {
            output = hex_encode(input);
        } else {
            ok = hex_decode(input, output);
        }
    } else if (codec == "base64url") {
        if (direction == "encode") {
            output = base64url_encode(input);
        } else {
            ok = base64url_decode(input, output);
        }
    } else if (codec == "base32" || codec == "base32-crockford") {
        const bool crockford = codec == "base32-crockford";
        if (direction == "encode") {
            output = base32_encode(input, crockford);
        } else {
            ok = base32_decode(input, crockford, output);
        }
    } else if (codec == "base58") {
        if (direction == "encode") {
            output = base58_encode(input);
        } else {
            ok = base58_decode(input, output);
        }
    } else if (codec == "percent") {
        if (direction == "encode") {
            output = percent_encode(input);
        } else {
            ok = percent_decode(input, output);
        }
    } else if (codec == "quoted-printable") {
        if (direction == "encode") {
            output = quoted_printable_encode(input);
        } else {
            ok = quoted_printable_decode(input, output);
        }
    } else if (codec == "uuencode") {
        if (direction == "encode") {
            output = uuencode(input);
        } else {
            ok = uudecode(input, output);
        }
    } else if (codec == "yenc") {
        if (direction == "encode") {
            output = yenc_encode(input);
        } else {
            ok = yenc_decode(input, output);
        }
    } else if (codec == "ascii85" || codec == "z85") {
        const bool z85 = codec == "z85";
        if (z85 && (input.size() % (direction == "encode" ? 4 : 5)) != 0) { return -1; }
        if (direction == "encode") {
            output = ascii85_encode(input, z85);
        } else {
            ok = ascii85_decode(input, z85, output);
        }
    } else {
        return -1;
    }
    return ok ? omega_edit::plugin::set_replacement(request_ptr, response_ptr, output) : -1;
}
