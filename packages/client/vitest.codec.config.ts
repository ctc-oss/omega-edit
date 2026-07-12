import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    globals: true,
    include: ['tests/specs/changeLogCodec.spec.ts'],
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 100000,
  },
})
