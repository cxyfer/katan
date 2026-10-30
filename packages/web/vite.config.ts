import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const backendHost = process.env.HOST ?? '127.0.0.1';
const connectHost = ['0.0.0.0', '::'].includes(backendHost) ? '127.0.0.1' : backendHost;
const backend = `http://${connectHost.includes(':') ? `[${connectHost}]` : connectHost}:${process.env.PORT ?? 3000}`;

/**
 * Browser client build + test configuration.
 *
 * `@catan/rules` and `@catan/protocol` are workspace packages whose `exports`
 * point straight at TypeScript sources, so no alias mapping is required.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.VITE_HOST ?? '127.0.0.1',
    port: Number(process.env.VITE_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/api': { target: backend },
      '/ws': { target: backend, ws: true },
      '/healthz': { target: backend },
      '/readyz': { target: backend },
    },
  },
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
