import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: {
      junit: 'test-results/junit.xml',
    },
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'renderer',
          globals: true,
          environment: 'jsdom',
          setupFiles: ['./src/renderer/vitest.setup.ts'],
          include: ['src/renderer/**/*.test.{ts,tsx}'],
        },
        resolve: {
          alias: { '@': resolve(__dirname, 'src') },
        },
      },
      {
        test: {
          name: 'main',
          globals: true,
          environment: 'node',
          include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts'],
        },
        resolve: {
          alias: { '@': resolve(__dirname, 'src') },
        },
      },
    ],
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
});
