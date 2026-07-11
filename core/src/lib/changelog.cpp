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

#include "../include/omega_edit/changelog.h"

#include "../include/omega_edit/change.h"
#include "../include/omega_edit/filesystem.h"
#include "../include/omega_edit/session.h"
#include "impl_/change_def.hpp"
#include "impl_/model_def.hpp"
#include "impl_/session_def.hpp"

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <limits>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

using omega_edit::internal::change_kind_t;
using omega_edit::internal::omega_change_copy_payload_bytes_;
using omega_edit::internal::omega_change_get_kind_;

namespace {

    constexpr int64_t DEFAULT_MAX_SPAN_BYTES = 64LL * 1024 * 1024;
    constexpr int64_t COMPARE_BUFFER_BYTES = 64 * 1024;

    enum class source_kind_t { file, change };

    struct source_slice_t {
        source_kind_t kind{source_kind_t::file};
        std::shared_ptr<const std::string> file_path{};
        const_omega_change_ptr_t change{};
        omega_change_payload_role_t payload_role{OMEGA_CHANGE_PAYLOAD_DATA};
        int64_t source_offset{};
        int64_t length{};
    };

    struct piece_t : source_slice_t {
        bool baseline{};
        int64_t baseline_offset{};
    };

    bool checked_add_(int64_t left, int64_t right, int64_t &result) {
        if (left < 0 || right < 0 || left > std::numeric_limits<int64_t>::max() - right) { return false; }
        result = left + right;
        return true;
    }

    int64_t read_source_(const source_slice_t &source, int64_t offset, omega_byte_t *destination, int64_t length) {
        if (!destination || offset < 0 || length < 0 || offset > source.length || length > source.length - offset) {
            return -1;
        }
        if (length == 0) { return 0; }
        if (source.kind == source_kind_t::file) {
            if (!source.file_path) { return -1; }
            return omega_util_read_file_segment(source.file_path->c_str(), source.source_offset + offset, destination,
                                                length) == length
                           ? length
                           : -1;
        }
        return source.change &&
                               omega_change_copy_payload_bytes_(source.change.get(), source.payload_role,
                                                                source.source_offset + offset, destination, length) == 0
                       ? length
                       : -1;
    }

    struct rope_node_t {
        explicit rope_node_t(piece_t value) : piece(std::move(value)) {}

        piece_t piece;
        std::unique_ptr<rope_node_t> left{};
        std::unique_ptr<rope_node_t> right{};
        int height{1};
        int64_t subtree_length{};
        int64_t subtree_nodes{1};
    };

    using rope_ptr_t = std::unique_ptr<rope_node_t>;

    int height_(const rope_ptr_t &node) { return node ? node->height : 0; }
    int64_t length_(const rope_ptr_t &node) { return node ? node->subtree_length : 0; }
    int64_t nodes_(const rope_ptr_t &node) { return node ? node->subtree_nodes : 0; }

    bool refresh_(rope_node_t *node) {
        if (!node) { return true; }
        int64_t with_left = 0;
        if (!checked_add_(length_(node->left), node->piece.length, with_left) ||
            !checked_add_(with_left, length_(node->right), node->subtree_length) ||
            !checked_add_(nodes_(node->left), 1, with_left) ||
            !checked_add_(with_left, nodes_(node->right), node->subtree_nodes)) {
            return false;
        }
        node->height = 1 + std::max(height_(node->left), height_(node->right));
        return true;
    }

    rope_ptr_t rotate_left_(rope_ptr_t root) {
        auto next = std::move(root->right);
        root->right = std::move(next->left);
        refresh_(root.get());
        next->left = std::move(root);
        refresh_(next.get());
        return next;
    }

    rope_ptr_t rotate_right_(rope_ptr_t root) {
        auto next = std::move(root->left);
        root->left = std::move(next->right);
        refresh_(root.get());
        next->right = std::move(root);
        refresh_(next.get());
        return next;
    }

    rope_ptr_t balance_(rope_ptr_t root) {
        if (!root || !refresh_(root.get())) { return root; }
        const auto balance = height_(root->left) - height_(root->right);
        if (balance > 1) {
            if (height_(root->left->right) > height_(root->left->left)) {
                root->left = rotate_left_(std::move(root->left));
            }
            return rotate_right_(std::move(root));
        }
        if (balance < -1) {
            if (height_(root->right->left) > height_(root->right->right)) {
                root->right = rotate_right_(std::move(root->right));
            }
            return rotate_left_(std::move(root));
        }
        return root;
    }

