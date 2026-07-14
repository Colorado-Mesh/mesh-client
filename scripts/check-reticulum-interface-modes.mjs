#!/usr/bin/env node
/**
 * Pre-commit / CI check: TS interface modes stay aligned with sidecar Rust.
 *
 * Extracts:
 *   - INTERFACE_MODES + default_mode_for_iface_type from reticulum-sidecar/src/stack/config.rs
 *   - RETICULUM_INTERFACE_MODES + defaultModeForIfaceType from reticulumInterfaceMode.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const RUST_FILE = path.join(ROOT, 'reticulum-sidecar', 'src', 'stack', 'config.rs');
const TS_FILE = path.join(ROOT, 'src', 'renderer', 'lib', 'reticulum', 'reticulumInterfaceMode.ts');

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

/** Map iface_type → default mode from default_mode_for_iface_type match arms. */
function extractRustDefaults(src) {
  const start = src.indexOf('pub fn default_mode_for_iface_type');
  if (start < 0) {
    throw new Error('default_mode_for_iface_type not found in config.rs');
  }
  const brace = src.indexOf('{', start);
  const end = src.indexOf('\n}', brace);
  if (brace < 0 || end < 0) {
    throw new Error('default_mode_for_iface_type body not found in config.rs');
  }
  const body = src.slice(brace, end);
  const defaults = {};
  for (const line of body.split('\n')) {
    if (!line.includes('=> Some(')) continue;
    const modeMatch = line.match(/Some\("([^"]+)"\)/);
    if (!modeMatch) continue;
    const types = [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    // Last quoted string is the mode in Some("…"); earlier ones are iface types.
    types.pop();
    for (const t of types) {
      defaults[t] = modeMatch[1];
    }
  }
  return defaults;
}

function extractTsDefaults(src) {
  const start = src.indexOf('export function defaultModeForIfaceType');
  if (start < 0) {
    throw new Error('defaultModeForIfaceType not found in reticulumInterfaceMode.ts');
  }
  const brace = src.indexOf('{', start);
  const end = src.indexOf('\n}', brace);
  if (brace < 0 || end < 0) {
    throw new Error('defaultModeForIfaceType body not found in reticulumInterfaceMode.ts');
  }
  const body = src.slice(brace, end);
  const defaults = {};
  let pending = [];
  for (const line of body.split('\n')) {
    const caseMatch = line.match(/case\s+'([^']+)':/);
    if (caseMatch) {
      pending.push(caseMatch[1]);
      continue;
    }
    const ret = line.match(/return\s+'([^']+)'/);
    if (ret && pending.length) {
      for (const t of pending) {
        defaults[t] = ret[1];
      }
      pending = [];
    }
    if (line.includes('return null')) {
      pending = [];
    }
  }
  return defaults;
}

function sameMap(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

const rustSrc = read(RUST_FILE);
const tsSrc = read(TS_FILE);

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

  const rustDefaults = extractRustDefaults(rustSrc);
  const tsDefaults = extractTsDefaults(tsSrc);
  if (!sameMap(rustDefaults, tsDefaults)) {
    console.error('check-reticulum-interface-modes: per-type defaults diverge');
    console.error('  rust:', JSON.stringify(rustDefaults));
    console.error('  ts:  ', JSON.stringify(tsDefaults));
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
} catch (e) {
  console.error(`check-reticulum-interface-modes: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}

if (failed) {
  process.exit(1);
}

console.log('check-reticulum-interface-modes: ok');
