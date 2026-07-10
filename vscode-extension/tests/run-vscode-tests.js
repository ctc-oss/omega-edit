const cp = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { downloadAndUnzipVSCode } = require('@vscode/test-electron')

const DEFAULT_VSCODE_DOWNLOAD_ATTEMPTS = 3
const DEFAULT_VSCODE_DOWNLOAD_IDLE_TIMEOUT_MS = 60_000
const TRANSIENT_DOWNLOAD_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ERR_STREAM_PREMATURE_CLOSE',
])

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '..')
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js')
  const version = process.env.VSCODE_VERSION || undefined
  const versionTag = sanitizeVersionTag(version ?? 'stable')
  const vscodeTestRoot = path.join(extensionDevelopmentPath, '.vscode-test')
  fs.mkdirSync(vscodeTestRoot, { recursive: true })
  const profileBase = process.env.RUNNER_TEMP || os.tmpdir()
  const profileRoot = fs.mkdtempSync(
    path.join(profileBase, `oe-vscode-${versionTag}-`)
  )
  const extensionsDir = path.join(profileRoot, 'extensions')
  const userDataDir = path.join(profileRoot, 'user-data')

  try {
    const vscodeExecutablePath = await downloadVSCodeWithRetry({
      version,
      cachePath: vscodeTestRoot,
    })
    const serverPort = await reserveServerPort()
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

    console.log(`Using OmegaEdit test server port ${serverPort}`)
    await runProcess(vscodeExecutablePath, args, extensionDevelopmentPath, {
      OMEGA_EDIT_SERVER_PORT: String(serverPort),
    })
  } catch (error) {
    console.error('Failed to run VS Code integration tests')
    console.error(error)
    process.exit(1)
  } finally {
    try {
      fs.rmSync(profileRoot, { recursive: true, force: true })
    } catch {
      // Ignore local cleanup failures; each run uses a fresh temp profile.
    }
  }
}

async function downloadVSCodeWithRetry({ version, cachePath }) {
  const attempts = parsePositiveInteger(
    process.env.VSCODE_DOWNLOAD_ATTEMPTS,
    DEFAULT_VSCODE_DOWNLOAD_ATTEMPTS
  )
  const timeout = parsePositiveInteger(
    process.env.VSCODE_DOWNLOAD_IDLE_TIMEOUT_MS,
    DEFAULT_VSCODE_DOWNLOAD_IDLE_TIMEOUT_MS
  )
  const options = { cachePath, timeout }

  if (version) {
    options.version = version
  }

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const unhandledRejections = []
    const onUnhandledRejection = (reason) => {
      unhandledRejections.push(reason)

      if (isTransientDownloadError(reason)) {
        console.warn(
          `Ignoring transient VS Code download rejection while retrying: ${formatError(
            reason
          )}`
        )
      }
    }

    // @vscode/test-electron can leave checksum/stream promises unhandled after
    // transient archive failures; keep Node 24 alive long enough to retry.
    process.on('unhandledRejection', onUnhandledRejection)

    try {
      const executablePath = await downloadAndUnzipVSCode(options)
      await waitForUnhandledRejections()

      const fatalUnhandled = findFatalUnhandledRejection(unhandledRejections)

      if (fatalUnhandled) {
        throw fatalUnhandled
      }

      return executablePath
    } catch (error) {
      const fatalUnhandled = findFatalUnhandledRejection(unhandledRejections)

      if (fatalUnhandled) {
        throw fatalUnhandled
      }

      if (
        !shouldRetryDownload(error, unhandledRejections) ||
        attempt === attempts
      ) {
        throw error
      }

      await cleanupIncompleteVSCodeDownloads(cachePath)
      console.warn(
        `VS Code download failed (${formatError(error)}); retrying attempt ${
          attempt + 1
        } of ${attempts}`
      )
      await sleep(attempt * 1000)
    } finally {
      process.removeListener('unhandledRejection', onUnhandledRejection)
    }
  }

  throw new Error('VS Code download retry loop exited unexpectedly')
}

function runProcess(command, args, cwd, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      ...extraEnv,
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

function reserveServerPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => {
          reject(new Error('Failed to reserve a TCP port for VS Code tests'))
        })
        return
      }

      server.close((err) => {
        if (err) {
          reject(err)
          return
        }

        resolve(address.port)
      })
    })
  })
}

function sanitizeVersionTag(rawVersion) {
  return rawVersion.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function parsePositiveInteger(rawValue, fallback) {
  const parsed = Number.parseInt(rawValue ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function shouldRetryDownload(error, unhandledRejections) {
  return (
    isTransientDownloadError(error) ||
    unhandledRejections.some(isTransientDownloadError) ||
    /Failed to download and unzip VS Code/i.test(formatError(error))
  )
}

function findFatalUnhandledRejection(unhandledRejections) {
  return unhandledRejections.find((reason) => !isTransientDownloadError(reason))
}

function isTransientDownloadError(error) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : undefined

  if (code && TRANSIENT_DOWNLOAD_CODES.has(code)) {
    return true
  }

  return /aborted|socket hang up|premature close|ECONNRESET|ETIMEDOUT|EAI_AGAIN|timeout/i.test(
    formatError(error)
  )
}

function formatError(error) {
  if (error instanceof Error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? ` (${error.code})`
        : ''

    return `${error.message}${code}`
  }

  return String(error)
}

async function cleanupIncompleteVSCodeDownloads(cachePath) {
  let entries

  try {
    entries = await fs.promises.readdir(cachePath, { withFileTypes: true })
  } catch {
    return
  }

  await Promise.all(
    entries
      .filter(
        (entry) => entry.isDirectory() && entry.name.startsWith('vscode-')
      )
      .map(async (entry) => {
        const downloadPath = path.join(cachePath, entry.name)
        const completeFile = path.join(downloadPath, 'is-complete')

        if (!fs.existsSync(completeFile)) {
          await fs.promises.rm(downloadPath, { recursive: true, force: true })
        }
      })
  )
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function waitForUnhandledRejections() {
  return new Promise((resolve) => setImmediate(resolve))
}

void main()
