#!/usr/bin/env node
/**
 * Pre-commit / CI check: TS decommissioned hub catalog stays aligned with sidecar Rust.
 *
 * Extracts:
 *   - DECOMMISSIONED_TCP_HUBS from reticulum-sidecar/src/stack/config.rs
 *   - RETICULUM_DECOMMISSIONED_HUB_ENDPOINTS from src/shared/reticulumDecommissionedHubs.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const RUST_FILE = path.join(ROOT, 'reticulum-sidecar', 'src', 'stack', 'config.rs');
const TS_FILE = path.join(ROOT, 'src', 'shared', 'reticulumDecommissionedHubs.ts');

function read(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`check-reticulum-decommissioned-hubs: missing ${filePath}`);
    process.exit(1);
  }
  return fs.readFileSync(filePath, 'utf8');
}

/** @returns {{ hosts: string[], port: number }[]} */
function extractRustHubs(src) {
  const block = src.match(
    /const DECOMMISSIONED_TCP_HUBS:\s*&\[\(&\[&str\],\s*u16\)\]\s*=\s*&\[([\s\S]*?)\];/,
  );
  if (!block) {
    throw new Error('DECOMMISSIONED_TCP_HUBS array not found in config.rs');
  }
  const entries = [];
  // Match (&["host"], port) and multi-line (&[ "a", "b" ], port,) groups.
  const groupRe = /\(\s*&\[([\s\S]*?)\]\s*,\s*(\d+)\s*,?\s*\)/g;
  let m;
  while ((m = groupRe.exec(block[1])) !== null) {
    const hosts = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1].toLowerCase()).sort();
    entries.push({ hosts, port: Number(m[2]) });
  }
  if (entries.length === 0) {
    throw new Error('no DECOMMISSIONED_TCP_HUBS entries parsed from config.rs');
  }
  return entries.sort((a, b) => a.port - b.port || a.hosts[0].localeCompare(b.hosts[0]));
}

/** @returns {{ hosts: string[], port: number }[]} */
function extractTsHubs(src) {
  const block = src.match(
    /export const RETICULUM_DECOMMISSIONED_HUB_ENDPOINTS[^=]*=\s*\[([\s\S]*?)\];/,
  );
  if (!block) {
    throw new Error(
      'RETICULUM_DECOMMISSIONED_HUB_ENDPOINTS not found in reticulumDecommissionedHubs.ts',
    );
  }
  const entries = [];
  const objRe = /\{([\s\S]*?)\}/g;
  let m;
  while ((m = objRe.exec(block[1])) !== null) {
    const body = m[1];
    const portMatch = body.match(/port:\s*(\d+)/);
    const hostsBlock = body.match(/hosts:\s*\[([\s\S]*?)\]/);
    if (!portMatch || !hostsBlock) continue;
    const hosts = [...hostsBlock[1].matchAll(/'([^']+)'/g)].map((x) => x[1].toLowerCase()).sort();
    entries.push({ hosts, port: Number(portMatch[1]) });
  }
  if (entries.length === 0) {
    throw new Error('no RETICULUM_DECOMMISSIONED_HUB_ENDPOINTS entries parsed');
  }
  return entries.sort((a, b) => a.port - b.port || a.hosts[0].localeCompare(b.hosts[0]));
}

function serialize(entries) {
  return entries.map((e) => `${e.port}|${e.hosts.join(',')}`).join('\n');
}

try {
  const rust = extractRustHubs(read(RUST_FILE));
  const ts = extractTsHubs(read(TS_FILE));
  const rustKey = serialize(rust);
  const tsKey = serialize(ts);
  if (rustKey !== tsKey) {
    console.error('check-reticulum-decommissioned-hubs: TS ↔ Rust hub lists diverge');
    console.error('Rust:\n' + rustKey);
    console.error('TS:\n' + tsKey);
    process.exit(1);
  }
  console.log(`check-reticulum-decommissioned-hubs: OK (${ts.length} endpoints aligned)`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
