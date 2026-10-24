<!--
  Copyright (c) 2026 Concurrent Technologies Corporation.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
-->

<script lang="ts">
  import { onMount } from 'svelte'
  import { strings } from '../i18n'

  let { onClose }: { onClose: () => void } = $props()
  let panel: HTMLElement | undefined
  let closeButton: HTMLButtonElement | undefined

  const groups = [
    {
      title: strings.shortcutHelp.navigation,
      shortcuts: [
        ['← / → / ↑ / ↓', strings.shortcutHelp.move],
        ['Shift + ← / → / ↑ / ↓', strings.shortcutHelp.extend],
        ['PageUp / PageDown', strings.shortcutHelp.page],
        ['Shift + PageUp / PageDown', strings.shortcutHelp.extendPage],
        ['Home / End', strings.shortcutHelp.boundary],
        ['Ctrl / Cmd + G / L', strings.shortcutHelp.offset],
      ],
    },
    {
      title: strings.shortcutHelp.editing,
      shortcuts: [
        ['Tab / Shift + Tab', strings.shortcutHelp.pane],
        ['Insert', strings.shortcutHelp.editMode],
        ['Backspace', strings.shortcutHelp.backspace],
        ['Delete', strings.shortcutHelp.delete],
      ],
    },
    {
      title: strings.shortcutHelp.clipboard,
      shortcuts: [
        ['Ctrl / Cmd + C', strings.shortcutHelp.copy],
        ['Ctrl / Cmd + X', strings.shortcutHelp.cut],
        ['Ctrl / Cmd + V', strings.shortcutHelp.paste],
      ],
    },
    {
      title: strings.shortcutHelp.search,
      shortcuts: [
        ['Ctrl / Cmd + F', strings.shortcutHelp.find],
        ['Ctrl / Cmd + H', strings.shortcutHelp.replace],
        ['F3 / Shift + F3', strings.shortcutHelp.nextPrevious],
        ['Enter / Shift + Enter', strings.shortcutHelp.searchInput],
        ['Enter', strings.shortcutHelp.replaceInput],
        ['Escape', strings.shortcutHelp.closeSearch],
      ],
    },
  ]

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && panel?.contains(event.target as Node)) {
      event.preventDefault()
      onClose()
    }
  }

  onMount(() => closeButton?.focus())
</script>

<svelte:window onkeydown={handleKeydown} />

<section
  bind:this={panel}
  id="shortcutHelpPanel"
  class="shortcut-help"
  aria-labelledby="shortcutHelpTitle"
>
  <div class="shortcut-help-header">
    <h2 id="shortcutHelpTitle">{strings.shortcutHelp.title}</h2>
    <button
      bind:this={closeButton}
      type="button"
      class="panel-close"
      aria-label={strings.shortcutHelp.close}
      title={strings.shortcutHelp.close}
      onclick={onClose}
    >
      &times;
    </button>
  </div>
  <p>{strings.shortcutHelp.focusNote}</p>
  <div class="shortcut-help-groups">
    {#each groups as group}
      <div>
        <h3>{group.title}</h3>
        <dl>
          {#each group.shortcuts as [keys, description]}
            <div class="shortcut-help-entry">
              <dt><kbd>{keys}</kbd></dt>
              <dd>{description}</dd>
            </div>
          {/each}
        </dl>
      </div>
    {/each}
  </div>
  <p>{strings.shortcutHelp.nativeNote}</p>
</section>

<style>
  .shortcut-help {
    max-height: 40vh;
    overflow: auto;
    padding: 8px 12px;
    border-bottom: 1px solid var(--vscode-editorGroup-border);
    background: var(--vscode-editorWidget-background);
  }

  .shortcut-help-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  h2,
  h3,
  p,
  dl,
  dd {
    margin: 0;
  }

  h2 {
    font-size: 13px;
  }

  h3 {
    margin-bottom: 6px;
    font-size: 12px;
  }

  p {
    margin-top: 8px;
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
  }

  .shortcut-help-groups {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
    gap: 16px;
    margin-top: 12px;
  }

  .shortcut-help-entry {
    margin-top: 8px;
    font-size: 11px;
  }

  kbd {
    font-family: var(--vscode-editor-font-family, monospace);
    overflow-wrap: anywhere;
  }

  dd {
    margin-top: 2px;
    color: var(--vscode-descriptionForeground);
  }
</style>
