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
];

/** CLI args: `--external:electron --external:...` */
export function mainEsbuildExternalArgs() {
  return MAIN_ESBUILD_EXTERNALS.flatMap((pkg) => [`--external:${pkg}`]);
}
