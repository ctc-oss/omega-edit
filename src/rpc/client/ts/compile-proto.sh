#!/usr/bin/env bash

# Copyright (c) 2021 Concurrent Technologies Corporation.
#                                                                                                               
# Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at                                                    
#                                                                                                               
#     http://www.apache.org/licenses/LICENSE-2.0                                                                
#                                                                                                               
# Unless required by applicable law or agreed to in writing, software is distributed under the License is       
# distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or              
# implied.  See the License for the specific language governing permissions and limitations under the License.  


# OUT_DIR="../client/types/omega-edit"
# TS_OUT_DIR="../client/types/omega-edit"
OUT_DIR="../client/ts"
TS_OUT_DIR="../client/ts"
IN_DIR="../../protos"
PROTOC="$(yarn bin)/grpc_tools_node_protoc"
PROTOC_GEN_TS_PATH="$(yarn bin)/protoc-gen-ts"
PROTOC_GEN_GRPC_PATH="$(yarn bin)/grpc_tools_node_protoc_plugin"

cd $IN_DIR

# mkdir -p ${OUT_DIR} || true
# mkdir -p ${TS_OUT_DIR} || true

$PROTOC \
    --plugin=protoc-gen-ts=${PROTOC_GEN_TS_PATH} \
    --plugin=protoc-gen-grpc=${PROTOC_GEN_GRPC_PATH} \
    --js_out=import_style=commonjs:${OUT_DIR} \
    --grpc_out=grpc_js:${OUT_DIR} \
    --ts_out=grpc_js:${TS_OUT_DIR} \
    omega_edit.proto

cd $current_dir
