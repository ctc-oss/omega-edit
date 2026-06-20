from conan import ConanFile


class OmegaEditTransformPluginsConan(ConanFile):
    """Conan recipe for Omega Edit transform plugin dependencies."""

    settings = "os", "compiler", "build_type", "arch"
    generators = "CMakeDeps", "CMakeToolchain"

    def requirements(self):
        self.requires("openssl/3.3.2")
        self.requires("zlib/1.3.1")

    def layout(self):
        self.folders.source = "."
        self.folders.build = "."
        self.folders.generators = "."
