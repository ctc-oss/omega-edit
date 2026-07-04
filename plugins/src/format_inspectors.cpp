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
#include <cstdint>
#include <sstream>
#include <string>
#include <vector>

namespace {

    constexpr const char *FORMAT_INSPECTOR_ARGS_SCHEMA =
            "{\"type\":\"object\",\"properties\":{\"format\":{\"type\":\"string\",\"title\":\"Format\","
            "\"description\":\"Structure to inspect.\",\"default\":\"protobuf-varint\",\"enum\":[\"protobuf-varint\","
            "\"asn1-ber\",\"asn1-der\",\"tlv\"]},\"tagBytes\":{\"type\":\"integer\",\"title\":\"Tag bytes\","
            "\"default\":1,\"enum\":[1,2,3,4]},\"lengthBytes\":{\"type\":\"integer\",\"title\":\"Length bytes\","
            "\"default\":1,\"enum\":[1,2,3,4]},\"endian\":{\"type\":\"string\",\"title\":\"Byte order\","
            "\"default\":\"big\",\"enum\":[\"big\",\"little\"]}},\"additionalProperties\":false}";

    std::string inspect_protobuf_varints(const omega_transform_plugin_request_t *request_ptr,
                                         const std::vector<omega_byte_t> &input) {
        std::ostringstream out;
        size_t offset = 0;
        int index = 0;
        while (offset < input.size()) {
            if (omega_transform_plugin_sdk_is_cancelled(request_ptr)) { return {}; }
            const size_t start = offset;
            uint64_t value = 0;
            int shift = 0;
            bool terminated = false;
            while (offset < input.size() && shift < 64) {
                if (omega_transform_plugin_sdk_is_cancelled(request_ptr)) { return {}; }
                const omega_byte_t byte = input[offset++];
                value |= static_cast<uint64_t>(byte & 0x7FU) << shift;
                if ((byte & 0x80U) == 0) {
                    terminated = true;
                    break;
                }
                shift += 7;
            }
            out << "varint[" << index++ << "] offset=" << start << " bytes=" << (offset - start);
            if (terminated) {
                out << " value=" << value << "\n";
            } else {
                out << " error=unterminated\n";
                break;
            }
        }
        if (input.empty()) { out << "No bytes selected.\n"; }
        return out.str();
    }

    std::string asn1_class_name(unsigned int tag_class) {
        switch (tag_class) {
            case 0:
                return "universal";
            case 1:
                return "application";
            case 2:
                return "context";
            case 3:
                return "private";
        }
        return "unknown";
    }

    std::string inspect_asn1(const omega_transform_plugin_request_t *request_ptr,
                             const std::vector<omega_byte_t> &input) {
        std::ostringstream out;
        size_t offset = 0;
        int index = 0;
        while (offset < input.size()) {
            if (omega_transform_plugin_sdk_is_cancelled(request_ptr)) { return {}; }
            const size_t start = offset;
            const omega_byte_t first = input[offset++];
            const unsigned int tag_class = (first >> 6U) & 0x03U;
            const bool constructed = (first & 0x20U) != 0;
            uint64_t tag = first & 0x1FU;
            if (tag == 0x1FU) {
                tag = 0;
                bool done = false;
                while (offset < input.size()) {
                    if (omega_transform_plugin_sdk_is_cancelled(request_ptr)) { return {}; }
                    const omega_byte_t byte = input[offset++];
                    tag = (tag << 7U) | (byte & 0x7FU);
                    if ((byte & 0x80U) == 0) {
                        done = true;
                        break;
                    }
                }
                if (!done) {
                    out << "tlv[" << index << "] offset=" << start << " error=unterminated-high-tag\n";
                    break;
                }
            }
            if (offset >= input.size()) {
                out << "tlv[" << index << "] offset=" << start << " tag=" << tag << " error=missing-length\n";
                break;
            }
            const omega_byte_t length_byte = input[offset++];
            bool indefinite = false;
            uint64_t length = 0;
            if ((length_byte & 0x80U) == 0) {
                length = length_byte;
            } else {
                const unsigned int length_bytes = length_byte & 0x7FU;
                if (length_bytes == 0) {
                    indefinite = true;
                } else if (length_bytes > 8 || length_bytes > input.size() - offset) {
                    out << "tlv[" << index << "] offset=" << start << " tag=" << tag << " error=invalid-length\n";
                    break;
                } else {
                    for (unsigned int i = 0; i < length_bytes; ++i) { length = (length << 8U) | input[offset++]; }
                }
            }

            out << "tlv[" << index++ << "] offset=" << start << " headerBytes=" << (offset - start)
                << " class=" << asn1_class_name(tag_class) << " constructed=" << (constructed ? "true" : "false")
                << " tag=" << tag;
            if (indefinite) {
                out << " length=indefinite\n";
                break;
            }
            out << " length=" << length;
            if (length > static_cast<uint64_t>(input.size() - offset)) {
                out << " error=value-truncated\n";
                break;
            }
            out << "\n";
            offset += static_cast<size_t>(length);
        }
        if (input.empty()) { out << "No bytes selected.\n"; }
        return out.str();
    }

