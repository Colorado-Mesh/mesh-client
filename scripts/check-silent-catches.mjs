#!/usr/bin/env node
/**
 * Pre-commit / CI check for silent catch blocks.
 *
 * Flags catch blocks in src/main and src/renderer that contain no console.*
 * call and no rethrow (throw statement). Silent catches make post-mortem
 * debugging impossible.
 *
 * To suppress a false positive (e.g., intentional teardown cleanup), add:
 *   // catch-no-log-ok <reason>
 * on the catch line itself or anywhere inside the catch body.
 *
 * Note: catch blocks that only rethrow (throw e / throw new Error(...)) are
 * also allowed without logging — the caller is responsible for logging there.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = [path.join(ROOT, 'src', 'main'), path.join(ROOT, 'src', 'renderer')];

const SUPPRESSION = /\/\/\s*catch-no-log-ok\b/;
// Also recognise `original.(debug|...)` — the pre-patch console alias used in log-service.ts
// and `debugLogService(...)` — sanitized internal logging in log-service.ts
const HAS_CONSOLE = /(?:console|original)\.(log|warn|error|info|debug)\s*\(|debugLogService\s*\(/;
const HAS_THROW = /\bthrow\b/;
/** Main-process db IPC handlers delegate logging/rethrow to these helpers. */
const DELEGATES_DB_IPC_ERROR = /\bfinishDbIpc(?:Read)?Handler\s*\(/;

function collectSourceFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      results.push(...collectSourceFiles(path.join(dir, ent.name)));
    } else if (ent.isFile() && /\.(ts|tsx)$/.test(ent.name)) {
      // Skip test files — they often assert on error objects inside catch blocks
      if (ent.name.endsWith('.test.ts') || ent.name.endsWith('.test.tsx')) continue;
      results.push(path.join(dir, ent.name));
    }
  }
  return results;
}

/**
 * Walk the character stream of a source file and return an array of catch
 * block records: { catchLineNum, body, catchContext }.
 *
 * Strategy: find 'catch' as a keyword, skip optional '(binding)', find the
 * opening '{', then collect everything up to the matching '}'. This is not a
 * full parser — it can be confused by 'catch' inside strings or template
 * literals — but it is good enough for a linting heuristic and matches the
 * pragmatism of the existing check-log-injection.mjs script.
 */
function parseCatchBlocks(content) {
  const blocks = [];
  const lines = content.split('\n');

  // Map character offset → line number (1-indexed)
  const lineStarts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') lineStarts.push(i + 1);
  }
  function lineNumAt(charOffset) {
    let lo = 0,
      hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= charOffset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  const CATCH_RE = /\bcatch\b/g;
  let m;
  while ((m = CATCH_RE.exec(content)) !== null) {
    const catchPos = m.index;
    let j = catchPos + m[0].length;

    // Skip whitespace
    while (j < content.length && /\s/.test(content[j])) j++;

    // Skip optional (binding)
    if (j < content.length && content[j] === '(') {
      let depth = 1;
      j++;
      while (j < content.length && depth > 0) {
        if (content[j] === '(') depth++;
        else if (content[j] === ')') depth--;
        j++;
      }
    }

    // Skip whitespace
    while (j < content.length && /\s/.test(content[j])) j++;

    // Must be followed by '{' (otherwise it's 'catch' in a comment/string — skip)
    if (j >= content.length || content[j] !== '{') continue;

    const openBrace = j;
    j++; // skip '{'
    let depth = 1;
    const bodyStart = j;
    while (j < content.length && depth > 0) {
      if (content[j] === '{') depth++;
      else if (content[j] === '}') depth--;
      j++;
    }
    const body = content.slice(bodyStart, j - 1);
    const catchContext = content.slice(catchPos, openBrace);
    const catchLineNum = lineNumAt(catchPos);
    const catchLineText = lines[catchLineNum - 1] || '';

    blocks.push({ catchLineNum, catchLineText, body, catchContext });
  }

  return blocks;
}

function checkFile(filePath) {
  const relPath = path.relative(process.cwd(), filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  const blocks = parseCatchBlocks(content);
  const violations = [];

  for (const { catchLineNum, catchLineText, body, catchContext } of blocks) {
    // Suppression comment on the catch line or anywhere in the body
    if (SUPPRESSION.test(catchContext) || SUPPRESSION.test(body)) continue;
    // Has a console.* call — logged
    if (HAS_CONSOLE.test(body)) continue;
    // Rethrows — the caller handles logging
    if (HAS_THROW.test(body)) continue;
    // Delegates to finishDbIpcHandler / finishDbIpcReadHandler (logs or rethrows)
    if (DELEGATES_DB_IPC_ERROR.test(body)) continue;

    violations.push({ relPath, lineNum: catchLineNum, line: catchLineText.trim() });
  }

  return violations;
}

function main() {
  let allViolations = [];

  for (const dir of SCAN_DIRS) {
    for (const filePath of collectSourceFiles(dir)) {
      allViolations = allViolations.concat(checkFile(filePath));
    }
  }

  if (allViolations.length === 0) {
    process.exit(0);
    return;
  }

  console.error('check-silent-catches: catch blocks that swallow errors silently:\n');
  for (const v of allViolations) {
    console.error(`  ${v.relPath}:${v.lineNum}`);
    console.error(`    ${v.line}`);
    console.error('');
  }
  console.error(
    'Add console.debug/warn/error inside the catch block, or add // catch-no-log-ok <reason> to suppress.',
  );
  process.exit(1);
}

main();
