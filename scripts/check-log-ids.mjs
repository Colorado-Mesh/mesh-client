#!/usr/bin/env node
/**
 * Pre-commit / CI check for stable log message IDs (`mcL####`).
 *
 * Phase A (always):
 *   - Registry keys in src/shared/logMessageIds.ts are unique and match /^mcL\d{4,}$/
 *   - Every mcL#### in src/main|renderer (non-test) is registered
 *   - Every registry ID appears at least once as a string literal outside the registry map keys
 *   - logCaughtWarn / reportCaughtSeriousError / warnWithLogId / errorWithLogId first arg is a
 *     string literal mcL#### (or imported const used as first arg — we require literal for helpers)
 *
 * Phase C (full-tree require) when MESH_CLIENT_LOG_IDS_REQUIRE_ALL=1 or --require-all:
 *   - Every production console.warn / console.error must contain an mcL#### token in its
 *     first string argument (or go through *WithLogId / logCaughtWarn / reportCaughtSeriousError).
 *
 * @see src/shared/logMessageIds.ts
 * @see AGENTS.md §3 Logging
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { joinUnderRoot } from './lib/path-under-root.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REGISTRY_PATH = joinUnderRoot(ROOT, 'src', 'shared', 'logMessageIds.ts');
const SCAN_DIRS = [
  joinUnderRoot(ROOT, 'src', 'main'),
  joinUnderRoot(ROOT, 'src', 'renderer'),
  joinUnderRoot(ROOT, 'src', 'shared'),
];

const ID_TOKEN_RE = /\bmcL\d{4,}\b/;
const ID_FULL_RE = /^mcL\d{4,}$/;
const requireAll =
  process.argv.includes('--require-all') || process.env.MESH_CLIENT_LOG_IDS_REQUIRE_ALL === '1';

function collectSourceFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      results.push(...collectSourceFiles(joinUnderRoot(dir, ent.name)));
    } else if (ent.isFile() && /\.(ts|tsx)$/.test(ent.name)) {
      if (
        ent.name.endsWith('.test.ts') ||
        ent.name.endsWith('.test.tsx') ||
        ent.name.endsWith('.setup.ts') ||
        ent.name.endsWith('.setup.tsx')
      ) {
        continue;
      }
      results.push(joinUnderRoot(dir, ent.name));
    }
  }
  return results;
}

function parseRegistry(source) {
  const ids = new Map();
  // Match LOG_MESSAGE_IDS object entries: mcL####: 'note'
  const bodyMatch = source.match(
    /export const LOG_MESSAGE_IDS[^=]*=\s*\{([\s\S]*?)\n\s*\} as const|export const LOG_MESSAGE_IDS[^=]*=\s*\{([\s\S]*?)\n\};/,
  );
  const body = bodyMatch ? (bodyMatch[1] ?? bodyMatch[2] ?? '') : '';
  // Also support Readonly<Record> without `as const`
  const fallbackBody =
    body ||
    (source.match(/export const LOG_MESSAGE_IDS[\s\S]*?=\s*\{([\s\S]*?)\};/) || [])[1] ||
    '';
  const re = /\b(mcL\d{4,})\s*:\s*(['"`])([^'"`]*)\2/g;
  let m;
  while ((m = re.exec(fallbackBody)) !== null) {
    if (ids.has(m[1])) {
      throw new Error(`duplicate registry key ${m[1]}`);
    }
    ids.set(m[1], m[3]);
  }
  return ids;
}

function findIdsInFile(content) {
  const found = new Set();
  // Literal global regex (not constructed) for Semgrep/ESLint non-literal-regexp.
  const re = /\bmcL\d{4,}\b/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    found.add(m[0]);
  }
  return found;
}

/**
 * Heuristic: find console.warn/error calls whose first significant arg lacks mcL####.
 * Skips calls that already go through helpers (those are checked separately).
 */
