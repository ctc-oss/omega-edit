const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')
const Mocha = require('mocha')

const { resetClient: resetCjsClient } = require(
  path.join(__dirname, '..', 'dist', 'cjs', 'index.js')
)

function parseArgs(argv) {
  let transport

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--transport') {
      transport = argv[index + 1]
      if (!transport || !['tcp', 'uds'].includes(transport)) {
        console.error(
          `Unknown transport "${transport}". Expected one of: tcp, uds`
        )
        process.exit(1)
      }
      index += 1
      continue
    }

    console.error(`Unknown argument "${arg}"`)
    process.exit(1)
  }

  return { transport }
}

async function runSuite(files, options = {}) {
  const mocha = new Mocha(options)
  for (const file of files) {
    mocha.addFile(file)
  }
  await mocha.loadFilesAsync()
  return new Promise((resolve) => {
    mocha.run((failures) => resolve(failures))
  })
}

function getClientSpecFiles() {
  const specsDir = path.join(__dirname, '..', 'tests', 'specs')
  return fs
    .readdirSync(specsDir)
    .filter((file) => file.endsWith('.spec.ts') && file !== 'server.spec.ts')
    .map((file) => path.join(specsDir, file))
}

async function main() {
  const { transport } = parseArgs(process.argv.slice(2))
  if (transport) {
    process.env.OMEGA_EDIT_TEST_TRANSPORT = transport
  }

  const { resetClient: resetEsmClient } = await import(
    pathToFileURL(path.join(__dirname, '..', 'dist', 'esm', 'index.js')).href
  )
  const lifecycleSpec = path.join(
    __dirname,
    '..',
    'tests',
    'specs',
    'server.spec.ts'
  )
  const lifecycleFailures = await runSuite([lifecycleSpec], {
    timeout: 50000,
    slow: 35000,
  })

  if (lifecycleFailures !== 0) {
    process.exit(lifecycleFailures)
  }

  resetCjsClient()
  resetEsmClient()

  const fixtures = await import(
    pathToFileURL(path.join(__dirname, '..', 'tests', 'fixtures.ts')).href
  )
  await fixtures.mochaGlobalSetup()

  let clientFailures = 1
  try {
    clientFailures = await runSuite(getClientSpecFiles(), {
      timeout: 100000,
      slow: 50000,
    })
  } finally {
    await fixtures.mochaGlobalTeardown()
  }

  process.exit(clientFailures)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
