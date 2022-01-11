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

{
  "targets": [
    {
      "target_name": "omega_edit_<(OS)",
      "include_dirs": ["src/include", "vendor/cwalk/include"],
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
        "src/bindings/node/omega_edit_wrap.cxx",
        "src/lib/change.cpp",
        "src/lib/check.cpp",
        "src/lib/edit.cpp",
        "src/lib/encodings.c",
        "src/lib/impl_/find.cpp",
        "src/lib/impl_/internal_fun.cpp",
        "src/lib/license.c",
        "src/lib/search.cpp",
        "src/lib/session.cpp",
        "src/lib/utility.c",
        "src/lib/version.c",
        "src/lib/viewport.cpp",
        "src/lib/visit.cpp",
        "vendor/cwalk/src/cwalk.c"
      ],
    },
    {
      "target_name": "copy_binary",
      "type":"none",
      "dependencies" : [ "omega_edit_<(OS)" ],
      "copies": [
        {
          'destination': '<(module_root_dir)/module/omega_edit',
          'files': ['<(module_root_dir)/build/Release/omega_edit_<(OS).node']
        }
      ]
    },
  ]
}