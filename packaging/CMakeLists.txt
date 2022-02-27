# Copyright (c) 2021 Concurrent Technologies Corporation.
#
# Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software is distributed under the License is
# distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
# implied.  See the License for the specific language governing permissions and limitations under the License.
include(GNUInstallDirs)
include(CMakePackageConfigHelpers)

if (NOT DEFINED omega_edit_INSTALL_CMAKEDIR)
   set(omega_edit_INSTALL_CMAKEDIR "${CMAKE_INSTALL_LIBDIR}/cmake/omega_edit" CACHE STRING "Path to omega_edit CMake files")
endif ()

install(TARGETS omega_edit EXPORT omega_edit_Targets RUNTIME COMPONENT omega_edit_Runtime LIBRARY COMPONENT omega_edit_Runtime NAMELINK_COMPONENT omega_edit_Development ARCHIVE COMPONENT omega_edit_Development INCLUDES DESTINATION "${CMAKE_INSTALL_INCLUDEDIR}")
install(DIRECTORY "${omega_edit_SOURCE_DIR}/src/include/" "${omega_edit_BINARY_DIR}/src/include/" TYPE INCLUDE COMPONENT omega_edit_Development)

if (BUILD_SHARED_LIBS)
    set(type shared)
else ()
    set(type static)
endif ()

install(EXPORT omega_edit_Targets DESTINATION "${omega_edit_INSTALL_CMAKEDIR}" NAMESPACE omega_edit:: FILE "omega_edit-${type}-targets.cmake" COMPONENT omega_edit_Development)
write_basic_package_version_file(omega_editConfigVersion.cmake COMPATIBILITY SameMajorVersion)
install(FILES "${CMAKE_CURRENT_SOURCE_DIR}/omega_editConfig.cmake" "${CMAKE_CURRENT_BINARY_DIR}/omega_editConfigVersion.cmake" DESTINATION "${omega_edit_INSTALL_CMAKEDIR}" COMPONENT omega_edit_Development)

# TODO: add additional CPack variables here
include(CPack)
