const cp = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { downloadAndUnzipVSCode } = require('@vscode/test-electron')

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '..')
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js')
  const version = process.env.VSCODE_VERSION || undefined
  const versionTag = sanitizeVersionTag(version ?? 'stable')
  const profileRoot = path.join(
    extensionDevelopmentPath,
    '.vscode-test',
    `profile-${versionTag}`
  )
  const extensionsDir = path.join(profileRoot, 'extensions')
  const userDataDir = path.join(profileRoot, 'user-data')

  try {
    const vscodeExecutablePath = await downloadAndUnzipVSCode(
      version ? { version } : undefined
    )
    fs.rmSync(profileRoot, { recursive: true, force: true })
    const args = [
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--disable-updates',
      '--disable-extensions',
      '--disable-workspace-trust',
      '--skip-release-notes',
      '--skip-welcome',
      `--extensionTestsPath=${extensionTestsPath}`,
      `--extensionDevelopmentPath=${extensionDevelopmentPath}`,
      `--extensions-dir=${extensionsDir}`,
      `--user-data-dir=${userDataDir}`,
    ]

    await runProcess(vscodeExecutablePath, args, extensionDevelopmentPath)
  } catch (error) {
    console.error('Failed to run VS Code integration tests')
    console.error(error)
    process.exit(1)
  }
}

function runProcess(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      ELECTRON_RUN_AS_NODE: undefined,
      VSCODE_DEV: undefined,
    }

    const child = cp.spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    })

    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(
        new Error(
          signal
            ? `VS Code test run terminated with signal ${signal}`
            : `VS Code test run failed with exit code ${code}`
        )
      )
    })
  })
}

function sanitizeVersionTag(rawVersion) {
  return rawVersion.replace(/[^a-zA-Z0-9._-]/g, '_')
}

void main()
