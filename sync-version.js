#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Read version from VERSION file
const versionFilePath = path.join(__dirname, 'VERSION');
const version = fs.readFileSync(versionFilePath, 'utf8').trim();

// Update root package.json
const rootPackageJsonPath = path.join(__dirname, 'package.json');
const rootPackageJson = JSON.parse(fs.readFileSync(rootPackageJsonPath, 'utf8'));
rootPackageJson.version = version;
fs.writeFileSync(rootPackageJsonPath, JSON.stringify(rootPackageJson, null, 2) + '\n');

// Update client package.json
const clientPackageJsonPath = path.join(__dirname, 'packages', 'client', 'package.json');
const clientPackageJson = JSON.parse(fs.readFileSync(clientPackageJsonPath, 'utf8'));
clientPackageJson.version = version;
// Also update the server dependency version
if (clientPackageJson.dependencies && clientPackageJson.dependencies['@omega-edit/server']) {
  clientPackageJson.dependencies['@omega-edit/server'] = version;
}
fs.writeFileSync(clientPackageJsonPath, JSON.stringify(clientPackageJson, null, 2) + '\n');

// Update server package.json
const serverPackageJsonPath = path.join(__dirname, 'packages', 'server', 'package.json');
const serverPackageJson = JSON.parse(fs.readFileSync(serverPackageJsonPath, 'utf8'));
serverPackageJson.version = version;
fs.writeFileSync(serverPackageJsonPath, JSON.stringify(serverPackageJson, null, 2) + '\n');

console.log(`Updated all package.json files to version ${version}`);