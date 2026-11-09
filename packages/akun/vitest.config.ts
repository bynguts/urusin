import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // argon2id dengan parameter OWASP butuh ~50 ms per hash; beri ruang di mesin CI yang lambat.
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/kek-rotate-cli.ts'],
      reporter: ['text-summary', 'json-summary', 'lcov', 'html'],
      thresholds: { lines: 90, branches: 85 },
    },
  },
});