    rope_ptr_t extract_min_(rope_ptr_t &root) {
        if (!root->left) {
            auto result = std::move(root);
            root = std::move(result->right);
            result->right.reset();
            refresh_(result.get());
            return result;
        }
        auto result = extract_min_(root->left);
        root = balance_(std::move(root));
        return result;
    }

    rope_ptr_t join_with_node_(rope_ptr_t left, rope_ptr_t middle, rope_ptr_t right) {
        if (height_(left) > height_(right) + 1) {
            left->right = join_with_node_(std::move(left->right), std::move(middle), std::move(right));
            return balance_(std::move(left));
        }
        if (height_(right) > height_(left) + 1) {
            right->left = join_with_node_(std::move(left), std::move(middle), std::move(right->left));
            return balance_(std::move(right));
        }
        middle->left = std::move(left);
        middle->right = std::move(right);
        refresh_(middle.get());
        return middle;
    }

    rope_ptr_t join_(rope_ptr_t left, rope_ptr_t right) {
        if (!left) { return right; }
        if (!right) { return left; }
        auto middle = extract_min_(right);
        return join_with_node_(std::move(left), std::move(middle), std::move(right));
    }

    std::pair<rope_ptr_t, rope_ptr_t> split_(rope_ptr_t root, int64_t offset) {
        if (!root) { return {}; }
        const auto left_length = length_(root->left);
        int64_t piece_end = 0;
        if (!checked_add_(left_length, root->piece.length, piece_end)) { return {}; }
        if (offset < left_length) {
            auto halves = split_(std::move(root->left), offset);
            root->left = std::move(halves.second);
            return {std::move(halves.first), balance_(std::move(root))};
        }
        if (offset > piece_end) {
            auto halves = split_(std::move(root->right), offset - piece_end);
            root->right = std::move(halves.first);
            return {balance_(std::move(root)), std::move(halves.second)};
        }
        if (offset == left_length) {
            auto left = std::move(root->left);
            return {std::move(left), balance_(std::move(root))};
        }
        if (offset == piece_end) {
            auto right = std::move(root->right);
            return {balance_(std::move(root)), std::move(right)};
        }

        const auto first_length = offset - left_length;
        auto first_piece = root->piece;
        auto second_piece = root->piece;
        first_piece.length = first_length;
        second_piece.source_offset += first_length;
        second_piece.length -= first_length;
        if (second_piece.baseline) { second_piece.baseline_offset += first_length; }
        auto left = std::move(root->left);
        auto right = std::move(root->right);
        auto first = std::make_unique<rope_node_t>(std::move(first_piece));
        auto second = std::make_unique<rope_node_t>(std::move(second_piece));
        refresh_(first.get());
        refresh_(second.get());
        return {join_(std::move(left), std::move(first)), join_(std::move(second), std::move(right))};
    }

    template<typename Visitor>
    void visit_pieces_(const rope_ptr_t &node, Visitor &&visitor) {
        if (!node) { return; }
        visit_pieces_(node->left, visitor);
        visitor(node->piece);
        visit_pieces_(node->right, visitor);
    }

    template<typename Visitor>
    void visit_pieces_mutable_(rope_ptr_t &node, Visitor &&visitor) {
        if (!node) { return; }
        visit_pieces_mutable_(node->left, visitor);
        visitor(node->piece);
        visit_pieces_mutable_(node->right, visitor);
    }

    class interval_union_t {
    public:
        int64_t added_length(int64_t start, int64_t end) const {
            if (start >= end) { return 0; }
            auto iterator = intervals_.lower_bound(start);
            if (iterator != intervals_.begin()) {
                const auto previous = std::prev(iterator);
                if (previous->second >= start) { iterator = previous; }
            }
            int64_t overlap = 0;
            while (iterator != intervals_.end() && iterator->first <= end) {
                const auto overlap_start = std::max(start, iterator->first);
                const auto overlap_end = std::min(end, iterator->second);
                if (overlap_end > overlap_start) { overlap += overlap_end - overlap_start; }
                ++iterator;
            }
            return end - start - overlap;
        }

