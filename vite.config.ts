import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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
      if (!existsSync(ORLP_WASM_SRC)) return;
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
      if (!existsSync(ORLP_WASM_SRC)) return;
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
  define: {
    // Polyfill bare `process` — browser contexts don't have this global.
    // @meshtastic/transport-web-serial's bundled core accesses process?.version and
    // process.cwd() without browser-guarding, causing ReferenceError in the renderer.
    // esbuild specificity: dotted-path defines (process.type below) take precedence
    // over the bare identifier for their specific access pattern.
    process: JSON.stringify({
      type: 'renderer',
      env: {},
      version: '',
      versions: {},
      platform: '',
      browser: true,
    }),
    // meshcore-decoder's Emscripten glue sets ENVIRONMENT_IS_NODE using (process.type != "renderer").
    // In Vite dev, process.type is often undefined, so undefined != "renderer" is true and the glue
    // wrongly takes the Node branch (require("fs")) — browser error: cannot resolve module "fs".
    // Electron's renderer already has process.type === "renderer"; this matches that.
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
      // All Node built-ins are redirected to browser-safe stubs via resolve.alias below.
      // Do NOT list them as externals — Rollup would emit bare `import "stream"` etc.
      // in the browser bundle which the renderer rejects at runtime.
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
      // Node built-ins imported by transitive deps (e.g. @meshtastic/core 2.6.7 via
      // @meshtastic/transport-web-serial). Listing them as rollup externals emits bare
      // `import "os"` etc. which the browser rejects. Redirect to renderer-safe stubs instead.
      fs: path.resolve(__dirname, 'src/renderer/shims/node-fs-stub.ts'),
      os: path.resolve(__dirname, 'src/renderer/shims/node-os-stub.ts'),
      path: path.resolve(__dirname, 'src/renderer/shims/node-path-stub.ts'),
      util: path.resolve(__dirname, 'src/renderer/shims/node-util-stub.ts'),
      stream: path.resolve(__dirname, 'src/renderer/shims/node-stream-stub.ts'),
      child_process: path.resolve(__dirname, 'src/renderer/shims/node-child-process-stub.ts'),
      net: path.resolve(__dirname, 'src/renderer/shims/node-net-stub.ts'),
      events: path.resolve(__dirname, 'src/renderer/shims/node-events-stub.ts'),
    },
  },
  css: {
    postcss: path.resolve(__dirname, 'postcss.config.cjs'),
  },
  server: {
    port: 5173,
  },
});
