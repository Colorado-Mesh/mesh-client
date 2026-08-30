#!/usr/bin/env node
/**
 * Pre-commit / CI check: TS interface modes stay aligned with sidecar Rust.
 *
 * Per-type default modes are no longer duplicated — both sides read
 * src/shared/reticulumInterfaceCatalog.json — so this now checks:
 *   - INTERFACE_MODES (config.rs) === RETICULUM_INTERFACE_MODES (TS), same order
 *   - the ap/gw alias contract is documented in both files
 *   - every catalog `defaultMode` is one of those canonical modes
 *   - both the Rust and TS loaders still point at the shared catalog file
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const RUST_FILE = path.join(ROOT, 'reticulum-sidecar', 'src', 'stack', 'config.rs');
const TS_FILE = path.join(ROOT, 'src', 'renderer', 'lib', 'reticulum', 'reticulumInterfaceMode.ts');
const CATALOG_FILE = path.join(ROOT, 'src', 'shared', 'reticulumInterfaceCatalog.json');
const RUST_LOADER = path.join(ROOT, 'reticulum-sidecar', 'src', 'stack', 'interface_catalog.rs');
const TS_LOADER = path.join(
  ROOT,
  'src',
  'renderer',
  'lib',
  'reticulum',
  'reticulumInterfaceCatalog.ts',
);

function read(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`check-reticulum-interface-modes: missing ${filePath}`);
    process.exit(1);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function extractRustModes(src) {
  const block = src.match(/const INTERFACE_MODES:\s*&\[&str\]\s*=\s*&\[([\s\S]*?)\];/);
  if (!block) {
    throw new Error('INTERFACE_MODES array not found in config.rs');
  }
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function extractTsModes(src) {
  const block = src.match(/export const RETICULUM_INTERFACE_MODES\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!block) {
    throw new Error('RETICULUM_INTERFACE_MODES not found in reticulumInterfaceMode.ts');
  }
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const rustSrc = read(RUST_FILE);
const tsSrc = read(TS_FILE);
const catalogSrc = read(CATALOG_FILE);
const rustLoaderSrc = read(RUST_LOADER);
const tsLoaderSrc = read(TS_LOADER);

let failed = false;

try {
  const rustModes = extractRustModes(rustSrc);
  const tsModes = extractTsModes(tsSrc);
  if (JSON.stringify(rustModes) !== JSON.stringify(tsModes)) {
    console.error('check-reticulum-interface-modes: mode lists diverge');
    console.error('  rust:', rustModes.join(', '));
    console.error('  ts:  ', tsModes.join(', '));
    failed = true;
  }

  // Alias contract documented in both files
  if (!tsSrc.includes("'ap'") || !tsSrc.includes("'gw'")) {
    console.error('check-reticulum-interface-modes: TS missing ap/gw aliases');
    failed = true;
  }
  if (!rustSrc.includes('"ap"') || !rustSrc.includes('"gw"')) {
    console.error('check-reticulum-interface-modes: Rust missing ap/gw aliases');
    failed = true;
  }

  let catalog;
  try {
    catalog = JSON.parse(catalogSrc);
  } catch (e) {
    console.error(
      `check-reticulum-interface-modes: catalog is not valid JSON: ${
        e instanceof Error ? e.message : e
      }`,
    );
    process.exit(1);
  }

  const types = catalog.types ?? {};
  if (Object.keys(types).length === 0) {
    console.error('check-reticulum-interface-modes: catalog has no types');
    failed = true;
  }
  for (const [type, entry] of Object.entries(types)) {
    const mode = entry.defaultMode;
    if (mode != null && !rustModes.includes(mode)) {
      console.error(
        `check-reticulum-interface-modes: ${type} defaultMode "${mode}" is not a canonical mode`,
      );
      failed = true;
    }
    if (!entry.configType) {
      console.error(`check-reticulum-interface-modes: ${type} is missing configType`);
      failed = true;
    }
  }

  // Both sides must still read the shared catalog rather than re-hardcoding.
  if (!rustLoaderSrc.includes('src/shared/reticulumInterfaceCatalog.json')) {
    console.error(
      'check-reticulum-interface-modes: Rust loader no longer reads the shared catalog',
    );
    failed = true;
  }
  if (!tsLoaderSrc.includes('@/shared/reticulumInterfaceCatalog.json')) {
    console.error('check-reticulum-interface-modes: TS loader no longer reads the shared catalog');
    failed = true;
  }
  if (!rustSrc.includes('INTERFACE_CATALOG')) {
    console.error('check-reticulum-interface-modes: config.rs no longer consults the catalog');
    failed = true;
  }
  if (!tsSrc.includes('reticulumInterfaceCatalog')) {
    console.error(
      'check-reticulum-interface-modes: reticulumInterfaceMode.ts no longer consults the catalog',
    );
    failed = true;
  }
} catch (e) {
  console.error(`check-reticulum-interface-modes: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}

if (failed) {
  process.exit(1);
}

console.log('check-reticulum-interface-modes: ok');