        void insert(int64_t start, int64_t end) {
            if (start >= end) { return; }
            auto iterator = intervals_.lower_bound(start);
            if (iterator != intervals_.begin()) {
                const auto previous = std::prev(iterator);
                if (previous->second >= start) { iterator = previous; }
            }
            while (iterator != intervals_.end() && iterator->first <= end) {
                start = std::min(start, iterator->first);
                end = std::max(end, iterator->second);
                iterator = intervals_.erase(iterator);
            }
            intervals_.emplace(start, end);
        }

        void clear() { intervals_.clear(); }

    private:
        std::map<int64_t, int64_t> intervals_{};
    };

    void collect_touched_(const rope_ptr_t &node, int64_t node_start, int64_t query_start, int64_t query_end,
                          std::vector<std::pair<int64_t, int64_t>> &intervals) {
        if (!node || query_start >= query_end) { return; }
        const auto left_length = length_(node->left);
        const auto piece_start = node_start + left_length;
        const auto piece_end = piece_start + node->piece.length;
        if (query_start < piece_start) {
            collect_touched_(node->left, node_start, query_start, std::min(query_end, piece_start), intervals);
        }
        if (node->piece.baseline && query_start < piece_end && query_end > piece_start) {
            const auto overlap_start = std::max(query_start, piece_start) - piece_start;
            const auto overlap_end = std::min(query_end, piece_end) - piece_start;
            intervals.emplace_back(node->piece.baseline_offset + overlap_start,
                                   node->piece.baseline_offset + overlap_end);
        }
        if (query_end > piece_end) {
            collect_touched_(node->right, piece_end, std::max(query_start, piece_end), query_end, intervals);
        }
    }

    struct planned_entry_t {
        omega_changelog_plan_entry_t public_entry{};
        std::vector<source_slice_t> payload{};
        std::vector<int64_t> payload_offsets{};
        const_omega_change_ptr_t transform_owner{};
    };

    int64_t payload_read_(void *context, int64_t offset, omega_byte_t *destination, int64_t capacity) {
        auto *entry = static_cast<planned_entry_t *>(context);
        if (!entry || offset < 0 || capacity <= 0 || !destination || offset > entry->public_entry.payload_length) {
            return -1;
        }
        if (offset == entry->public_entry.payload_length) { return 0; }
        const auto requested = std::min(capacity, entry->public_entry.payload_length - offset);
        auto source_index = size_t{0};
        if (!entry->payload_offsets.empty()) {
            const auto upper = std::upper_bound(entry->payload_offsets.begin(), entry->payload_offsets.end(), offset);
            source_index = upper == entry->payload_offsets.begin()
                                   ? 0
                                   : static_cast<size_t>(std::distance(entry->payload_offsets.begin(), upper) - 1);
        }
        int64_t logical = entry->payload_offsets.empty() ? 0 : entry->payload_offsets[source_index];
        int64_t copied = 0;
        for (; source_index < entry->payload.size(); ++source_index) {
            const auto &slice = entry->payload[source_index];
            const auto slice_end = logical + slice.length;
            if (offset < slice_end && copied < requested) {
                const auto within = std::max<int64_t>(0, offset - logical);
                const auto chunk = std::min(slice.length - within, requested - copied);
                if (read_source_(slice, within, destination + copied, chunk) != chunk) { return -1; }
                copied += chunk;
                offset += chunk;
            }
            logical = slice_end;
            if (copied == requested) { break; }
        }
        return copied == requested ? copied : -1;
    }

    source_slice_t as_source_(const piece_t &piece) {
        source_slice_t result;
        result.kind = piece.kind;
        result.file_path = piece.file_path;
        result.change = piece.change;
        result.payload_role = piece.payload_role;
        result.source_offset = piece.source_offset;
        result.length = piece.length;
        return result;
    }

    int64_t sequence_length_(const std::vector<source_slice_t> &sequence) {
        int64_t result = 0;
        for (const auto &slice : sequence) {
            if (!checked_add_(result, slice.length, result)) { return -1; }
        }
        return result;
    }

