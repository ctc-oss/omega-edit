# Copyright (c) 2021-2022 Concurrent Technologies Corporation.
#
# Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software is distributed under the License is
# distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
# implied.  See the License for the specific language governing permissions and limitations under the License.

if(MSYS)
    find_library(LibUUID_LIBRARY NAMES msys-uuid-1.dll)
elseif(CYGWIN)
    set(old_suffixes ${CMAKE_FIND_LIBRARY_SUFFIXES})
    set(CMAKE_FIND_LIBRARY_SUFFIXES .dll)
    find_library(LibUUID_LIBRARY NAMES cyguuid-1.dll)
    set(CMAKE_FIND_LIBRARY_SUFFIXES ${old_suffixes})
else()
    find_library(LibUUID_LIBRARY NAMES libuuid.a)
endif()
mark_as_advanced(LibUUID_LIBRARY)
find_path(LibUUID_INCLUDE_DIR NAMES uuid/uuid.h)
mark_as_advanced(LibUUID_INCLUDE_DIR)

include(FindPackageHandleStandardArgs)
find_package_handle_standard_args(LibUUID FOUND_VAR LibUUID_FOUND REQUIRED_VARS LibUUID_LIBRARY LibUUID_INCLUDE_DIR)
set(LIBUUID_FOUND ${LibUUID_FOUND})

if(LibUUID_FOUND)
    set(LibUUID_INCLUDE_DIRS ${LibUUID_INCLUDE_DIR})
    set(LibUUID_LIBRARIES ${LibUUID_LIBRARY})
    if(NOT TARGET LibUUID::LibUUID)
        add_library(LibUUID::LibUUID UNKNOWN IMPORTED)
        set_target_properties(LibUUID::LibUUID PROPERTIES
                IMPORTED_LOCATION "${LibUUID_LIBRARY}"
                INTERFACE_INCLUDE_DIRECTORIES "${LibUUID_INCLUDE_DIRS}"
                )
    endif()
endif()
