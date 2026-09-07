import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Runs before each test file is imported, which matters: the transmitter
    // config reads `process.env` at module load, and the transmit path now
    // refuses a filer identity TRA would reject.
    setupFiles: ['./tests/setup-env.ts'],
  },
  resolve: {
    alias: {
      '#config': resolve(__dirname, './src/config'),
      '#shared': resolve(__dirname, './src/shared'),
      '#resources': resolve(__dirname, './src/resources'),
      '#plugins': resolve(__dirname, './src/plugins'),
    },
  },
});