    int64_t read_sequence_(const std::vector<source_slice_t> &sequence, int64_t offset, omega_byte_t *destination,
                           int64_t length) {
        if (offset < 0 || length < 0 || !destination) { return -1; }
        int64_t logical = 0;
        int64_t copied = 0;
        for (const auto &slice : sequence) {
            const auto end = logical + slice.length;
            if (offset < end && copied < length) {
                const auto within = std::max<int64_t>(0, offset - logical);
                const auto chunk = std::min(slice.length - within, length - copied);
                if (read_source_(slice, within, destination + copied, chunk) != chunk) { return -1; }
                copied += chunk;
                offset += chunk;
            }
            logical = end;
            if (copied == length) { return copied; }
        }
        return copied == length ? copied : -1;
    }

    struct content_source_context_t {
        std::vector<source_slice_t> sources{};
        int64_t length{};
    };

    int64_t content_read_(void *context, int64_t offset, omega_byte_t *destination, int64_t capacity) {
        const auto *source = static_cast<const content_source_context_t *>(context);
        if (!source || !destination || offset < 0 || capacity <= 0 || offset > source->length) { return -1; }
        if (offset == source->length) { return 0; }
        const auto requested = std::min(capacity, source->length - offset);
        return read_sequence_(source->sources, offset, destination, requested);
    }

    std::vector<source_slice_t> slice_sequence_(const std::vector<source_slice_t> &sequence, int64_t offset,
                                                int64_t length) {
        std::vector<source_slice_t> result;
        int64_t logical = 0;
        for (const auto &slice : sequence) {
            const auto end = logical + slice.length;
            if (offset < end && length > 0) {
                const auto within = std::max<int64_t>(0, offset - logical);
                const auto chunk = std::min(slice.length - within, length);
                auto selected = slice;
                selected.source_offset += within;
                selected.length = chunk;
                result.push_back(std::move(selected));
                offset += chunk;
                length -= chunk;
            }
            logical = end;
            if (length == 0) { break; }
        }
        return result;
    }

    bool trim_equal_edges_(const std::vector<source_slice_t> &baseline, int64_t baseline_offset, int64_t remove_length,
                           std::vector<source_slice_t> &payload, int64_t &prefix, int64_t &suffix) {
        const auto payload_length = sequence_length_(payload);
        if (payload_length < 0) { return false; }
        const auto comparable = std::min(remove_length, payload_length);
        std::array<omega_byte_t, COMPARE_BUFFER_BYTES> left{};
        std::array<omega_byte_t, COMPARE_BUFFER_BYTES> right{};
        while (prefix < comparable) {
            const auto chunk = std::min<int64_t>(COMPARE_BUFFER_BYTES, comparable - prefix);
            if (read_sequence_(baseline, baseline_offset + prefix, left.data(), chunk) != chunk ||
                read_sequence_(payload, prefix, right.data(), chunk) != chunk) {
                return false;
            }
            const auto *difference = static_cast<const omega_byte_t *>(
                    std::memcmp(left.data(), right.data(), chunk) == 0 ? nullptr : left.data());
            if (!difference) {
                prefix += chunk;
                continue;
            }
            int64_t index = 0;
            while (index < chunk && left[static_cast<size_t>(index)] == right[static_cast<size_t>(index)]) { ++index; }
            prefix += index;
            break;
        }
        while (suffix < comparable - prefix) {
            const auto chunk = std::min<int64_t>(COMPARE_BUFFER_BYTES, comparable - prefix - suffix);
            const auto base_start = baseline_offset + remove_length - suffix - chunk;
            const auto payload_start = payload_length - suffix - chunk;
            if (read_sequence_(baseline, base_start, left.data(), chunk) != chunk ||
                read_sequence_(payload, payload_start, right.data(), chunk) != chunk) {
                return false;
            }
            if (std::memcmp(left.data(), right.data(), static_cast<size_t>(chunk)) == 0) {
                suffix += chunk;
                continue;
            }
            int64_t index = chunk - 1;
            while (index >= 0 && left[static_cast<size_t>(index)] == right[static_cast<size_t>(index)]) { --index; }
            suffix += chunk - 1 - index;
            break;
        }
        payload = slice_sequence_(payload, prefix, payload_length - prefix - suffix);
        return true;
    }

