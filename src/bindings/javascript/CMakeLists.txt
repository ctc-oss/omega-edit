find_package(SWIG REQUIRED)
include(${SWIG_USE_FILE})
include_directories(../..)
set(CMAKE_SWIG_FLAGS "")

set_source_files_properties(../${PROJECT_NAME}.i PROPERTIES CPLUSPLUS ON)
set_source_files_properties(../${PROJECT_NAME}.i PROPERTIES SWIG_FLAGS "-node")
swig_add_module(omega_edit_javascript javascript ../${PROJECT_NAME}.i)
