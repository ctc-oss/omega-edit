/**********************************************************************************************************************
 * Copyright (c) 2021 Concurrent Technologies Corporation.                                                            *
 *                                                                                                                    *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance     *
 * with the License.  You may obtain a copy of the License at                                                         *
 *                                                                                                                    *
 *     http://www.apache.org/licenses/LICENSE-2.0                                                                     *
 *                                                                                                                    *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed *
 * on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.                    *
 * See the License for the specific language governing permissions and limitations under the License.                *
 *                                                                                                                    *
 **********************************************************************************************************************/

#ifndef OMEGA_EDIT_RETAINED_HISTORY_HPP
#define OMEGA_EDIT_RETAINED_HISTORY_HPP

#include "change_def.hpp"
#include "model_def.hpp"
#include "session_def.hpp"

#include <cstdint>
#include <limits>

namespace omega_edit::internal {

    inline bool retained_history_serial_(const omega_change_t *change, int64_t &serial) {
        if (!change || change->serial == 0 || change->serial == (std::numeric_limits<int64_t>::min)()) { return false; }
        serial = change->serial < 0 ? -change->serial : change->serial;
        return true;
    }

    template<typename Visitor>
    int visit_retained_undo_sequence_(const omega_changes_t &changes, bool reverse, Visitor &visitor);

    template<typename Visitor>
    int visit_retained_change_(const omega_change_t *change, bool reverse, Visitor &visitor) {
        if (!change) { return -1; }
        if (reverse && change->transform_data) {
            const auto result =
                    visit_retained_undo_sequence_(change->transform_data->preserved_changes_undone, true, visitor);
            if (result != 0) { return result; }
        }
        int64_t serial = 0;
        if (!retained_history_serial_(change, serial)) { return -1; }
        const auto result = visitor(change, serial);
        if (result != 0) { return result; }
        if (!reverse && change->transform_data) {
            return visit_retained_undo_sequence_(change->transform_data->preserved_changes_undone, false, visitor);
        }
        return 0;
    }

    template<typename Visitor>
    int visit_retained_undo_sequence_(const omega_changes_t &changes, bool reverse, Visitor &visitor) {
        if (reverse) {
            for (const auto &change : changes) {
                const auto result = visit_retained_change_(change.get(), true, visitor);
                if (result != 0) { return result; }
            }
        } else {
            for (auto iterator = changes.crbegin(); iterator != changes.crend(); ++iterator) {
                const auto result = visit_retained_change_(iterator->get(), false, visitor);
                if (result != 0) { return result; }
            }
        }
        return 0;
    }

    template<typename Visitor>
    int visit_future_model_(const omega_model_t *model, bool reverse, Visitor &visitor) {
        if (!model) { return -1; }
        if (reverse) {
            const auto undone_result = visit_retained_undo_sequence_(model->changes_undone, true, visitor);
            if (undone_result != 0) { return undone_result; }
            for (auto iterator = model->changes.crbegin(); iterator != model->changes.crend(); ++iterator) {
                const auto result = visit_retained_change_(iterator->get(), true, visitor);
                if (result != 0) { return result; }
            }
        } else {
            for (const auto &change : model->changes) {
                const auto result = visit_retained_change_(change.get(), false, visitor);
                if (result != 0) { return result; }
            }
            return visit_retained_undo_sequence_(model->changes_undone, false, visitor);
        }
        return 0;
    }

    /**
     * Visit the complete redoable suffix in logical serial order. Logical serials are always positive even when the
     * underlying change is currently stored with a negative serial.
     */
    template<typename Visitor>
    int visit_retained_history_(const omega_session_t *session, bool reverse, Visitor &&visitor) {
        if (!session) { return -1; }
        if (reverse) {
            for (const auto &model : session->checkpoint_future_models_) {
                const auto result = visit_future_model_(model.get(), true, visitor);
                if (result != 0) { return result; }
            }
            for (const auto &model : session->models_) {
                const auto result = visit_retained_undo_sequence_(model->changes_undone, true, visitor);
                if (result != 0) { return result; }
            }
        } else {
            for (auto iterator = session->models_.crbegin(); iterator != session->models_.crend(); ++iterator) {
                const auto result = visit_retained_undo_sequence_((*iterator)->changes_undone, false, visitor);
                if (result != 0) { return result; }
            }
            for (auto iterator = session->checkpoint_future_models_.crbegin();
                 iterator != session->checkpoint_future_models_.crend(); ++iterator) {
                const auto result = visit_future_model_(iterator->get(), false, visitor);
                if (result != 0) { return result; }
            }
        }
        return 0;
    }

    /** Visit active changes followed by the retained redo suffix as one logical history. */
    template<typename Visitor>
    int visit_complete_history_(const omega_session_t *session, bool reverse, Visitor &&visitor) {
        if (!session) { return -1; }
        if (reverse) {
            const auto retained_result = visit_retained_history_(session, true, visitor);
            if (retained_result != 0) { return retained_result; }
            for (auto model = session->models_.crbegin(); model != session->models_.crend(); ++model) {
                for (auto change = (*model)->changes.crbegin(); change != (*model)->changes.crend(); ++change) {
                    int64_t serial = 0;
                    if (!retained_history_serial_(change->get(), serial)) { return -1; }
                    const auto result = visitor(change->get(), serial);
                    if (result != 0) { return result; }
                }
            }
        } else {
            for (const auto &model : session->models_) {
                for (const auto &change : model->changes) {
                    int64_t serial = 0;
                    if (!retained_history_serial_(change.get(), serial)) { return -1; }
                    const auto result = visitor(change.get(), serial);
                    if (result != 0) { return result; }
                }
            }
            return visit_retained_history_(session, false, visitor);
        }
        return 0;
    }

}// namespace omega_edit::internal

#endif//OMEGA_EDIT_RETAINED_HISTORY_HPP