    planned_entry_t make_edit_entry_(int64_t replay_offset, int64_t baseline_offset, int64_t remove_length,
                                     std::vector<source_slice_t> payload, const std::vector<source_slice_t> &baseline,
                                     bool prefer_overwrite) {
        int64_t prefix = 0;
        int64_t suffix = 0;
        if (!trim_equal_edges_(baseline, baseline_offset, remove_length, payload, prefix, suffix)) {
            throw std::runtime_error("failed to compare change-log sources");
        }
        remove_length -= prefix + suffix;
        replay_offset += prefix;
        const auto payload_length = sequence_length_(payload);
        planned_entry_t result;
        result.payload = std::move(payload);
        result.public_entry.offset = replay_offset;
        result.public_entry.length = remove_length;
        result.public_entry.payload_length = payload_length;
        if (remove_length == 0) {
            result.public_entry.kind = OMEGA_CHANGELOG_PLAN_INSERT;
        } else if (payload_length == 0) {
            result.public_entry.kind = OMEGA_CHANGELOG_PLAN_DELETE;
        } else if (prefer_overwrite && remove_length == payload_length) {
            result.public_entry.kind = OMEGA_CHANGELOG_PLAN_OVERWRITE;
        } else {
            result.public_entry.kind = OMEGA_CHANGELOG_PLAN_REPLACE;
        }
        if (payload_length > 0) {
            result.public_entry.read_payload = payload_read_;
            result.public_entry.payload_context = &result;
        }
        return result;
    }

    void repair_payload_contexts_(std::vector<planned_entry_t> &entries) {
        for (auto &entry : entries) {
            entry.payload_offsets.clear();
            entry.payload_offsets.reserve(entry.payload.size());
            int64_t offset = 0;
            for (const auto &source : entry.payload) {
                entry.payload_offsets.push_back(offset);
                if (!checked_add_(offset, source.length, offset)) {
                    throw std::runtime_error("change-log payload offset overflow");
                }
            }
            entry.public_entry.payload_context = entry.public_entry.payload_length > 0 ? &entry : nullptr;
        }
    }

    std::vector<planned_entry_t> diff_rope_(const rope_ptr_t &rope, const std::vector<source_slice_t> &baseline,
                                            int64_t baseline_length, bool prefer_overwrite) {
        std::vector<planned_entry_t> result;
        int64_t baseline_cursor = 0;
        int64_t replay_cursor = 0;
        std::vector<source_slice_t> pending;

        auto flush = [&](int64_t next_baseline) {
            if (next_baseline == baseline_cursor && pending.empty()) { return; }
            const auto replacement_length = sequence_length_(pending);
            if (replacement_length < 0) { throw std::runtime_error("change-log payload length overflow"); }
            auto entry = make_edit_entry_(replay_cursor, baseline_cursor, next_baseline - baseline_cursor,
                                          std::move(pending), baseline, prefer_overwrite);
            pending.clear();
            if (entry.public_entry.length != 0 || entry.public_entry.payload_length != 0) {
                result.push_back(std::move(entry));
            }
            replay_cursor += replacement_length;
            baseline_cursor = next_baseline;
        };

        visit_pieces_(rope, [&](const piece_t &piece) {
            if (piece.baseline) {
                flush(piece.baseline_offset);
                baseline_cursor += piece.length;
                replay_cursor += piece.length;
            } else {
                pending.push_back(as_source_(piece));
            }
        });
        flush(baseline_length);
        repair_payload_contexts_(result);
        return result;
    }

    planned_entry_t raw_entry_(const const_omega_change_ptr_t &change) {
        planned_entry_t result;
        result.public_entry.offset = change->offset;
        switch (omega_change_get_kind_(change.get())) {
            case change_kind_t::CHANGE_DELETE:
                result.public_entry.kind = OMEGA_CHANGELOG_PLAN_DELETE;
                result.public_entry.length = change->length;
                break;
            case change_kind_t::CHANGE_INSERT:
                result.public_entry.kind = OMEGA_CHANGELOG_PLAN_INSERT;
                result.public_entry.payload_length = change->data.length;
                break;
            case change_kind_t::CHANGE_OVERWRITE:
                result.public_entry.kind = OMEGA_CHANGELOG_PLAN_OVERWRITE;
                result.public_entry.length = change->length;
                result.public_entry.payload_length = change->data.length;
                break;
            case change_kind_t::CHANGE_TRANSFORM:
                result.public_entry.kind = OMEGA_CHANGELOG_PLAN_TRANSFORM;
                result.transform_owner = change;
                result.public_entry.transform_id =
                        change->transform_data ? change->transform_data->transform_id.c_str() : nullptr;
                result.public_entry.options_json =
                        change->transform_data && !change->transform_data->options_json.empty()
                                ? change->transform_data->options_json.c_str()
                                : nullptr;
                result.public_entry.replacement_length =
                        change->transform_data ? change->transform_data->replacement_length : -1;
                result.public_entry.computed_file_size_before =
                        change->transform_data ? change->transform_data->computed_file_size_before : -1;
                result.public_entry.computed_file_size_after =
                        change->transform_data ? change->transform_data->computed_file_size_after : -1;
                return result;
        }
        if (result.public_entry.payload_length > 0) {
            source_slice_t source;
            source.kind = source_kind_t::change;
            source.change = change;
            source.length = change->data.length;
            result.payload.push_back(std::move(source));
            result.public_entry.read_payload = payload_read_;
            result.public_entry.payload_context = &result;
        }
        return result;
    }

