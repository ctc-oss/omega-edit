import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    globals: true,
    hookTimeout: 50000,
    include: ['tests/specs/server.spec.ts'],
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 50000,
  },
})
