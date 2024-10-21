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
  # Make sure version is set for this target
	@if [ -z "$(version)" ]; then \
		echo "version is not set, please run \`make update-version version=1.2.3\` where 1.2.3 is the new version"; \
		exit 1; \
	fi
	@sed -i '' -e 's|"version": .*|"version": "$(version)",|' package.json packages/server/package.json packages/client/package.json
	@sed -i '' -e 's|"\@omega-edit\/server": .*|"\@omega-edit\/server": "$(version)",|' packages/client/package.json
	@sed -i '' -e '/project(omega_edit/{N;s|.* VERSION .*|project(omega_edit\n        VERSION $(version)|;}' CMakeLists.txt
	@echo "------------------------------------------------------------------------"
	@echo "Updated version to v$(version), next steps:"
	@echo "  git commit -am \"v$(version) [node_publish]\""
	@echo "  git push origin main"
	@echo "Wait for CI to pass, then tag the release to publish the artifacts:"
	@echo "  git tag -a v$(version) -m \"v$(version)\""
	@echo "  git push origin v$(version)"
	@echo "------------------------------------------------------------------------"

clean:
	rm -rf _build _install lib/$(LIBNAME)

all: lib/$(LIBNAME)
	@echo $<

.default: all
.phony: all clean update-version