    class planner_t {
    public:
        planner_t(int64_t max_span_bytes, bool prefer_overwrite, bool optimize)
            : max_span_bytes_(max_span_bytes), prefer_overwrite_(prefer_overwrite), optimize_(optimize) {}

        bool reset_to_model(const omega_session_t *session, size_t model_index, size_t prefix_count) {
            if (!session || model_index >= session->models_.size()) { return false; }
            const auto *model = session->models_[model_index].get();
            rope_.reset();
            const auto &backing_path = model_index == 0 && !session->checkpoint_file_name_.empty()
                                               ? session->checkpoint_file_name_
                                               : model->file_path;
            const auto file_size = omega_util_file_size(backing_path.c_str());
            if (file_size < 0) { return false; }
            if (file_size > 0) {
                piece_t piece;
                piece.kind = source_kind_t::file;
                piece.file_path = std::make_shared<const std::string>(backing_path);
                piece.length = file_size;
                rope_ = std::make_unique<rope_node_t>(std::move(piece));
                refresh_(rope_.get());
            }
            for (size_t index = 0; index < prefix_count; ++index) {
                const auto &change = model->changes[index];
                if (omega_change_get_kind_(change.get()) != change_kind_t::CHANGE_TRANSFORM && !apply_(change)) {
                    return false;
                }
            }
            relabel_baseline_();
            return true;
        }

        bool accept(const const_omega_change_ptr_t &change) {
            const auto kind = omega_change_get_kind_(change.get());
            if (kind == change_kind_t::CHANGE_TRANSFORM) { return false; }
            if (change->offset < 0 || change->offset > length_(rope_) || change->length < 0) { return false; }
            int64_t affected = kind == change_kind_t::CHANGE_INSERT
                                       ? 0
                                       : (kind == change_kind_t::CHANGE_OVERWRITE
                                                  ? std::min(change->length, length_(rope_) - change->offset)
                                                  : change->length);
            int64_t end = 0;
            if (affected < 0 || !checked_add_(change->offset, affected, end) || end > length_(rope_)) { return false; }
            std::vector<std::pair<int64_t, int64_t>> touched;
            collect_touched_(rope_, 0, change->offset, end, touched);
            int64_t newly_touched = 0;
            for (const auto &interval : touched) {
                newly_touched += touched_base_.added_length(interval.first, interval.second);
            }
            const auto payload = kind == change_kind_t::CHANGE_INSERT || kind == change_kind_t::CHANGE_OVERWRITE
                                         ? change->data.length
                                         : 0;
            int64_t prospective = 0;
            if (!checked_add_(touched_base_bytes_, newly_touched, prospective) ||
                !checked_add_(prospective, payload_bytes_, prospective) ||
                !checked_add_(prospective, payload, prospective)) {
                return false;
            }
            if (!raw_.empty() && prospective > max_span_bytes_) {
                if (!finish_span_()) { return false; }
                return accept(change);
            }

            if (!apply_(change)) { return false; }
            raw_.push_back(change);
            for (const auto &interval : touched) { touched_base_.insert(interval.first, interval.second); }
            touched_base_bytes_ += newly_touched;
            payload_bytes_ += payload;
            if (prospective > max_span_bytes_) {
                force_raw_ = true;
                return finish_span_();
            }
            return true;
        }

