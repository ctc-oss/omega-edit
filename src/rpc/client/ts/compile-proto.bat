@REM Copyright (c) 2021 Concurrent Technologies Corporation.
@REM 
@REM Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance
@REM with the License.  You may obtain a copy of the License at
@REM 
@REM     http://www.apache.org/licenses/LICENSE-2.0
@REM 
@REM Unless required by applicable law or agreed to in writing, software is distributed under the License is
@REM distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
@REM implied.  See the License for the specific language governing permissions and limitations under the License.

@echo off
set "OUT_DIR=%cd%\src"
set "TS_OUT_DIR=%cd%\src"

set "IN_DIR=%cd%\..\..\protos"

set "PROTOC=%cd%\node_modules\.bin\grpc_tools_node_protoc.cmd"
set "PROTOC_GEN_TS_PATH=%cd%\node_modules\.bin\protoc-gen-ts.cmd"
set "PROTOC_GEN_GRPC_PATH=%cd%\node_modules\.bin\grpc_tools_node_protoc_plugin.cmd"

cd "%IN_DIR%"
%PROTOC% ^
    --plugin=protoc-gen-ts="%PROTOC_GEN_TS_PATH%" ^
    --plugin=protoc-gen-grpc="%PROTOC_GEN_GRPC_PATH%" ^
    --js_out=import_style=commonjs:"%OUT_DIR%" ^
    --grpc_out=grpc_js:"%OUT_DIR%" ^
    --ts_out=grpc_js:"%TS_OUT_DIR%" ^
    omega_edit.proto
