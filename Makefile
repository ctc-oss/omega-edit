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

lib/$(LIBNAME): CMakeLists.txt
	cmake -G $(GENERATOR) -S . -B _build -DBUILD_SHARED_LIBS=YES -DBUILD_DOCS=NO -DCMAKE_BUILD_TYPE=$(TYPE)
	cmake --build _build
	ctest -C $(TYPE) --test-dir _build --output-on-failure
	cmake --install _build/packaging --prefix _install --config $(TYPE)
	rm -rf lib/
	cp -av _install/lib lib/

clean:
	rm -rf _build _install lib

all: lib/$(LIBNAME)
	@echo $<