        bool barrier(const const_omega_change_ptr_t &transform) {
            if (!finish_span_()) { return false; }
            output_.push_back(raw_entry_(transform));
            repair_payload_contexts_(output_);
            return true;
        }

        bool finish() { return finish_span_(); }

        content_source_context_t snapshot_content() const {
            content_source_context_t result;
            result.length = length_(rope_);
            visit_pieces_(rope_, [&](const piece_t &piece) { result.sources.push_back(as_source_(piece)); });
            return result;
        }

        std::vector<planned_entry_t> take_output() {
            repair_payload_contexts_(output_);
            return std::move(output_);
        }

    private:
        bool apply_(const const_omega_change_ptr_t &change) {
            const auto kind = omega_change_get_kind_(change.get());
            const auto remove_length = kind == change_kind_t::CHANGE_INSERT
                                               ? 0
                                               : (kind == change_kind_t::CHANGE_OVERWRITE
                                                          ? std::min(change->length, length_(rope_) - change->offset)
                                                          : change->length);
            auto at_offset = split_(std::move(rope_), change->offset);
            auto after_removed = split_(std::move(at_offset.second), remove_length);
            rope_ptr_t inserted;
            if (kind == change_kind_t::CHANGE_INSERT || kind == change_kind_t::CHANGE_OVERWRITE) {
                if (change->data.length < 0 || change->data.storage == OMEGA_CHANGE_DATA_STORAGE_NONE) { return false; }
                if (change->data.length > 0) {
                    piece_t piece;
                    piece.kind = source_kind_t::change;
                    piece.change = change;
                    piece.length = change->data.length;
                    inserted = std::make_unique<rope_node_t>(std::move(piece));
                    refresh_(inserted.get());
                }
            }
            rope_ = join_(join_(std::move(at_offset.first), std::move(inserted)), std::move(after_removed.second));
            return true;
        }

        void relabel_baseline_() {
            baseline_.clear();
            baseline_length_ = 0;
            visit_pieces_mutable_(rope_, [&](piece_t &piece) {
                piece.baseline = true;
                piece.baseline_offset = baseline_length_;
                baseline_.push_back(as_source_(piece));
                baseline_length_ += piece.length;
            });
            touched_base_.clear();
            touched_base_bytes_ = 0;
            payload_bytes_ = 0;
            force_raw_ = false;
        }

        bool finish_span_() {
            if (raw_.empty()) { return true; }
            std::vector<planned_entry_t> optimized;
            if (optimize_ && !force_raw_) {
                optimized = diff_rope_(rope_, baseline_, baseline_length_, prefer_overwrite_);
            }
            if (!optimize_ || force_raw_ || optimized.size() > raw_.size()) {
                for (const auto &change : raw_) { output_.push_back(raw_entry_(change)); }
            } else {
                for (auto &entry : optimized) { output_.push_back(std::move(entry)); }
            }
            raw_.clear();
            relabel_baseline_();
            repair_payload_contexts_(output_);
            return true;
        }

        int64_t max_span_bytes_{};
        bool prefer_overwrite_{};
        bool optimize_{};
        rope_ptr_t rope_{};
        std::vector<source_slice_t> baseline_{};
        int64_t baseline_length_{};
        interval_union_t touched_base_{};
        int64_t touched_base_bytes_{};
        int64_t payload_bytes_{};
        bool force_raw_{};
        std::vector<const_omega_change_ptr_t> raw_{};
        std::vector<planned_entry_t> output_{};
    };

    struct location_t {
        size_t model{};
        size_t change{};
        bool found{};
    };

    location_t locate_(const omega_session_t *session, int64_t serial) {
        for (size_t model_index = 0; model_index < session->models_.size(); ++model_index) {
            const auto &model = session->models_[model_index];
            const auto index = serial - 1 - model->change_serial_base;
            if (index >= 0 && static_cast<size_t>(index) < model->changes.size() &&
                model->changes[static_cast<size_t>(index)]->serial == serial) {
                return {model_index, static_cast<size_t>(index), true};
            }
        }
        return {};
    }

}// namespace

