#!/usr/bin/env node
/**
 * Assign mcL#### IDs to every production console.warn / console.error that lacks one,
 * and rewrite src/shared/logMessageIds.ts registry.
 *
 * Usage: node scripts/backfill-log-ids.mjs [--dry-run]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { joinUnderRoot } from './lib/path-under-root.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REGISTRY = joinUnderRoot(ROOT, 'src', 'shared', 'logMessageIds.ts');
const dryRun = process.argv.includes('--dry-run');
const ID_RE = /\bmcL\d{4,}\b/;

function collect(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = joinUnderRoot(dir, ent.name);
    if (ent.isDirectory()) collect(p, out);
    else if (/\.(ts|tsx)$/.test(ent.name) && !ent.name.includes('.test.')) out.push(p);
  }
  return out;
}

function parseRegistry(source) {
  const ids = new Map();
  const m = source.match(/export const LOG_MESSAGE_IDS[\s\S]*?=\s*\{([\s\S]*?)\n\};/);
  if (!m) return ids;
  const re = /\b(mcL\d{4,})\s*:\s*(['"`])([^'"`]*)\2/g;
  let x;
  while ((x = re.exec(m[1])) !== null) ids.set(x[1], x[3]);
  return ids;
}

function nextId(registry) {
  let max = 0;
  for (const key of registry.keys()) {
    const n = Number(/^mcL(\d+)$/.exec(key)?.[1] ?? 0);
    if (n > max) max = n;
  }
  const next = max + 1;
  const width = Math.max(4, String(next).length);
  return `mcL${String(next).padStart(width, '0')}`;
}

function noteFor(filePath, lineNum) {
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  return `${rel}:${lineNum}`.slice(0, 120);
}

/**
 * Prefix first string literal arg of console.warn/error on a line (and short multi-line window).
 */
function processFile(filePath, registry) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let changed = 0;
  const out = [...lines];

  for (let i = 0; i < out.length; i++) {
    const line = out[i];
    if (!/\bconsole\.(warn|error)\s*\(/.test(line)) continue;
    if (
      /\b(?:warnWithLogId|errorWithLogId|logCaughtWarn|reportCaughtSeriousError|formatLogId)\b/.test(
        line,
      )
    ) {
      continue;
    }
    let window = line;
    let end = i;
    for (let j = 1; j <= 8 && i + j < out.length; j++) {
      window += '\n' + out[i + j];
      end = i + j;
      if (/\)/.test(out[i + j])) break;
    }
    if (ID_RE.test(window)) continue;
    if (/\bformatLogId\s*\(/.test(window)) continue;

    const id = nextId(registry);
    registry.set(id, noteFor(filePath, i + 1));

    // Prefer prefixing first '...' or "..." after (
    const prefixed = window.replace(
      /(console\.(?:warn|error)\s*\(\s*)(['"`])/,
      (_m, pre, q) => `${pre}${q}${id} `,
    );
    if (prefixed === window) {
      // No string literal — insert id as first arg
      const inserted = window.replace(
        /(console\.(?:warn|error)\s*\()(\s*)/,
        (_m, pre, sp) => `${pre}${sp}'${id}', `,
      );
      if (inserted === window) continue;
      const newLines = inserted.split('\n');
      for (let k = 0; k < newLines.length; k++) out[i + k] = newLines[k];
    } else {
      const newLines = prefixed.split('\n');
      for (let k = 0; k < newLines.length; k++) out[i + k] = newLines[k];
    }
    changed++;
    void end;
  }

  return { content: out.join('\n'), changed, registry };
}

function writeRegistry(registry) {
  const entries = [...registry.entries()].sort((a, b) => {
    const na = Number(a[0].slice(3));
    const nb = Number(b[0].slice(3));
    return na - nb;
  });
  const body = entries.map(([id, note]) => `  ${id}: ${JSON.stringify(note)},`).join('\n');
  const source = `/**
 * Stable log message IDs (\`mcL####\`) for production \`console.warn\` / \`console.error\`.
 * Allocate the next free ID here; never reuse. Grep the token in a support zip to find the call site.
 *
 * @see scripts/check-log-ids.mjs
 */

/** Matches a log ID token embedded in a warn/error message. */
export const LOG_MESSAGE_ID_RE = /\\bmcL\\d{4,}\\b/;

/** Full-string form used when validating registry keys / helper args. */
export const LOG_MESSAGE_ID_FULL_RE = /^mcL\\d{4,}$/;

export type LogMessageId = \`mcL\${string}\`;

/**
 * Registry of allocated IDs → short owner note (module.purpose).
 * Every ID used in src/main or src/renderer must appear here; every entry must be referenced
 * at least once outside this object's keys (string literal elsewhere in src/).
 */
export const LOG_MESSAGE_IDS: Readonly<Record<string, string>> = {
${body}
};

/** Reserved IDs for caught-error helpers (import these at call sites when appropriate). */
export const LOG_ID_CAUGHT_WARN = 'mcL0001' as const satisfies LogMessageId;
export const LOG_ID_CAUGHT_SERIOUS = 'mcL0002' as const satisfies LogMessageId;

/** Next ID to allocate (max numeric suffix + 1, zero-padded to ≥4 digits). */
export function nextLogMessageId(
  registry: Readonly<Record<string, string>> = LOG_MESSAGE_IDS,
): LogMessageId {
  let max = 0;
  for (const key of Object.keys(registry)) {
    const m = /^mcL(\\d+)$/.exec(key);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  const next = max + 1;
  const width = Math.max(4, String(next).length);
  return \`mcL\${String(next).padStart(width, '0')}\` as LogMessageId;
}

/** Prefix a message with a registered log ID (whitespace-separated token). */
export function formatLogId(id: LogMessageId, message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return id;
  if (trimmed.includes(id)) return trimmed;
  return \`\${id} \${trimmed}\`;
}

export function isLogMessageId(value: string): value is LogMessageId {
  return LOG_MESSAGE_ID_FULL_RE.test(value);
}
`;
  return source;
}

function main() {
  const regSource = fs.readFileSync(REGISTRY, 'utf8');
  const registry = parseRegistry(regSource);
  // Ensure starter IDs exist
  if (!registry.has('mcL0001')) registry.set('mcL0001', 'caughtErrorPolicy.logCaughtWarn');
  if (!registry.has('mcL0002'))
    registry.set('mcL0002', 'caughtErrorPolicy.reportCaughtSeriousError');

  let total = 0;
  let files = 0;
  const targets = [
    ...collect(joinUnderRoot(ROOT, 'src', 'main')),
    ...collect(joinUnderRoot(ROOT, 'src', 'renderer')),
  ];

  for (const file of targets) {
    const { content, changed, registry: reg } = processFile(file, registry);
    if (changed > 0) {
      files++;
      total += changed;
      console.log(`${dryRun ? '[dry] ' : ''}${path.relative(ROOT, file)}: +${changed}`);
      if (!dryRun) fs.writeFileSync(file, content, 'utf8');
    }
    // registry mutated in place
    void reg;
  }

  if (!dryRun) {
    fs.writeFileSync(REGISTRY, writeRegistry(registry), 'utf8');
  }
  console.log(
    `${dryRun ? 'Would assign' : 'Assigned'} ${total} ids across ${files} files; registry size ${registry.size}`,
  );
}

main();
