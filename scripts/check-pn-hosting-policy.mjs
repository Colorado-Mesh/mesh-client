#!/usr/bin/env node
/**
 * Pre-commit / CI check: TS PN hosting policy stays aligned with sidecar Rust.
 *
 * Compares:
 *   - DEFAULT numeric / boolean constants
 *   - MAX_* caps (including MAX_STATIC_PEERS = 256)
 *   - validation error token strings that appear in both
 *
 * Sources:
 *   - src/shared/pnHostingPolicy.ts
 *   - reticulum-sidecar/src/stack/pn_hosting_policy.rs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const RUST_FILE = path.join(ROOT, 'reticulum-sidecar', 'src', 'stack', 'pn_hosting_policy.rs');
const TS_FILE = path.join(ROOT, 'src', 'shared', 'pnHostingPolicy.ts');

const CHECK = 'check-pn-hosting-policy';

/** TS DEFAULT_PN_HOSTING_POLICY field → Rust DEFAULT_* const name. */
const DEFAULT_FIELD_TO_RUST = {
  peering_cost: 'DEFAULT_PEERING_COST',
  max_peering_cost: 'DEFAULT_MAX_PEERING_COST',
  autopeer: 'DEFAULT_AUTOPEER',
  autopeer_maxdepth: 'DEFAULT_AUTOPEER_MAXDEPTH',
  max_peers: 'DEFAULT_MAX_PEERS',
  propagation_stamp_cost: 'DEFAULT_PROPAGATION_STAMP_COST',
  propagation_stamp_flex: 'DEFAULT_PROPAGATION_STAMP_FLEX',
  message_storage_limit_mb: 'DEFAULT_MESSAGE_STORAGE_LIMIT_MB',
  propagation_limit_kb: 'DEFAULT_PROPAGATION_LIMIT_KB',
  sync_limit_kb: 'DEFAULT_SYNC_LIMIT_KB',
  delivery_limit_kb: 'DEFAULT_DELIVERY_LIMIT_KB',
  pn_announce_interval_sec: 'DEFAULT_PN_ANNOUNCE_INTERVAL_SEC',
  announce_at_start: 'DEFAULT_ANNOUNCE_AT_START',
};

/** Named MAX_* expected in TS (and named or literal-equivalent in Rust). */
const REQUIRED_MAX_NAMES = [
  'MAX_AUTOPEER_MAXDEPTH',
  'MAX_MAX_PEERS',
  'MAX_STATIC_PEERS',
  'MAX_STORAGE_MB',
  'MAX_LIMIT_KB',
  'MAX_PN_ANNOUNCE_INTERVAL_SEC',
  'MAX_NODE_NAME_CHARS',
];

/** Validation error tokens that must appear in both TS and Rust sources. */
const SHARED_ERROR_TOKENS = [
  'peering_cost_exceeds_max',
  'stamp_flex_exceeds_cost',
  'autopeer_maxdepth_out_of_range',
  'max_peers_out_of_range',
  'message_storage_limit_out_of_range',
  'propagation_limit_out_of_range',
  'sync_limit_out_of_range',
  'delivery_limit_out_of_range',
  'pn_announce_interval_out_of_range',
  'static_peers_too_many',
  'static_peer_invalid',
  'node_name_invalid',
  'node_name_too_long',
];

function read(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`${CHECK}: missing ${filePath}`);
    process.exit(1);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function parseNumericLiteral(raw) {
  const cleaned = String(raw).replace(/_/g, '').trim();
  if (cleaned === 'true') return true;
  if (cleaned === 'false') return false;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) {
    throw new Error(`unparseable literal: ${raw}`);
  }
  return n;
}

/** Extract `pub const NAME: T = VALUE` / `const NAME: T = VALUE` from Rust. */
function extractRustConsts(src) {
  const out = {};
  for (const line of src.split('\n')) {
    const trimmed = line.trim();
    const pub = trimmed.startsWith('pub const ') ? 'pub const ' : null;
    const prefix = pub ?? (trimmed.startsWith('const ') ? 'const ' : null);
    if (!prefix) continue;
    const rest = trimmed.slice(prefix.length);
    const colon = rest.indexOf(':');
    const eq = rest.indexOf('=');
    const semi = rest.indexOf(';');
    if (colon < 0 || eq < 0 || semi < 0 || eq < colon) continue;
    const name = rest.slice(0, colon).trim();
    if (!(name.startsWith('DEFAULT_') || name.startsWith('MAX_'))) continue;
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
    out[name] = parseNumericLiteral(rest.slice(eq + 1, semi).trim());
  }
  return out;
}