function findWarnErrorMissingIds(content, relPath) {
  const violations = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const code = line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '');
    if (!/\bconsole\.(warn|error)\s*\(/.test(code)) continue;
    if (
      /\b(?:warnWithLogId|errorWithLogId|logCaughtWarn|reportCaughtSeriousError|formatLogId)\b/.test(
        line,
      )
    ) {
      continue;
    }
    // Multi-line: collect a short window
    let window = line;
    for (let j = 1; j <= 5 && i + j < lines.length; j++) {
      window += '\n' + lines[i + j];
      if (window.includes(')')) break;
    }
    if (ID_TOKEN_RE.test(window)) continue;
    if (/\bformatLogId\s*\(/.test(window)) continue;
    // warnWithLogId/errorWithLogId implementations forward a LogMessageId variable
    if (/\bconsole\.(?:warn|error)\(\s*id\b/.test(window)) continue;
    // Allow eslint-disable / test doubles — already skipped test files
    violations.push({ relPath, lineNum: i + 1, line: line.trim() });
  }
  return violations;
}

function main() {
  const errors = [];
  let registry;
  try {
    const regSource = fs.readFileSync(REGISTRY_PATH, 'utf8');
    registry = parseRegistry(regSource);
  } catch (e) {
    console.error('check-log-ids: failed to parse registry:', e);
    process.exit(1);
  }

  if (registry.size === 0) {
    console.error('check-log-ids: LOG_MESSAGE_IDS registry is empty or unparseable');
    process.exit(1);
  }

  for (const id of registry.keys()) {
    if (!ID_FULL_RE.test(id)) {
      errors.push(`invalid registry key: ${id}`);
    }
  }

  const files = SCAN_DIRS.flatMap(collectSourceFiles);
  const usedOutsideRegistryKeys = new Set();
  const allSourceIds = new Set();

  for (const filePath of files) {
    const relPath = path.relative(ROOT, filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    const ids = findIdsInFile(content);
    for (const id of ids) {
      allSourceIds.add(id);
      // Count as "used" if the id appears as a quoted string or outside a registry map key line.
      if (
        content.includes(`'${id}'`) ||
        content.includes(`"${id}"`) ||
        content.includes(`\`${id}\``)
      ) {
        usedOutsideRegistryKeys.add(id);
        continue;
      }
      const keyLine = `${id}:`;
      const linesWithId = content.split('\n').filter((l) => l.includes(id));
      const onlyMapKeys = linesWithId.every((l) => {
        const trimmed = l.trim();
        return trimmed.startsWith(keyLine) || trimmed.startsWith(`// ${id}`);
      });
      if (!onlyMapKeys || !relPath.endsWith('logMessageIds.ts')) {
        usedOutsideRegistryKeys.add(id);
      }
    }

    // Helper call sites (not function declarations) must pass literal mcL#### or LOG_ID_CAUGHT_*
    const callRe =
      /\b(?:logCaughtWarn|reportCaughtSeriousError|warnWithLogId|errorWithLogId)\s*\(/g;
    let cm;
    while ((cm = callRe.exec(content)) !== null) {
      const before = content.slice(Math.max(0, cm.index - 40), cm.index);
      if (/\bfunction\s+$/.test(before) || /\bexport\s+function\s+$/.test(before)) continue;
      const slice = content.slice(cm.index, cm.index + 120);
      if (/\(\s*['"`]mcL\d{4,}['"`]/.test(slice) || /\(\s*LOG_ID_CAUGHT_/.test(slice)) continue;
      // Allow typed params in signatures: (id: LogMessageId
      if (/\(\s*id\s*:/.test(slice)) continue;
      const lineNum = content.slice(0, cm.index).split('\n').length;
      errors.push(
        `${relPath}:${lineNum}: helper call must use a literal mcL#### or LOG_ID_CAUGHT_* as first arg`,
      );
    }

    if (requireAll) {
      for (const v of findWarnErrorMissingIds(content, relPath)) {
        errors.push(
          `${v.relPath}:${v.lineNum}: console.warn/error missing mcL#### (or use *WithLogId):\n    ${v.line}`,
        );
      }
    }
  }

  for (const id of allSourceIds) {
    if (!registry.has(id)) {
      errors.push(`unregistered log id ${id} (add to LOG_MESSAGE_IDS in logMessageIds.ts)`);
    }
  }

  // Build one set of quoted mcL#### literals across scanned sources (avoid O(ids×files) reads).
  const quotedLiterals = new Set();
  const quotedRe = /['"`](mcL\d{4,})['"`]/g;
  for (const fp of [REGISTRY_PATH, ...files]) {
    const text = fs.readFileSync(fp, 'utf8');
    let qm;
    quotedRe.lastIndex = 0;
    while ((qm = quotedRe.exec(text)) !== null) {
      quotedLiterals.add(qm[1]);
    }
  }
  for (const id of registry.keys()) {
    if (!quotedLiterals.has(id) && !usedOutsideRegistryKeys.has(id) && !allSourceIds.has(id)) {
      errors.push(
        `registry id ${id} has no string-literal use (export LOG_ID_* or pass at call site)`,
      );
    }
  }

  if (errors.length > 0) {
    console.error('check-log-ids: failures:\n');
    for (const e of errors) {
      console.error(`  ${e}`);
    }
    console.error(
      '\nAllocate IDs in src/shared/logMessageIds.ts. Warn/error must include mcL####.' +
        (requireAll
          ? ''
          : '\n(Full-tree require is off; pass --require-all to enforce all warn/error.)'),
    );
    process.exit(1);
  }

  console.log(
    `check-log-ids: ok (${registry.size} registered ids${requireAll ? ', require-all' : ''})`,
  );
}

main();
