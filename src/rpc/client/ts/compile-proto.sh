#!/usr/bin/env bash

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
