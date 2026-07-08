#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const repoRoot = path.resolve(__dirname, '..')
const isWin = process.platform === 'win32'
const buildType = process.env.OMEGA_EDIT_BUILD_TYPE || 'Release'
const generator =
  process.env.OMEGA_EDIT_CMAKE_GENERATOR || process.env.generator || 'Ninja'
const generatorSlug = slugGenerator(generator)
const isDefaultGenerator = generatorSlug === 'ninja'
const coreBuildDir = path.join(
  repoRoot,
  isDefaultGenerator ? '_build_core' : `_build_core-${generatorSlug}`
)
const coreInstallDir = path.join(repoRoot, '_install_core')
const serverDir = path.join(repoRoot, 'server', 'cpp')
const serverBuildDir = path.join(
  serverDir,
  isDefaultGenerator ? 'build' : `build-${generatorSlug}`
)
const extensionDir = path.join(repoRoot, 'examples', 'vscode-extension')
const coreLibDir = path.join(coreInstallDir, 'lib')
const version = fs.readFileSync(path.join(repoRoot, 'VERSION'), 'utf8').trim()

const commands = new Map([
  ['doctor', doctor],
  ['deps', installDeps],
  ['core:configure', configureCore],
  ['core:build', buildCore],
  ['core:test', testCore],
  ['core:install', installCore],
  ['server:configure', configureServer],
  ['server:build', buildServer],
  ['native', buildNative],
  ['packages', buildPackages],
  ['packages:test', testPackages],
  ['vscode:setup', setupVSCodeExtension],
  ['vscode:build', buildVSCodeExtension],
  ['vscode:test', testVSCodeExtension],
  ['vscode:test:unit', testVSCodeExtensionUnit],
  ['vscode:test:integration', testVSCodeExtensionIntegration],
  ['vscode:package', packageVSCodeExtension],
])

main()

function main() {
  const command = process.argv[2]

  if (!command || command === 'help' || command === '--help') {
    usage(command ? 0 : 1)
  }

  const action = commands.get(command)
  if (!action) {
    console.error(`Unknown command: ${command}`)
    usage(1)
  }

  action()
}

function usage(exitCode) {
  console.log(`Usage: node scripts/dev.js <command>

Common commands:
  doctor                     Check source-development prerequisite tools
  deps                       Install root Yarn deps and extension npm deps
  native                     Configure/build/install core, then configure/build the C++ server
  packages                   Package @omega-edit/server/@omega-edit/client/@omega-edit/ai
  packages:test              Run client and AI package tests
  vscode:setup               Prepare everything needed by the VS Code extension
  vscode:build               Compile the VS Code extension
  vscode:test                Run VS Code extension lint, compile, unit, and integration tests
  vscode:test:unit           Run VS Code extension lint, compile, and unit tests
  vscode:test:integration    Run VS Code extension integration tests
  vscode:package             Build examples/vscode-extension/omega-edit-hex-editor.vsix

Advanced commands:
  core:configure             Configure the core C/C++ build
  core:build                 Build the configured core C/C++ tree
  core:test                  Run core C/C++ tests
  core:install               Install the core package into _install_core
  server:configure           Configure the C++ gRPC server with Conan/CMake
  server:build               Build the C++ gRPC server

Environment:
  OMEGA_EDIT_BUILD_TYPE      CMake build type, default: Release
  OMEGA_EDIT_CMAKE_GENERATOR CMake generator, default: Ninja
  generator                  Legacy alias for OMEGA_EDIT_CMAKE_GENERATOR
  VSCODE_VERSION             VS Code version for integration tests, default: stable
`)
  process.exit(exitCode)
}

function installDeps() {
  run('yarn', ['install'], repoRoot)
  run('npm', ['ci'], extensionDir)
}