int omega_edit_export_changelog(const omega_session_t *session_ptr, const omega_changelog_export_options_t *options,
                                int optimize, omega_changelog_export_summary_cbk_t summary_cbk,
                                omega_changelog_plan_visitor_cbk_t entry_cbk, void *user_data) {
    if (!session_ptr || !entry_cbk || session_ptr->models_.empty()) { return -1; }
    omega_changelog_export_options_t resolved{};
    if (options) { resolved = *options; }
    if (resolved.flags != 0 || resolved.first_change_serial < 0 || resolved.last_change_serial < 0 ||
        resolved.max_span_bytes < 0 || resolved.max_entries < 0) {
        return -1;
    }
    const auto tip = omega_session_get_num_changes(session_ptr);
    if (tip <= 0) { return -1; }
    const auto first = resolved.first_change_serial == 0 ? 1 : resolved.first_change_serial;
    const auto last = resolved.last_change_serial == 0 ? tip : resolved.last_change_serial;
    if (first <= 0 || last <= 0 || first > last || last > tip) { return -1; }
    const auto first_location = locate_(session_ptr, first);
    const auto last_location = locate_(session_ptr, last);
    if (!first_location.found || !last_location.found || first_location.model > last_location.model) { return -1; }

    try {
        planner_t planner(resolved.max_span_bytes == 0 ? DEFAULT_MAX_SPAN_BYTES : resolved.max_span_bytes,
                          resolved.prefer_overwrite_form != 0, optimize != 0);
        const auto &first_model = session_ptr->models_[first_location.model];
        const auto first_is_transform =
                first_location.change == 0 &&
                omega_change_get_kind_(first_model->changes.front().get()) == change_kind_t::CHANGE_TRANSFORM;
        if (first_is_transform) {
            if (first_location.model == 0) { return -1; }
            const auto &previous = session_ptr->models_[first_location.model - 1];
            if (!planner.reset_to_model(session_ptr, first_location.model - 1, previous->changes.size())) { return -1; }
        } else if (!planner.reset_to_model(session_ptr, first_location.model, first_location.change)) {
            return -1;
        }
        auto before = planner.snapshot_content();

        for (size_t model_index = first_location.model; model_index <= last_location.model; ++model_index) {
            const auto &model = session_ptr->models_[model_index];
            const auto begin = model_index == first_location.model ? first_location.change : size_t{0};
            const auto end = model_index == last_location.model ? last_location.change + 1 : model->changes.size();

            if (model_index != first_location.model) {
                const auto begins_with_selected_transform =
                        begin < end && begin == 0 &&
                        omega_change_get_kind_(model->changes.front().get()) == change_kind_t::CHANGE_TRANSFORM;
                if (!begins_with_selected_transform && !planner.reset_to_model(session_ptr, model_index, begin)) {
                    return -1;
                }
            }

            for (size_t change_index = begin; change_index < end; ++change_index) {
                const auto &change = model->changes[change_index];
                if (omega_change_get_kind_(change.get()) == change_kind_t::CHANGE_TRANSFORM) {
                    if (!planner.barrier(change)) { return -1; }
                    if (!planner.reset_to_model(session_ptr, model_index, change_index + 1)) { return -1; }
                } else if (!planner.accept(change)) {
                    return -1;
                }
            }
            if (!planner.finish()) { return -1; }
        }

        auto after = planner.snapshot_content();
        auto plan = planner.take_output();
        if (resolved.max_entries > 0 &&
            static_cast<uint64_t>(plan.size()) > static_cast<uint64_t>(resolved.max_entries)) {
            return -2;
        }
        repair_payload_contexts_(plan);
        if (summary_cbk) {
            omega_changelog_export_summary_t summary{};
            summary.resolved_first_change_serial = first;
            summary.resolved_last_change_serial = last;
            summary.source_change_count = last - first + 1;
            summary.before = {before.length, content_read_, &before};
            summary.after = {after.length, content_read_, &after};
            const auto result = summary_cbk(&summary, user_data);
            if (result != 0) { return result; }
        }
        for (auto &entry : plan) {
            const auto result = entry_cbk(&entry.public_entry, user_data);
            if (result != 0) { return result; }
        }
        return 0;
    } catch (const std::bad_alloc &) { return -1; } catch (...) {
        return -1;
    }
}

int omega_edit_export_changelog_optimized(const omega_session_t *session_ptr,
                                          const omega_changelog_export_options_t *options,
                                          omega_changelog_plan_visitor_cbk_t cbk, void *user_data) {
    return omega_edit_export_changelog(session_ptr, options, 1, nullptr, cbk, user_data);
}
