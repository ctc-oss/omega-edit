# Docker builds

The Dockerfiles in this directory can be used to create docker images that an IDE can use to build the project under
various build environments.  The docker service needs to be [setup and running](https://docs.docker.com/get-docker/) on
the host device.

# Creating the build images

At the top of each Dockerfile is an example of how to use the Dockerfile to build the docker image that the IDE can use
to build the project.  For example, to build a CentOS 8 environment, from this directory, the docker build command will
look something like this:

```bash
docker build -t build/centos-8/cpp-env:1.0 -f Dockerfile.centos8-cpp-env .
```

Similarly for Ubuntu 20:

```bash
docker build -t build/ubuntu-20.04/cpp-env:1.0 -f Dockerfile.ubuntu20-cpp-env .
```

With these images built we can use them in an IDE for building the project.

## CLion

CLion has built-in support for Docker container toolchains.

### Define the toolchains
In CLion, go to `Preferences > Build, Execution, Deployment > Toolchains` and add a new Docker toolchain.  It should
detect the local Docker server.  Then select one of the build images created above.  Name the new toolchain something
meaningful, like `Docker-Centos-8` if using the CentOS 8 docker image.  CLion will automatically detect the various
required build tools inside the container.  Now click `Apply`.

### Add CMake profiles

In CLion, go to `Preferences > Build, Execution, Deployment > CMake`, add a new profile, then under `Toolchain` select
one of the new docker toolchains that we defined above.  Choose the build type (e.g., Release, Debug, etc. and the
`Generator`.  Now click `Apply`, then `Ok`.

### Build using the new CMake docker configurations

Once the new profiles are added, CLion will refresh the project's CMake build configurations.  Select one of the new
docker configurations and build the various desired targets (e.g., omega_test).
