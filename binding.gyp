{
  "targets": [
    {
      "target_name": "omega_edit_<(OS)",
      "sources": [
        "src/lib/change.cpp",
        "src/lib/check.cpp",
        "src/lib/edit.cpp",
        "src/lib/encodings.c",
        "src/lib/license.c",
        "src/lib/match.cpp",
        "src/lib/session.cpp",
        "src/lib/utility.c",
        "src/lib/viewport.cpp",
        "src/lib/visit.cpp",
        "src/lib/impl_/internal_fun.cpp",
        "src/lib/impl_/search.cpp",
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