/** Extract `const MAX_* = N` from TypeScript. */
function extractTsMaxConsts(src) {
  const out = {};
  for (const line of src.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('const MAX_')) continue;
    const eq = trimmed.indexOf('=');
    const semi = trimmed.indexOf(';');
    if (eq < 0 || semi < 0) continue;
    const name = trimmed.slice('const '.length, eq).trim();
    if (!name.startsWith('MAX_') || !/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
    out[name] = parseNumericLiteral(trimmed.slice(eq + 1, semi).trim());
  }
  return out;
}

/** Extract field values from `export const DEFAULT_PN_HOSTING_POLICY`. */
function extractTsDefaults(src) {
  const block = src.match(
    /export const DEFAULT_PN_HOSTING_POLICY:\s*PnHostingPolicy\s*=\s*\{([\s\S]*?)\n\};/,
  );
  if (!block) {
    throw new Error('DEFAULT_PN_HOSTING_POLICY not found in pnHostingPolicy.ts');
  }
  const out = {};
  const re = /(\w+)\s*:\s*([^,\n]+)/g;
  let m;
  while ((m = re.exec(block[1])) !== null) {
    const key = m[1];
    const raw = m[2].trim();
    if (raw === 'null' || raw === '[]') continue;
    if (raw === 'true' || raw === 'false' || /^-?[\d_]+$/.test(raw)) {
      out[key] = parseNumericLiteral(raw);
    }
  }
  return out;
}

/**
 * Rust may use a literal instead of a named MAX_* for announce interval / node name.
 * Fall back to the comparison in `validate`.
 */
function extractRustMaxFallbacks(src, named) {
  const out = { ...named };
  if (out.MAX_PN_ANNOUNCE_INTERVAL_SEC == null) {
    const m = src.match(/pn_announce_interval_sec\s*>\s*([\d_]+)/);
    if (m) out.MAX_PN_ANNOUNCE_INTERVAL_SEC = parseNumericLiteral(m[1]);
  }
  if (out.MAX_NODE_NAME_CHARS == null) {
    const m = src.match(/chars\(\)\.count\(\)\s*>\s*([\d_]+)/);
    if (m) out.MAX_NODE_NAME_CHARS = parseNumericLiteral(m[1]);
  }
  return out;
}

const rustSrc = read(RUST_FILE);
const tsSrc = read(TS_FILE);

let failed = false;

try {
  const rustConsts = extractRustConsts(rustSrc);
  const tsDefaults = extractTsDefaults(tsSrc);
  const tsMax = extractTsMaxConsts(tsSrc);
  const rustMax = extractRustMaxFallbacks(rustSrc, rustConsts);

  // Defaults: TS object fields vs Rust DEFAULT_* consts.
  for (const [field, rustName] of Object.entries(DEFAULT_FIELD_TO_RUST)) {
    if (!(field in tsDefaults)) {
      console.error(`${CHECK}: TS DEFAULT_PN_HOSTING_POLICY missing field ${field}`);
      failed = true;
      continue;
    }
    if (!(rustName in rustConsts)) {
      console.error(`${CHECK}: Rust missing ${rustName}`);
      failed = true;
      continue;
    }
    if (tsDefaults[field] !== rustConsts[rustName]) {
      console.error(
        `${CHECK}: default ${field} diverge (ts=${tsDefaults[field]} rust=${rustConsts[rustName]})`,
      );
      failed = true;
    }
  }

  // MAX_* caps
  for (const name of REQUIRED_MAX_NAMES) {
    if (!(name in tsMax)) {
      console.error(`${CHECK}: TS missing ${name}`);
      failed = true;
      continue;
    }
    if (!(name in rustMax)) {
      console.error(`${CHECK}: Rust missing ${name} (named const or validate literal)`);
      failed = true;
      continue;
    }
    if (tsMax[name] !== rustMax[name]) {
      console.error(`${CHECK}: ${name} diverge (ts=${tsMax[name]} rust=${rustMax[name]})`);
      failed = true;
    }
  }

  if (tsMax.MAX_STATIC_PEERS !== 256 || rustMax.MAX_STATIC_PEERS !== 256) {
    console.error(
      `${CHECK}: MAX_STATIC_PEERS must be 256 (ts=${tsMax.MAX_STATIC_PEERS} rust=${rustMax.MAX_STATIC_PEERS})`,
    );
    failed = true;
  }

  for (const tok of SHARED_ERROR_TOKENS) {
    if (!tsSrc.includes(tok)) {
      console.error(`${CHECK}: TS missing validation error token ${tok}`);
      failed = true;
    }
    if (!rustSrc.includes(tok)) {
      console.error(`${CHECK}: Rust missing validation error token ${tok}`);
      failed = true;
    }
  }
} catch (e) {
  console.error(`${CHECK}: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}

if (failed) {
  process.exit(1);
}

console.log(`${CHECK}: ok`);