function doctor() {
  const checks = [
    { command: 'git', args: ['--version'] },
    { command: 'cmake', args: ['--version'], minVersion: [3, 16, 0] },
    { command: 'conan', args: ['--version'], minVersion: [2, 0, 0] },
    { command: 'python3', args: ['--version'], minVersion: [3, 10, 0] },
    { command: 'node', args: ['--version'], minVersion: [18, 0, 0] },
    { command: 'yarn', args: ['--version'], minVersion: [1, 0, 0] },
    { command: 'npm', args: ['--version'] },
  ]

  if (process.platform === 'darwin') {
    checks.push(
      { command: 'xcode-select', args: ['-p'] },
      { command: 'xcrun', args: ['--find', 'clang++'] },
      { command: 'xcrun', args: ['--show-sdk-path'] },
      {
        label: 'Apple C++17 standard headers',
        probe: probeAppleCxx17Headers,
      }
    )
  }

  let failed = false
  for (const check of checks) {
    if (check.probe) {
      const result = check.probe()
      if (result.ok) {
        console.log(`OK   ${check.label}`)
      } else {
        failed = true
        console.log(`FAIL ${check.label}`)
        console.log(result.message)
      }
      continue
    }

    const { command, args, minVersion } = check
    const result = runMaybe(command, args, repoRoot, { stdio: 'pipe' })
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim()

    if (result.error || result.status !== 0) {
      failed = true
      console.log(`FAIL ${formatCommand(command, args)}`)
      if (result.error) {
        console.log(result.error.message)
      } else if (output) {
        console.log(output)
      }
      continue
    }

    const version = minVersion ? parseVersion(output) : null
    if (minVersion && (!version || compareVersions(version, minVersion) < 0)) {
      failed = true
      console.log(`FAIL ${formatCommand(command, args)}`)
      console.log(
        `Requires ${formatVersion(minVersion)} or newer; found ${version ? formatVersion(version) : 'unknown version'}.`
      )
      continue
    }

    console.log(`OK   ${formatCommand(command, args)}`)
    if (output) {
      console.log(`     ${output.split(/\r?\n/)[0]}`)
    }
  }

  if (failed) {
    console.log('\nInstall the missing prerequisites, then run yarn dev:doctor again.')
    process.exit(1)
  }

  console.log('\nSource-development prerequisite checks passed.')
}

function configureCore() {
  run(
    'cmake',
    [
      '-G',
      generator,
      '-S',
      '.',
      '-B',
      coreBuildDir,
      `-DCMAKE_BUILD_TYPE=${buildType}`,
      '-DBUILD_SHARED_LIBS=OFF',
      '-DBUILD_DOCS=OFF',
      '-DBUILD_EXAMPLES=OFF',
      '-DBUILD_TESTS=ON',
    ],
    repoRoot
  )
}

function buildCore() {
  ensureConfigured(coreBuildDir, 'core:configure')
  run('cmake', ['--build', coreBuildDir, '--config', buildType], repoRoot)
}

function testCore() {
  ensureConfigured(coreBuildDir, 'core:configure')
  run(
    'ctest',
    [
      '--build-config',
      buildType,
      '--test-dir',
      path.join(coreBuildDir, 'core'),
      '--output-on-failure',
    ],
    repoRoot
  )
}

function installCore() {
  ensureConfigured(coreBuildDir, 'core:configure')
  run(
    'cmake',
    [
      '--install',
      path.join(coreBuildDir, 'packages', 'core'),
      '--prefix',
      coreInstallDir,
      '--config',
      buildType,
    ],
    repoRoot
  )
}

function configureServer() {
  ensureCoreInstalled()
  run('conan', ['profile', 'detect', '--force'], serverDir)
  run(
    'conan',
    [
      'install',
      '.',
      `--output-folder=${serverBuildDir}`,
      '--build=missing',
      '-s',
      `build_type=${buildType}`,
      '-s',
      'compiler.cppstd=17',
      '-c',
      `tools.cmake.cmaketoolchain:generator=${generator}`,
    ],
    serverDir
  )

  run(
    'cmake',
    [
      '-G',
      generator,
      '-S',
      '.',
      '-B',
      serverBuildDir,
      `-DCMAKE_BUILD_TYPE=${buildType}`,
      `-DCMAKE_TOOLCHAIN_FILE=${path.join(serverBuildDir, 'conan_toolchain.cmake')}`,
      `-DOE_LIB_DIR=${coreLibDir}`,
      `-DCMAKE_PREFIX_PATH=${coreInstallDir}`,
    ],
    serverDir
  )
}

