/** Shared esbuild `--external` packages for the Electron main-process bundle. */
export const MAIN_ESBUILD_EXTERNALS = [
  'electron',
  'electron-updater',
  'systeminformation',
  'node-forge',
  'jszip',
  'mqtt',
  '@bufbuild/protobuf',
  '@meshtastic/protobufs',
  // Large Node HTTP/WebSocket stacks — keep out of the minified main outfile
  // (undici alone was ~1.3 MiB of metafile inputs and pushed the bundle to 1.0mb).
  'undici',
  'ws',
  // BlueZ D-Bus client (dynamic requires for usocket/path sockets; Linux pairing).
  'dbus-next',
];

/** CLI args: `--external:electron --external:...` */
export function mainEsbuildExternalArgs() {
  return MAIN_ESBUILD_EXTERNALS.flatMap((pkg) => [`--external:${pkg}`]);
}
