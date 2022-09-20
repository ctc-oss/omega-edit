const { execFileSync, spawn } = require('child_process')
const { exit } = require('process')
const glob = require('glob')
const fs = require('fs')
const os = require('os')
const unzip = require('unzip-stream')
const port = process.env.OMEGA_EDIT_SERVER_PORT || '9000'
const host = process.env.OMEGA_EDIT_SERVER_HOST || '127.0.0.1'

// Extract server
async function extractServer(filePath) {
  await new Promise((res, rej) => {
    let stream = fs
      .createReadStream(`${filePath}.zip`)
      .pipe(unzip.Extract({ path: '.' }))
    stream.on('close', () => {
      try {
        res(`${filePath}.zip`)
      } catch (err) {
        rej(err)
      }
    })
  })
}

// Run Scala gRPC server
async function startServer(filePath) {
  if (!os.platform().toLowerCase().startsWith('win')) {
    execFileSync('chmod', ['+x', `${filePath}/bin/omega-edit-grpc-server`])
  }

  let scriptName = os.platform().toLowerCase().startsWith('win')
    ? `./${filePath}/bin/omega-edit-grpc-server.bat`
    : `./${filePath}/bin/omega-edit-grpc-server`

  const server_process = spawn(scriptName, [`--interface=${host}`, `--port=${port}`], {
    stdio: 'ignore',
    detached: true,
  })

  fs.writeFileSync('.server_pid', server_process.pid.toString())
}

// Method to getFilePath based on the name of the server package
async function getFilePath() {
  var serverFilePaths = await glob.sync('omega-edit-grpc-server-*', {
    cwd: '.',
  })

  var serverFilePath = ''

  for (var i = 0; i < serverFilePaths.length; i++) {
    if (serverFilePaths[i].includes('.zip')) {
      serverFilePath = serverFilePaths[i].replace('.zip', '')
      break
    }
  }

  return serverFilePath
}

// Stop Scala gRPC server
async function stopServer() {
  var serverFilePath = await getFilePath()
  if (serverFilePath === '') exit(1)

  if (fs.existsSync('.server_pid')) {
    process.kill(fs.readFileSync('.server_pid').toString())
  }

  fs.rmdirSync(serverFilePath, { recursive: true })
  fs.rmSync('.server_pid')
}

// Run server by first extracting server then starting it
async function runScalaServer() {
  var serverFilePath = await getFilePath()
  if (serverFilePath === '') exit(1)

  await extractServer(serverFilePath)
  await startServer(serverFilePath)
  exit(0)
}

module.exports = {
  stopScalaServer: stopServer,
  runScalaServer: runScalaServer,
}

if (process.argv.includes('runScalaServer')) {
  runScalaServer()
} else if (process.argv.includes('stopScalaServer')) {
  stopServer()
}
