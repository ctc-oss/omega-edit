#!/bin/bash

function build_api {
    m2OrLocal=${1:-"m2"}

    if [[ $m2OrLocal == "m2" ]]; then
        sbt +installM2
    else
        sbt +installLocal
    fi
}

function serv {
    currentDir=${PWD}
    cd src/rpc/server/scala && sbt run
}

function serv_build {
    build_api $1
    serv
}

$@
