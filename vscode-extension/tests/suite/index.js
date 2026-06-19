const path = require('node:path')
const Mocha = require('mocha')

async function run() {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 120000,
  })

  mocha.addFile(path.resolve(__dirname, 'extension.integration.test.js'))

  await new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} integration test(s) failed.`))
        return
      }
      resolve()
    })
  })
}

module.exports = { run }
