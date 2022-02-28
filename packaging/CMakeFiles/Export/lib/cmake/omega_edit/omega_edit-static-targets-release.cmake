#----------------------------------------------------------------
# Generated CMake target import file for configuration "Release".
#----------------------------------------------------------------

# Commands may need to know the format version.
set(CMAKE_IMPORT_FILE_VERSION 1)

# Import target "omega_edit::omega_edit" for configuration "Release"
set_property(TARGET omega_edit::omega_edit APPEND PROPERTY IMPORTED_CONFIGURATIONS RELEASE)
set_target_properties(omega_edit::omega_edit PROPERTIES
  IMPORTED_LINK_INTERFACE_LANGUAGES_RELEASE "C;CXX"
  IMPORTED_LOCATION_RELEASE "${_IMPORT_PREFIX}/lib/libomega_edit.a"
  )

list(APPEND _IMPORT_CHECK_TARGETS omega_edit::omega_edit )
list(APPEND _IMPORT_CHECK_FILES_FOR_omega_edit::omega_edit "${_IMPORT_PREFIX}/lib/libomega_edit.a" )

# Commands beyond this point should not need to know the version.
set(CMAKE_IMPORT_FILE_VERSION)
