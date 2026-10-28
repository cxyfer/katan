import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Browser client build + test configuration.
 *
 * `@catan/rules` and `@catan/protocol` are workspace packages whose `exports`
 * point straight at TypeScript sources, so no alias mapping is required.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    globals: false,
    restoreMocks: true,
    // Bound jsdom concurrency so full-suite contention does not starve timers.
    maxWorkers: 4,
  },
});
