/**
 * Vite config for the mobile app web bundle (Capacitor `webDir`: `dist-mobile/`).
 *
 * Builds `src/mobile/index.html` → `src/mobile/main.tsx`, which loads the unmodified preload and
 * renderer. Reuses the desktop renderer config (aliases, defines, chunk groups) and only:
 * - aliases `electron` to the mobile IPC bridge (the preload's only Electron import);
 * - writes to `dist-mobile/` (never touches `dist/renderer`);
 * - emits the MeshCore decoder WASM next to the mobile assets.
 * The host worker (`dist-mobile/host/`) is bundled separately by `scripts/build-mobile-host.mjs`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type UserConfig } from 'vite';

import { appChunkBudgetPlugin } from './scripts/app-chunk-budget.mjs';
import desktopConfig from './vite.config.mts';

const OUT_DIR = path.resolve(import.meta.dirname, 'dist-mobile');
const ORLP_WASM_NAME = 'orlp-ed25519.wasm';
const ORLP_WASM_SRC = path.resolve(
  import.meta.dirname,
  `node_modules/@michaelhart/meshcore-decoder/lib/${ORLP_WASM_NAME}`,
);

function mobileOrlpWasmPlugin(): Plugin {
  return {
    name: 'meshcore-orlp-wasm-mobile',
    writeBundle() {
      if (!existsSync(ORLP_WASM_SRC)) return;
      const buf = readFileSync(ORLP_WASM_SRC);
      writeFileSync(path.join(OUT_DIR, ORLP_WASM_NAME), buf);
      writeFileSync(path.join(OUT_DIR, 'assets', ORLP_WASM_NAME), buf);
    },
  };
}

const base = desktopConfig as UserConfig;
const baseOutput = (base.build?.rolldownOptions as { output?: unknown } | undefined)?.output;

export default defineConfig({
  ...base,
  plugins: [tailwindcss(), react(), mobileOrlpWasmPlugin(), appChunkBudgetPlugin()],
  root: path.resolve(import.meta.dirname, 'src/mobile'),
  base: './',
  publicDir: false,
  define: base.define,
  resolve: {
    ...base.resolve,
    alias: {
      ...(base.resolve?.alias as Record<string, string>),
      electron: path.resolve(import.meta.dirname, 'src/mobile/bridge/electronRenderer.ts'),
    },
  },
  build: {
    ...base.build,
    outDir: OUT_DIR,
    emptyOutDir: true,
    target: ['es2022', 'chrome111', 'safari16'],
    rolldownOptions: {
      input: { index: path.resolve(import.meta.dirname, 'src/mobile/index.html') },
      output: baseOutput as never,
    },
  },
  server: {
    port: 5174,
    host: '127.0.0.1',
    fs: { allow: [import.meta.dirname] },
  },
  worker: { format: 'es' },
});
