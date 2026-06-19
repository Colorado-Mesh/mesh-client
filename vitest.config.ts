import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcAlias = { '@': resolve(__dirname, 'src') };

export default defineConfig({
  test: {
    // Test environment strategy:
    // - Renderer/UI tests run in the "renderer" project with jsdom.
    // - Main/shared logic tests run in the "main" project with node.
    // - Use file-level `// @vitest-environment ...` only as an explicit override
    //   when a specific test file must run in a non-default environment.
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
          setupFiles: [resolve(__dirname, 'src/renderer/vitest.setup.ts')],
          include: ['src/renderer/**/*.test.{ts,tsx}'],
        },
        resolve: {
          alias: srcAlias,
        },
      },
      {
        test: {
          name: 'main',
          globals: true,
          environment: 'node',
          include: [
            'src/main/**/*.test.ts',
            'src/shared/**/*.test.ts',
            'src/preload/**/*.test.ts',
            'scripts/**/*.test.mjs',
          ],
        },
        resolve: {
          alias: srcAlias,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'cobertura'],
      include: ['src/main/**', 'src/preload/**', 'src/shared/**', 'src/renderer/**'],
      exclude: [
        '**/*.test.{ts,tsx,mjs}',
        '**/*.d.ts',
        'src/renderer/locales/**',
        'src/renderer/index.html',
        'src/renderer/vitest.setup.ts',
      ],
      thresholds: {
        lines: 54,
        functions: 52,
        branches: 46,
        statements: 52,
      },
    },
  },
  resolve: {
    alias: srcAlias,
  },
});
