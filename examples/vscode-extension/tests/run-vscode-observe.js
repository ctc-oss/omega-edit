const cp = require('node:child_process')
const path = require('node:path')

const env = {
  ...process.env,
  OMEGA_EDIT_OBSERVE: process.env.OMEGA_EDIT_OBSERVE ?? '1',
  OMEGA_EDIT_OBSERVE_DELAY_MS:
    process.env.OMEGA_EDIT_OBSERVE_DELAY_MS ?? '2000',
  OMEGA_EDIT_OBSERVE_FINAL_DELAY_MS:
    process.env.OMEGA_EDIT_OBSERVE_FINAL_DELAY_MS ?? '10000',
}

const child = cp.spawn(
  process.execPath,
  [path.resolve(__dirname, 'run-vscode-tests.js')],
  {
    env,
    shell: false,
    stdio: 'inherit',
    windowsHide: false,
  }
)

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 1)
})
