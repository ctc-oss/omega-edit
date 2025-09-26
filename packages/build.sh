#!/usr/bin/env bash
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
root_path_regex="[\/]omega-edit$"
link_script_dir=$(realpath ${0%/*})
project_root_dir=${link_script_dir%%/packages}
oe_lib_install="${OE_LIB_DIR:=$project_root_dir/_install/lib}"

yarn_link_dir=$HOME/.config/yarn/link/@omega-edit
yarn_link_client_dir=$yarn_link_dir/client
yarn_link_server_dir=$yarn_link_dir/server

client_src=$link_script_dir/client
client_out=$client_src/out

server_src=$link_script_dir/server
server_out=$server_src/out

log_msg() {
    echo -e "[=] $@\n"
}

log_err() {
    echo -e "[!] $@\n"
}

usage() {
  echo -e "Usage: build.sh <OPT> [ARG]
OPTIONS:
  -p | Only packages the @omega-edit/client and @omega-edit/server modules.

  -c | Create @omega-edit/client and @omega-edit/server yarn links.
       If the packages do not exists then this script will execute this.
       If the packages do exist, the script will exit.
        -f | Destroy and repackage & link the modules.

  -d | Destroy the @omega-edit/client and @omega-edit/server yarn links.

  -l | Execute yarn to link the @omega-edit packages to the <ARG> directory.
       This option calls back to the '-c' option execution.
        Example: build.sh -l ~/path/to/another/project
  "
}

# Check the Omega Edit install directory for the locally installed, or OE_LIB_DIR environment variable, library directory
# The packages cannot be built unless Omega Edit has successfully built and been installed.
check_oe_install() {
  
  [[ ! $(find $oe_lib_install -iregex ".*libomega_edit[.].*" 2>/dev/null) ]] && { log_err "Omega Edit local install directory does not contain built library. \n    Build the Omega Edit library prior to executing this command" ; exit 1 ; }
}

# Destroys the cached link directories for yarn
destroy_oe_links() {
  if [[ ! -d $yarn_link_client_dir ]]; then 
    log_err "@omega-edit/client package link does not exist"
  else
    echo -e "\n[ ] Removing package link to => $yarn_link_client_dir"
    yarn workspace @omega-edit/client unlink
    rm -rf $yarn_link_client_dir
  fi 

  if [[ ! -d $yarn_link_server_dir ]]; then 
    log_err "@omega-edit/server package link does not exist"
  else
    echo -e "\n[ ] Removing package link to =>  $yarn_link_server_dir"
    yarn workspace @omega-edit/server unlink
    rm -rf $yarn_link_server_dir
  fi
}

# Creates yarn links to the @omega-edit packages
#   yarn links are symbolic links to the ./client, ./server directories
#   and are automatically updated in linked project's node_modules directory
#   when the yarn package script is re-ran
create_oe_links() {
  
  check_oe_install
  
  [[ $opt_force -eq 1 ]] && { destroy_oe_links ; }

  log_msg "Creating package link to => $yarn_link_server_dir"
  if [[ -e $yarn_link_server_dir ]]; then 
    log_err "@omega-edit/server package is already linked"
  else
    [[ ! -e $server_out ]] && {
        log_msg "Server package not built... building"
        yarn workspace @omega-edit/server package
        [[ $? -ne 0 ]] && { log_err "Failed to package @omega-edit/server" ; exit 1 ; }
    }
    yarn workspace @omega-edit/server link
  fi

  log_msg "Creating package link to => $yarn_link_client_dir"
  if [[ -e $yarn_link_client_dir ]]; then 
    log_err "@omega-edit/client package is already linked"
  else
    [[ ! -e $client_out ]] && {
        log_msg "Client package not built... building"
        yarn workspace @omega-edit/client package
        [[ $? -ne 0 ]] && { log_err "Failed to package @omega-edit/client" ; exit 1 ; }
    }
    yarn workspace @omega-edit/client link
  fi 

}


# Links the @omega-edit packages in the yarn link cache to a project directory
link_to_project() {
  destination_dir=$1

  [[ ! -e $destination_dir ]] && {  
    log_err "Cannot link packages to '${destination_dir}': Does not exist\n" 
    exit 1
  }

  create_oe_links
  
  (cd "$destination_dir"; yarn link @omega-edit/client; yarn link @omega-edit/server)
}

# Prepares and packages both client & server modules.
package_oe_modules() {
  yarn workspace @omega-edit/server package && yarn workspace @omega-edit/client package
}

opt_force=0

while getopts "fpcdl:" opt; do
  case $opt in
    f) opt_force=1 ;;
    p) package_oe_modules ; exit 0 ;;
    d) destroy_oe_links ;;
    c) create_oe_links ;;
    l) link_to_project $OPTARG ;;
    \?) { usage ; exit 1 ; } ;;
  esac
done
shift $((OPTIND - 1))
