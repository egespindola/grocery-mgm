import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'scripts/**/*.ts'],
      // Entry points only wire things together; their logic lives in tested modules.
      exclude: ['**/*.test.ts', 'src/index.ts', 'scripts/migrate.ts'],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
