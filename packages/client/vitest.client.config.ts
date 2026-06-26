import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      all: true,
      exclude: [
        'src/**/*.d.ts',
        'src/client_version.ts',
        'src/protobuf_ts/generated/**',
        'dist/**',
        'tests/**',
        'scripts/**',
      ],
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['lcov', 'text'],
      reportsDirectory: 'coverage',
      thresholds: {
        branches: 75,
        functions: 75,
        lines: 75,
        statements: 75,
      },
    },
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
