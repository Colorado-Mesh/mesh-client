#!/usr/bin/env node
/**
 * Pre-commit / CI guard against CodeQL `js/insecure-temporary-file`.
 *
 * Flags writing (or copying) a file to a predictable path under the OS temp
 * directory — e.g. `fs.writeFileSync(path.join(os.tmpdir(), 'fixed-name'), ...)`.
 * Prefer `fs.mkdtempSync(path.join(os.tmpdir(), 'prefix-'))` then write inside
 * that unique directory (see AGENTS.md §3 and .github/codeql/README.md).
 *
 * Allowed on the same line as mkdtemp / mkdtempSync (creating the dir itself).
 * String-only joins to tmpdir (mocks, path args with no write) are fine.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCAN_ROOTS = [path.join(ROOT, 'src'), path.join(ROOT, 'scripts')];

const WRITE_FNS = [
  'writeFileSync',
  'writeFile',
  'appendFileSync',
  'appendFile',
  'openSync',
  'createWriteStream',
  'copyFileSync',
  'copyFile',
];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-electron', 'coverage', '.git']);

function collectSourceFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      results.push(...collectSourceFiles(path.join(dir, ent.name)));
    } else if (ent.isFile() && /\.(ts|tsx|mjs|js|cjs)$/.test(ent.name)) {
      if (ent.name === 'check-insecure-temp-files.mjs') continue;
      if (ent.name.endsWith('.test.mjs') && ent.name.startsWith('check-insecure-temp')) continue;
      results.push(path.join(dir, ent.name));
    }
  }
  return results;
}

function isWordChar(c) {
  return (
    c != null &&
    ((c >= 'a' && c <= 'z') ||
      (c >= 'A' && c <= 'Z') ||
      (c >= '0' && c <= '9') ||
      c === '_' ||
      c === '$')
  );
}

function containsWord(haystack, word) {
  let from = 0;
  while (from <= haystack.length - word.length) {
    const i = haystack.indexOf(word, from);
    if (i < 0) return false;
    const before = i === 0 ? null : haystack[i - 1];
    const after = i + word.length >= haystack.length ? null : haystack[i + word.length];
    if (!isWordChar(before) && !isWordChar(after)) return true;
    from = i + 1;
  }
  return false;
}

function lineHasMkdtmp(line) {
  return containsWord(line, 'mkdtemp') || containsWord(line, 'mkdtempSync');
}

/** True if line constructs a path with join(…tmpdir()…). */
function lineHasTmpdirJoin(line) {
  if (!containsWord(line, 'tmpdir') || !containsWord(line, 'join')) return false;
  const tmpIdx = line.indexOf('tmpdir');
  // Require join( somewhere before tmpdir on the same call-ish span
  const joinIdx = line.lastIndexOf('join', tmpIdx);
  if (joinIdx < 0) return false;
  const between = line.slice(joinIdx, tmpIdx + 'tmpdir'.length);
  return between.includes('(') && between.includes('tmpdir');
}

function findWriteCallParenIndex(line) {
  for (const name of WRITE_FNS) {
    let from = 0;
    while (from <= line.length - name.length) {
      const i = line.indexOf(name, from);
      if (i < 0) break;
      const before = i === 0 ? null : line[i - 1];
      // Bare call, or member access (fs.writeFileSync / fs.promises.writeFile)
      if (!isWordChar(before)) {
        let j = i + name.length;
        while (j < line.length && (line[j] === ' ' || line[j] === '\t')) j += 1;
        if (line[j] === '(') return j;
      }
      from = i + 1;
    }
  }
  return -1;
}

/**
 * Track identifiers assigned from join(tmpdir(), …) and flag when later written.
 * Also flag a single call that both joins tmpdir and writes.
 */
function checkFile(filePath) {
  const relPath = path.relative(ROOT, filePath);
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const violations = [];
  /** @type {Map<string, number>} */
  const tmpJoinedIds = new Map();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (lineHasMkdtmp(line) && lineHasTmpdirJoin(line)) {
      // Safe: mkdtempSync(path.join(os.tmpdir(), 'prefix-'))
      continue;
    }

    if (lineHasTmpdirJoin(line)) {
      const assign = line.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
      if (assign) {
        tmpJoinedIds.set(assign[1], lineNum);
      }
    }

    const writeParen = findWriteCallParenIndex(line);
    if (writeParen < 0) continue;

    if (lineHasTmpdirJoin(line)) {
      violations.push({
        relPath,
        lineNum,
        line: line.trim(),
        hint: 'Use fs.mkdtempSync(path.join(os.tmpdir(), "prefix-")) then write inside that dir.',
      });
      continue;
    }

    const afterParen = line.slice(writeParen);
    for (const [id, assignLine] of tmpJoinedIds) {
      if (containsWord(afterParen, id)) {
        violations.push({
          relPath,
          lineNum,
          line: line.trim(),
          hint: `Variable "${id}" (line ${assignLine}) is a predictable os.tmpdir() path. Create with mkdtempSync first.`,
        });
        break;
      }
    }
  }

  return violations;
}

function main() {
  let allViolations = [];
  for (const root of SCAN_ROOTS) {
    for (const filePath of collectSourceFiles(root)) {
      allViolations = allViolations.concat(checkFile(filePath));
    }
  }

  if (allViolations.length === 0) {
    process.exit(0);
    return;
  }

  console.error(
    'check-insecure-temp-files: predictable OS temp writes (CodeQL js/insecure-temporary-file):\n',
  );
  for (const v of allViolations) {
    console.error(`  ${v.relPath}:${v.lineNum}`);
    console.error(`    ${v.line}`);
    console.error(`    Hint: ${v.hint}`);
    console.error('');
  }
  console.error(
    'Fix: fs.mkdtempSync(path.join(os.tmpdir(), "mesh-…-")) then write under that directory.',
  );
  console.error('See AGENTS.md §3 (CodeQL) and .github/codeql/README.md.');
  process.exit(1);
}

main();
