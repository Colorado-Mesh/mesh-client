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
    'process.env': {},
    'process.version': JSON.stringify(process.version),
    'process.platform': JSON.stringify(process.platform),
    'import_os.hostname': '(() => "mesh-client-user")',
  },
  build: {
    outDir: path.resolve(__dirname, '../../dist-electron/renderer'),
    emptyOutDir: true,
    commonjsOptions: {
      include: [/node_modules/],
      // Ensure the protobuf libraries can be transformed if they use CJS
      transformMixedEsModules: true,
    },
    rollupOptions: {
      // Node built-ins that appear in transitive deps (serialport, meshcore tcp_connection)
      // are already externalized by Vite; list them explicitly to suppress the auto-externalize warnings.
      external: ['net', 'stream', 'fs', 'path', 'os', 'util', 'child_process'],
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
    },
  },
  css: {
    postcss: path.resolve(__dirname, 'postcss.config.cjs'),
  },
  server: {
    port: 5173,
  },
});
