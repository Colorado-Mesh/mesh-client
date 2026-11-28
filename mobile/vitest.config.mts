/**
 * Vitest for the mobile package (`pnpm -C mobile test`). Root `pnpm test:run` does not run these;
 * the mobile CI workflow does.
 *
 * - mobile-host: host worker shims, overrides and build scripts in node (no DOM).
 * - mobile-ui: bridge, viewport and renderer overrides in jsdom with the desktop renderer setup.
 *   The desktop-override plugin is active, so `@/renderer/...` imports resolve exactly as in the
 *   mobile bundle (wrappers in place of the pinned desktop modules).
 */
import path from 'node:path';

import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

import { VITEST_CORE_DEPS, VITEST_SERVER_INLINE_DEPS } from '../vitest.harness.mts';
import { desktopOverridesPlugin } from './scripts/desktop-overrides.mjs';

const REPO = path.resolve(import.meta.dirname, '..');
const alias = { '@': path.join(REPO, 'src') };

export default defineConfig({
  resolve: { alias },
  server: { deps: { inline: [...VITEST_SERVER_INLINE_DEPS] } },
  ssr: { optimizeDeps: { include: [...VITEST_CORE_DEPS] } },
  test: {
    globals: true,
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'mobile-host',
          globals: true,
          environment: 'node',
          include: ['src/host/**/*.test.ts', 'scripts/**/*.test.mjs'],
          pool: 'forks',
        },
      },
      {
        plugins: [desktopOverridesPlugin() as Plugin, react()],
        resolve: { alias },
        test: {
          name: 'mobile-ui',
          globals: true,
          environment: 'jsdom',
          setupFiles: [path.join(REPO, 'src/renderer/vitest.setup.ts')],
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['src/host/**'],
          pool: 'forks',
        },
      },
    ],
  },
});
