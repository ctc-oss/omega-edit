import App from './App.svelte'
import './styles.css'
import { mount } from 'svelte'
import { setLanguage, strings, textDirectionForLanguage } from './i18n'
import { normalizeBytesPerRow, normalizeBytesPerRowMode } from './protocol'

const initialLanguage = document.documentElement.lang || navigator.language
setLanguage(initialLanguage)

const target = document.getElementById('app')

if (!target) {
  throw new Error(strings.app.missingMountPoint)
}

const activeLanguage = setLanguage(target.dataset.locale || initialLanguage)
document.documentElement.lang = activeLanguage
document.documentElement.dir = textDirectionForLanguage(activeLanguage)

const initialBytesPerRow = normalizeBytesPerRow(
  Number.parseInt(target.dataset.bytesPerRow ?? '', 10)
)
const initialBytesPerRowMode = normalizeBytesPerRowMode(
  target.dataset.bytesPerRowMode
)

try {
  target.replaceChildren()
  mount(App, {
    target,
    props: {
      initialBytesPerRow,
      initialBytesPerRowMode,
    },
  })
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  target.textContent = strings.app.failedToStart(message)
}
