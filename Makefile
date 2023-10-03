########################################################################################################################
# Copyright (c) 2021 Concurrent Technologies Corporation.                                                              #
#                                                                                                                      #
# Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance       #
# with the License.  You may obtain a copy of the License at                                                           #
#                                                                                                                      #
#     http://www.apache.org/licenses/LICENSE-2.0                                                                       #
#                                                                                                                      #
# Unless required by applicable law or agreed to in writing, software is distributed under the License is              #
# distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or                     #
# implied.  See the License for the specific language governing permissions and limitations under the License.         #
#                                                                                                                      #
########################################################################################################################
UNAME := $(shell uname)
GENERATOR := "Unix Makefiles"
TYPE ?= Debug

ifeq ($(UNAME),Linux)
  LIBNAME = libomega_edit.so
else
  ifeq ($(UNAME),Darwin)
    LIBNAME = libomega_edit.dylib
  else
    LIBNAME = omega_edit.dll
  endif
endif

lib/$(LIBNAME): CMakeLists.txt core/CMakeLists.txt
	cmake -G $(GENERATOR) -S . -B _build -DBUILD_SHARED_LIBS=YES -DBUILD_DOCS=NO -DBUILD_EXAMPLES=NO -DCMAKE_BUILD_TYPE=$(TYPE)
	cmake --build _build --config $(TYPE)
	ctest -C $(TYPE) --test-dir _build/core --output-on-failure
	cmake --install _build/packages/core --prefix _install --config $(TYPE)
	mkdir -p lib
	cp _install/lib/$(LIBNAME) $@

update-version:
	sed -i '' -e 's|"version": .*|"version": "$(version)",|' package.json packages/server/package.json packages/client/package.json
	sed -i '' -e 's|"\@omega-edit\/server": .*|"\@omega-edit\/server": "$(version)",|' packages/client/package.json
	sed -i '' -e '/project(omega_edit/{N;s|.* VERSION .*|project(omega_edit\n        VERSION $(version)|;}' CMakeLists.txt

clean:
	rm -rf _build _install lib/$(LIBNAME)

all: lib/$(LIBNAME)
	@echo $<

.default: all
