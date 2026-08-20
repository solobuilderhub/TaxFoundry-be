import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
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
