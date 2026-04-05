import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  optimizeDeps: {
    // Add the transport libraries to the include list
    include: [
      '@meshtastic/protobufs',
      '@bufbuild/protobuf',
      '@meshtastic/transport-http',
      '@meshtastic/transport-web-serial',
    ],
  },
  define: {
    // Dynamically shim process based on the current OS building the app
    'process.env': '{}',
    'process.version': JSON.stringify(process.version),
    'process.platform': JSON.stringify(process.platform),
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    commonjsOptions: {
      include: [/node_modules/],
      // Ensure the protobuf libraries can be transformed if they use CJS
      transformMixedEsModules: true,
    },
    rollupOptions: {
      // All Node built-ins are redirected to browser-safe stubs via resolve.alias below.
      // Do NOT list them as externals — Rollup would emit bare `import "os"` etc.
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