function buildServer() {
  ensureConfigured(serverBuildDir, 'server:configure')
  run('cmake', ['--build', serverBuildDir, '--config', buildType], serverDir)
}

function buildNative() {
  configureCore()
  buildCore()
  testCore()
  installCore()
  configureServer()
  buildServer()
}

function buildPackages() {
  run('yarn', ['workspace', '@omega-edit/server', 'package'], repoRoot)
  run('yarn', ['workspace', '@omega-edit/client', 'package'], repoRoot)
  run('yarn', ['workspace', '@omega-edit/ai', 'package'], repoRoot)
}

function testPackages() {
  run('yarn', ['workspace', '@omega-edit/client', 'test'], repoRoot)
  run('yarn', ['workspace', '@omega-edit/ai', 'test'], repoRoot)
}

function setupVSCodeExtension() {
  run('yarn', ['install'], repoRoot)
  buildNative()
  buildPackages()
  run('npm', ['ci'], extensionDir)
  installLocalVSCodePackages()
}

function buildVSCodeExtension() {
  run('npm', ['run', 'compile'], extensionDir)
}

function testVSCodeExtension() {
  run('npm', ['test'], extensionDir)
}

function testVSCodeExtensionUnit() {
  run('npm', ['run', 'lint'], extensionDir)
  run('npm', ['run', 'compile'], extensionDir)
  run('npm', ['run', 'test:unit'], extensionDir)
}

function testVSCodeExtensionIntegration() {
  run('npm', ['run', 'test:integration'], extensionDir)
}

