import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'scripts/**/*.ts'],
      // Entry points only wire things together and spikes only run against live Azion services.
      exclude: [
        '**/*.test.ts',
        '**/testing/**',
        'src/index.ts',
        'scripts/migrate.ts',
        'scripts/spikes/**',
      ],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
