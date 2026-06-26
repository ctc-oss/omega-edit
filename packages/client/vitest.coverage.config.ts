import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@omega-edit/client': path.resolve(__dirname, 'dist/esm/index.js'),
    },
  },
  test: {
    coverage: {
      all: true,
      excludeAfterRemap: true,
      exclude: [
        'dist/**/*.d.ts',
        'dist/**/client_version.js',
        'dist/**/protobuf_ts/generated/**',
        'dist/**/shims/**',
        'src/**/*.d.ts',
        'src/client_version.ts',
        'src/protobuf_ts/generated/**',
        'src/shims/**',
        'tests/**',
        'scripts/**',
      ],
      include: ['dist/**/*.js'],
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
