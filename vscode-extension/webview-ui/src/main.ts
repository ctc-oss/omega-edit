import App from './App.svelte'
import './styles.css'
import { mount } from 'svelte'
import { strings } from './i18n'
import { normalizeBytesPerRow } from './protocol'

const target = document.getElementById('app')

if (!target) {
  throw new Error(strings.app.missingMountPoint)
}

const initialBytesPerRow = normalizeBytesPerRow(
  Number.parseInt(target.dataset.bytesPerRow ?? '', 10)
)

try {
  target.replaceChildren()
  mount(App, {
    target,
    props: {
      initialBytesPerRow,
    },
  })
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  target.textContent = strings.app.failedToStart(message)
}
