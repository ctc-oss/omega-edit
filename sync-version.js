#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

// Read version from VERSION file
const versionFilePath = path.join(__dirname, 'VERSION')
const version = fs.readFileSync(versionFilePath, 'utf8').trim()
const versionCore = version.split('+', 1)[0]
const isPrerelease = versionCore.includes('-')

// Update root package.json
const rootPackageJsonPath = path.join(__dirname, 'package.json')
const rootPackageJson = JSON.parse(fs.readFileSync(rootPackageJsonPath, 'utf8'))
rootPackageJson.version = version
fs.writeFileSync(
  rootPackageJsonPath,
  JSON.stringify(rootPackageJson, null, 2) + '\n'
)

// Update client package.json
const clientPackageJsonPath = path.join(
  __dirname,
  'packages',
  'client',
  'package.json'
)
const clientPackageJson = JSON.parse(
  fs.readFileSync(clientPackageJsonPath, 'utf8')
)
clientPackageJson.version = version
// Also update the server dependency version
if (
  clientPackageJson.dependencies &&
  clientPackageJson.dependencies['@omega-edit/server']
) {
  clientPackageJson.dependencies['@omega-edit/server'] = version
}
fs.writeFileSync(
  clientPackageJsonPath,
  JSON.stringify(clientPackageJson, null, 2) + '\n'
)

// Update server package.json
const serverPackageJsonPath = path.join(
  __dirname,
  'packages',
  'server',
  'package.json'
)
const serverPackageJson = JSON.parse(
  fs.readFileSync(serverPackageJsonPath, 'utf8')
)
serverPackageJson.version = version
fs.writeFileSync(
  serverPackageJsonPath,
  JSON.stringify(serverPackageJson, null, 2) + '\n'
)

// Update AI package.json
const aiPackageJsonPath = path.join(__dirname, 'packages', 'ai', 'package.json')
const aiPackageJson = JSON.parse(fs.readFileSync(aiPackageJsonPath, 'utf8'))
aiPackageJson.version = version
if (
  aiPackageJson.dependencies &&
  aiPackageJson.dependencies['@omega-edit/client']
) {
  aiPackageJson.dependencies['@omega-edit/client'] = version
}
fs.writeFileSync(
  aiPackageJsonPath,
  JSON.stringify(aiPackageJson, null, 2) + '\n'
)

// Update VS Code extension example package.json
const vscodeExtensionPackageJsonPath = path.join(
  __dirname,
  'examples',
  'vscode-extension',
  'package.json'
)
const vscodeExtensionPackageJson = JSON.parse(
  fs.readFileSync(vscodeExtensionPackageJsonPath, 'utf8')
)
vscodeExtensionPackageJson.version = version
if (
  vscodeExtensionPackageJson.dependencies &&
  vscodeExtensionPackageJson.dependencies['@omega-edit/client']
) {
  vscodeExtensionPackageJson.dependencies['@omega-edit/client'] =
    'file:../../packages/client'
}
fs.writeFileSync(
  vscodeExtensionPackageJsonPath,
  JSON.stringify(vscodeExtensionPackageJson, null, 2) + '\n'
)

// Update VS Code extension example package-lock.json metadata when present
const vscodeExtensionPackageLockPath = path.join(
  __dirname,
  'examples',
  'vscode-extension',
  'package-lock.json'
)
if (fs.existsSync(vscodeExtensionPackageLockPath)) {
  const vscodeExtensionPackageLock = JSON.parse(
    fs.readFileSync(vscodeExtensionPackageLockPath, 'utf8')
  )
  vscodeExtensionPackageLock.version = version
  if (vscodeExtensionPackageLock.packages?.['']) {
    vscodeExtensionPackageLock.packages[''].version = version
    if (
      vscodeExtensionPackageLock.packages[''].dependencies?.[
        '@omega-edit/client'
      ]
    ) {
      vscodeExtensionPackageLock.packages[''].dependencies[
        '@omega-edit/client'
      ] = 'file:../../packages/client'
    }
  }
  fs.writeFileSync(
    vscodeExtensionPackageLockPath,
    JSON.stringify(vscodeExtensionPackageLock, null, 2) + '\n'
  )
}

console.log(`Updated repo versioned packages to ${version}`)
console.log(
  'Set the VS Code example client dependency to the local workspace path.'
)
