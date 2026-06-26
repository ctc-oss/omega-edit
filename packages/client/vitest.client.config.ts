import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['tests/specs/server.spec.ts'],
    fileParallelism: false,
    globalSetup: ['./tests/vitest-global-setup.ts'],
    globals: true,
    hookTimeout: 100000,
    include: ['tests/specs/*.spec.ts'],
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 100000,
  },
})
