import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

// Shared Svelte configuration consumed by both the Vite build and svelte-check.
// vitePreprocess lets `<script lang="ts">` blocks be type-checked.
export default {
  preprocess: vitePreprocess(),
}
