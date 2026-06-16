import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [svelte({ preprocess: vitePreprocess() })],
  build: {
    emptyOutDir: true,
    outDir: 'out/svelte-webview',
    cssCodeSplit: false,
    sourcemap: false,
    target: 'es2020',
    rollupOptions: {
      input: 'webview-ui/src/main.ts',
      output: {
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith('.css') ? 'webview.css' : '[name][extname]',
        chunkFileNames: 'webview-[hash].js',
        entryFileNames: 'webview.js',
      },
    },
  },
})
