import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 30000,
    maxWorkers: 2,
    fileParallelism: false,
    restoreMocks: true,
  },
});
