import { readFileSync, writeFileSync } from 'node:fs';
import path from 'path';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Emscripten glue fetches `orlp-ed25519.wasm` relative to the page; it is not inlined by Vite. */
const ORLP_WASM_NAME = 'orlp-ed25519.wasm';
const ORLP_WASM_SRC = path.resolve(
  __dirname,
  `node_modules/@michaelhart/meshcore-decoder/lib/${ORLP_WASM_NAME}`,
);

function meshcoreOrlpWasmPlugin(): import('vite').Plugin {
  return {
    name: 'meshcore-orlp-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (url === `/${ORLP_WASM_NAME}` || url.endsWith(`/${ORLP_WASM_NAME}`)) {
          try {
            const buf = readFileSync(ORLP_WASM_SRC);
            res.setHeader('Content-Type', 'application/wasm');
            res.setHeader('Cache-Control', 'public, max-age=31536000');
            res.end(buf);
          } catch {
            res.statusCode = 404;
            res.end();
          }
          return;
        }
        next();
      });
    },
    writeBundle() {
      const buf = readFileSync(ORLP_WASM_SRC);
      // Next to index.html (relative URL "orlp-ed25519.wasm" from document)
      writeFileSync(path.resolve(__dirname, 'dist/renderer', ORLP_WASM_NAME), buf);
      // Some Emscripten builds resolve WASM relative to the JS chunk in assets/
      writeFileSync(path.resolve(__dirname, 'dist/renderer/assets', ORLP_WASM_NAME), buf);
    },
  };
}

export default defineConfig({
  plugins: [react(), meshcoreOrlpWasmPlugin()],
  worker: {
    format: 'es',
  },
  // meshcore-decoder's Emscripten glue sets ENVIRONMENT_IS_NODE using (process.type != "renderer").
  // In Vite dev, process.type is often undefined, so undefined != "renderer" is true and the glue
  // wrongly takes the Node branch (require("fs")) — browser error: cannot resolve module "fs".
  // Electron's renderer already has process.type === "renderer"; this matches that.
  define: {
    'process.type': JSON.stringify('renderer'),
  },
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      // Node built-ins for transitive deps. Do NOT list `fs` here — Rollup would emit bare
      // `import "fs"` in the browser bundle and LetsMesh auth (meshcore-decoder WASM) fails at runtime.
      // Use resolve.alias.fs → shims/node-fs-stub.ts instead.
      external: ['net', 'stream', 'path', 'os', 'util', 'child_process'],
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/'))
            return 'react';
          if (
            id.includes('node_modules/recharts') ||
            id.includes('node_modules/d3-') ||
            id.includes('node_modules/victory-')
          )
            return 'recharts';
          if (
            id.includes('node_modules/leaflet') ||
            id.includes('node_modules/react-leaflet') ||
            id.includes('node_modules/@react-leaflet')
          )
            return 'leaflet';
          if (id.includes('node_modules/@meshtastic') || id.includes('node_modules/protobufjs'))
            return 'meshtastic';
          if (id.includes('node_modules/@liamcottle/meshcore')) return 'meshcore';
          if (id.includes('node_modules/@michaelhart/meshcore-decoder')) return 'meshcore-decoder';
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      fs: path.resolve(__dirname, 'src/renderer/shims/node-fs-stub.ts'),
    },
  },
  css: {
    postcss: path.resolve(__dirname, 'postcss.config.cjs'),
  },
  server: {
    port: 5173,
  },
});
