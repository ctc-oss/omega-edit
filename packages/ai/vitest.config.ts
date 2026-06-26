import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    globals: true,
    hookTimeout: 90000,
    include: ['tests/specs/*.spec.ts'],
    testTimeout: 90000,
  },
})
