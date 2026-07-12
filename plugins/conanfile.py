from conan import ConanFile


class OmegaEditTransformPluginsConan(ConanFile):
    """Conan recipe for Omega Edit transform plugin dependencies."""

    settings = "os", "compiler", "build_type", "arch"
    generators = "CMakeDeps", "CMakeToolchain"

    def requirements(self):
        self.requires("openssl/3.3.2")
        self.requires("protobuf/5.27.0")
        self.requires("zlib/1.3.1")
        self.requires("zstd/1.5.6")
        if self.settings.os != "Windows":
            self.requires("libmagic/5.45")

    def layout(self):
        self.folders.source = "."
        self.folders.build = "."
        self.folders.generators = "."