    uint64_t read_uint(const std::vector<omega_byte_t> &input, size_t offset, int64_t width, bool little_endian) {
        uint64_t value = 0;
        if (little_endian) {
            for (int64_t i = width - 1; i >= 0; --i) { value = (value << 8U) | input[offset + static_cast<size_t>(i)]; }
        } else {
            for (int64_t i = 0; i < width; ++i) { value = (value << 8U) | input[offset + static_cast<size_t>(i)]; }
        }
        return value;
    }

    std::string inspect_tlv(const omega_transform_plugin_request_t *request_ptr, const std::vector<omega_byte_t> &input,
                            int64_t tag_bytes, int64_t length_bytes, bool little_endian) {
        std::ostringstream out;
        size_t offset = 0;
        int index = 0;
        const auto header = static_cast<size_t>(tag_bytes + length_bytes);
        while (offset < input.size()) {
            if (omega_transform_plugin_sdk_is_cancelled(request_ptr)) { return {}; }
            if (header > input.size() - offset) {
                out << "tlv[" << index << "] offset=" << offset << " error=truncated-header\n";
                break;
            }
            const uint64_t tag = read_uint(input, offset, tag_bytes, little_endian);
            const uint64_t length =
                    read_uint(input, offset + static_cast<size_t>(tag_bytes), length_bytes, little_endian);
            const size_t value_offset = offset + header;
            out << "tlv[" << index++ << "] offset=" << offset << " tag=" << tag << " length=" << length;
            if (length > static_cast<uint64_t>(input.size() - value_offset)) {
                out << " error=value-truncated\n";
                break;
            }
            out << "\n";
            offset = value_offset + static_cast<size_t>(length);
        }
        if (input.empty()) { out << "No bytes selected.\n"; }
        return out.str();
    }

}// namespace

extern "C" OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->id = "omega.example.format_inspectors";
    info_ptr->name = "Format Inspectors";
    info_ptr->description = "Inspect protobuf varints, ASN.1 BER/DER TLV headers, and configurable TLV records.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_INSPECT;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_TEXT_RESULT | OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
    info_ptr->help =
            "Choose protobuf varint, ASN.1 BER/DER, or configurable TLV inspection. TLV inspection uses tag byte "
            "count, length byte count, and endian options.";
    info_ptr->example = "{\"format\":\"tlv\",\"tagBytes\":1,\"lengthBytes\":1,\"endian\":\"big\"}";
    info_ptr->default_args = "{\"format\":\"protobuf-varint\"}";
    info_ptr->args_schema = FORMAT_INSPECTOR_ARGS_SCHEMA;
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
    const std::string format = omega_edit::plugin::option_or(options, "format", "protobuf-varint");
    std::string result;
    if (format == "protobuf-varint") {
        result = inspect_protobuf_varints(request_ptr, input);
    } else if (format == "asn1-ber" || format == "asn1-der") {
        result = inspect_asn1(request_ptr, input);
    } else if (format == "tlv") {
        const int64_t tag_bytes = omega_edit::plugin::option_int_or(options, "tagBytes", 1);
        const int64_t length_bytes = omega_edit::plugin::option_int_or(options, "lengthBytes", 1);
        if (tag_bytes < 1 || tag_bytes > 4 || length_bytes < 1 || length_bytes > 4) { return -1; }
        result = inspect_tlv(request_ptr, input, tag_bytes, length_bytes,
                             omega_edit::plugin::option_or(options, "endian", "big") == "little");
    } else {
        return -1;
    }
    if (omega_transform_plugin_sdk_is_cancelled(request_ptr)) { return -1; }
    return omega_edit::plugin::set_text_result(request_ptr, response_ptr, format, result);
}
