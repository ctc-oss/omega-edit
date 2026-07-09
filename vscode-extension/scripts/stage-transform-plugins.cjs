#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const supportedPlatforms = [
  { id: 'linux-x64', extensions: ['.so'] },
  { id: 'linux-arm64', extensions: ['.so'] },
  { id: 'macos-x64', extensions: ['.dylib', '.so'] },
  { id: 'macos-arm64', extensions: ['.dylib', '.so'] },
  { id: 'windows-x64', extensions: ['.dll'] },
]

const args = process.argv.slice(2)
let sourceArg = ''
let platformFilter = ''

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]
  if (arg === '--platform') {
    platformFilter = args[index + 1] || ''
    if (!platformFilter || platformFilter.startsWith('--')) {
      throw new Error('Missing value for --platform')
    }
    index += 1
    continue
  }

  if (arg.startsWith('--platform=')) {
    platformFilter = arg.slice('--platform='.length)
    if (!platformFilter) {
      throw new Error('Missing value for --platform')
    }
    continue
  }

  if (arg.startsWith('--')) {
    throw new Error(`Unknown option: ${arg}`)
  }

  if (sourceArg) {
    throw new Error(`Unexpected extra argument: ${arg}`)
  }

  sourceArg = arg
}

const root = path.resolve(__dirname, '..')
sourceArg ||= process.env.OMEGA_EDIT_TRANSFORM_PLUGINS_DIR || ''
const sourceRoot = sourceArg ? path.resolve(sourceArg) : ''
const destinationRoot = path.join(root, 'bundled', 'transform-plugins')
const platforms = platformFilter
  ? supportedPlatforms.filter((platform) => platform.id === platformFilter)
  : supportedPlatforms

if (platformFilter && platforms.length === 0) {
  throw new Error(`Unsupported transform plugin platform: ${platformFilter}`)
}

if (!sourceRoot || !fs.existsSync(sourceRoot)) {
  throw new Error(
    `Transform plugin source directory not found: ${sourceRoot || '(empty)'}`
  )
}

fs.rmSync(destinationRoot, { recursive: true, force: true })

for (const platform of platforms) {
  const sourceDir = path.join(sourceRoot, platform.id)
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`Missing transform plugin directory: ${sourceDir}`)
  }

  const plugins = fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith('omega_transform_') &&
        platform.extensions.some((extension) => entry.name.endsWith(extension))
    )
    .map((entry) => entry.name)
    .sort()

  if (plugins.length === 0) {
    throw new Error(
      `No ${platform.extensions.join('/')} transform plugins in ${sourceDir}`
    )
  }

  const destinationDir = path.join(destinationRoot, platform.id)
  fs.mkdirSync(destinationDir, { recursive: true })
  for (const plugin of plugins) {
    const destination = path.join(destinationDir, plugin)
    fs.copyFileSync(path.join(sourceDir, plugin), destination)
    if (!plugin.endsWith('.dll')) {
      fs.chmodSync(destination, 0o755)
    }
  }

  const magicDb = path.join(sourceDir, 'magic.mgc')
  if (fs.existsSync(magicDb) && fs.statSync(magicDb).isFile()) {
    fs.copyFileSync(magicDb, path.join(destinationDir, 'magic.mgc'))
  }

  console.log(`Staged ${plugins.length} transform plugins for ${platform.id}`)
}
