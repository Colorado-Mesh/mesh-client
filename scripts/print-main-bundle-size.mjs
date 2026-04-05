#!/usr/bin/env node
/**
 * Prints byte size of dist-electron/main/index.js after a build.
 * Usage: pnpm run build:main --silent && node scripts/print-main-bundle-size.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(__dirname, '..', 'dist-electron', 'main', 'index.js');

try {
  const st = fs.statSync(outfile);
   
  console.log(`dist-electron/main/index.js: ${st.size} bytes (${(st.size / 1024).toFixed(1)} KiB)`);
} catch {
  console.error('Run build:main or build:main:prod first; missing', outfile);
  process.exit(1);
}