function packageVSCodeExtension() {
  ensureVSCodePackagingNodeVersion()

  const restorePackageJson = usePackagedVSCodeDependencySpecs()
  const result = runMaybe('npm', ['run', 'package:vsix'], extensionDir)
  restorePackageJson()

  if (result.error) {
    console.error(result.error)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function installLocalVSCodePackages() {
  run(
    'npm',
    [
      'install',
      '--no-save',
      '--package-lock=false',
      '--no-audit',
      '--fund=false',
      packageTarball('server', 'omega-edit-node-server'),
      packageTarball('client', 'omega-edit-node-client'),
    ],
    extensionDir
  )
}

function ensureConfigured(buildDir, configureCommand) {
  if (fs.existsSync(path.join(buildDir, 'CMakeCache.txt'))) {
    return
  }

  console.error(
    `Missing CMake configuration at ${buildDir}. Run "yarn ${configureCommand}" first.`
  )
  process.exit(1)
}

function ensureCoreInstalled() {
  if (fs.existsSync(coreLibDir)) {
    return
  }

  console.error(
    `Missing installed core library at ${coreLibDir}. Run "yarn native" or "yarn core:install" first.`
  )
  process.exit(1)
}

function packageTarball(workspaceName, packageStem) {
  const tarballPath = path.join(
    repoRoot,
    'packages',
    workspaceName,
    `${packageStem}-v${version}.tgz`
  )

  if (!fs.existsSync(tarballPath)) {
    console.error(`Missing package tarball: ${tarballPath}`)
    console.error('Run "yarn packages:build" first.')
    process.exit(1)
  }

  return tarballPath
}

function usePackagedVSCodeDependencySpecs() {
  const packageJsonPath = path.join(extensionDir, 'package.json')
  const original = fs.readFileSync(packageJsonPath, 'utf8')
  const packageJson = JSON.parse(original)

  packageJson.dependencies = {
    ...packageJson.dependencies,
    '@omega-edit/client': version,
  }

  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

  return () => {
    fs.writeFileSync(packageJsonPath, original)
  }
}

function ensureVSCodePackagingNodeVersion() {
  const minimum = [20, 18, 1]
  const current = parseVersion(process.version)

  if (current && compareVersions(current, minimum) >= 0) {
    return
  }

  console.error(
    `VS Code extension packaging requires Node ${formatVersion(minimum)} or newer; found ${process.version}.`
  )
  console.error('Use a Node 20.18+ shell, then rerun yarn vscode:package.')
  process.exit(1)
}

function run(command, args, cwd, options = {}) {
  const result = runMaybe(command, args, cwd, options)

  if (result.error) {
    console.error(result.error)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function runMaybe(command, args, cwd, options = {}) {
  console.log(`\n> ${formatCommand(command, args)}`)
  const serverBinaryPath = getServerBinaryPath()
  return spawnSync(resolveCommand(command), args, {
    cwd,
    stdio: options.stdio || 'inherit',
    shell: false,
    env: {
      ...process.env,
      OE_LIB_DIR: coreLibDir,
      OE_PREFIX: coreInstallDir,
      ...(serverBinaryPath ? { CPP_SERVER_BINARY: serverBinaryPath } : {}),
    },
  })
}

function resolveCommand(command) {
  if (!isWin) {
    return command
  }

  if (command === 'yarn') {
    return 'yarn.cmd'
  }

  if (command === 'npm') {
    return 'npm.cmd'
  }

  if (command === 'conan') {
    return 'conan.exe'
  }

  if (command === 'cmake') {
    return 'cmake.exe'
  }

  if (command === 'ctest') {
    return 'ctest.exe'
  }

  return command
}

function formatCommand(command, args) {
  return [command, ...args.map(formatArg)].join(' ')
}

function formatArg(arg) {
  if (!/\s/.test(arg)) {
    return arg
  }

  return `"${arg.replaceAll('"', '\\"')}"`
}

function slugGenerator(rawGenerator) {
  return rawGenerator
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function getServerBinaryPath() {
  const binaryName = isWin ? 'omega-edit-grpc-server.exe' : 'omega-edit-grpc-server'
  const candidates = [
    path.join(serverBuildDir, binaryName),
    path.join(serverBuildDir, buildType, binaryName),
    path.join(serverBuildDir, 'Debug', binaryName),
    path.join(serverBuildDir, 'Release', binaryName),
  ]

  return candidates.find((candidate) => fs.existsSync(candidate))
}

function parseVersion(text) {
  const match = text.match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!match) {
    return null
  }

  return [Number(match[1]), Number(match[2]), Number(match[3] || 0)]
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) {
      return 1
    }
    if (left[index] < right[index]) {
      return -1
    }
  }

  return 0
}

function formatVersion(version) {
  return version.join('.')
}

function probeAppleCxx17Headers() {
  const source = [
    '#include <cstdint>',
    '#include <filesystem>',
    '#include <optional>',
    '#include <variant>',
    'int main() { std::optional<int> value = 1; return *value; }',
    '',
  ].join('\n')
  const result = spawnSync(
    resolveCommand('xcrun'),
    ['clang++', '-x', 'c++', '-std=c++17', '-fsyntax-only', '-'],
    {
      cwd: repoRoot,
      input: source,
      encoding: 'utf8',
      shell: false,
    }
  )

  if (result.status === 0) {
    return { ok: true }
  }

  const output = `${result.stderr || ''}${result.stdout || ''}`.trim()
  return {
    ok: false,
    message: [
      'Apple clang++ could not compile a minimal C++17 standard-header probe.',
      'This usually means the selected Xcode Command Line Tools install is incomplete or mismatched.',
      firstDiagnosticLine(output),
    ]
      .filter(Boolean)
      .join('\n'),
  }
}

function firstDiagnosticLine(output) {
  return output
    .split(/\r?\n/)
    .find((line) => /fatal error:|error:/.test(line))
}
