# Set up swig
find_package(SWIG REQUIRED)
include(${SWIG_USE_FILE})

# Build bindings as desired
if(BUILD_JAVASCRIPT)
    add_subdirectory(javascript)
endif(BUILD_JAVASCRIPT)
