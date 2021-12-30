{
  "targets": [
    {
      "target_name": "omega_edit_<(OS)",
      "include_dirs": ["src/include"],
      "defines": [
        # TODO: Programmatically set the version information
        "OMEGA_EDIT_VERSION_MAJOR=0",
        "OMEGA_EDIT_VERSION_MINOR=6",
        "OMEGA_EDIT_VERSION_PATCH=2",
        "NAPI_DISABLE_CPP_EXCEPTIONS",
      ],
      "cflags!": ["-fno-exceptions", "-Wall", "-Werror"],
      "cflags_cc!": ["-fno-exceptions", "-Wall", "-Werror"],
      "sources": [
        "src/lib/change.cpp",
        "src/lib/check.cpp",
        "src/lib/edit.cpp",
        "src/lib/encodings.c",
        "src/lib/license.c",
        "src/lib/search.cpp",
        "src/lib/session.cpp",
        "src/lib/utility.c",
        "src/lib/version.c",
        "src/lib/viewport.cpp",
        "src/lib/visit.cpp",
        "src/lib/impl_/find.cpp",
        "src/lib/impl_/internal_fun.cpp",
        "src/bindings/omega_edit_wrap.cxx"
      ],
    },
    {
      "target_name": "copy_binary",
      "type":"none",
      "dependencies" : [ "omega_edit_<(OS)" ],
      "copies": [
        {
          'destination': '<(module_root_dir)/module/',
          'files': ['<(module_root_dir)/build/Release/omega_edit_<(OS).node']
        }
      ]
    },
  ]
}