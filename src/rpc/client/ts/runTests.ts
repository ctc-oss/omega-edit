const { execSync, spawn } = require('child_process')
const { exit } = require('process')
const glob = require('glob')
const fs = require('fs')
const os = require('os')
const unzip = require('unzip-stream')

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
    execSync(`chmod +x ${filePath}/bin/omega-edit-grpc-server`)
  }

  let scriptName = os.platform().toLowerCase().startsWith('win')
    ? `./${filePath}/bin/omega-edit-grpc-server.bat`
    : `./${filePath}/bin/omega-edit-grpc-server`

  const server_process = spawn(scriptName, [], {
    stdio: 'ignore',
    detached: true,
  })

  fs.writeFileSync('server_pid', server_process.pid.toString())
}

// Stop Scala gRPC server
async function stopServer() {
  if (fs.existsSync('server_pid')) {
    process.kill(fs.readFileSync('server_pid').toString())
  }

  fs.rmdirSync('omega-edit-grpc-server-0.9.20', { recursive: true })
  fs.rmSync('server_pid')
}

// Run server by first extracting server then starting it
async function runScalaServer() {
  var serverFilePath = await glob
    .sync('omega-edit-grpc-server-*', { cwd: '.' })
    .toString()
    .replace('.zip', '')

  if (serverFilePath === '') exit(1)

  await extractServer(serverFilePath)
  await startServer(serverFilePath)
  exit(0)
}

module.exports = {
  stopScalaServer: stopServer,
  runScalaServer: runScalaServer,
}
