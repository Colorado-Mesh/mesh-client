#!/usr/bin/env node
/**
 * Pre-commit / CI check for log injection in main process.
 *
 * Flags console.log/warn/error/info/debug under recursive src/main/** that pass
 * raw error-like variables (err, e, error, reason) or error-derived content
 * (e.message, String(e), etc.) without sanitizeLogMessage() at the call site.
 * Prefer logCaughtDebug(tag, err) from caughtErrorPolicy for soft catches —
 * it sanitizes; raw console.debug(..., e) will fail here even when silent-catches
 * is green. See AGENTS.md §3 (Log injection / sanitizeLogMessage; CodeQL js/log-injection).
 *
 * To suppress a false positive, add // log-injection-ok with a short reason
 * on the same line as the console call.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { joinUnderRoot } from './lib/path-under-root.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAIN_DIR = path.resolve(__dirname, '..', 'src', 'main');

// Match console.(log|warn|error|info|debug)( ... ) that pass a *direct* error-like
// argument (err|e|error|reason) — not identifiers nested inside helpers like
// errText(e) / errorMessage(err), and not the word "error" inside a string literal.
const CONSOLE_CALL = /console\.(log|warn|error|info|debug)\s*\(/;
/** Direct arg: console.debug(e) or console.debug('…', err) / trailing comma form. */
const RAW_DIRECT_ERROR_ARG =
  /(?:console\.(?:log|warn|error|info|debug)\s*\(\s*|\s*,\s*)\b(err|e|error|reason)\b\s*[,)]/;
// Error-derived content (e.message, String(e), etc.) must also be sanitized at call site.
const ERROR_DERIVED_ARG =
  /(?:^|[,(])\s*\b(err|e|error|reason)\.message\b|String\s*\(\s*(err|e|error|reason)\s*\)/;
const HAS_SANITIZED = /sanitizeLogMessage\s*\(/;
const SUPPRESSED = /\/\/\s*log-injection-ok\b/;

function checkFile(filePath) {
  const relPath = path.relative(process.cwd(), filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    if (!CONSOLE_CALL.test(line)) continue;
    const hasRawError = RAW_DIRECT_ERROR_ARG.test(line);
    const hasErrorDerived = ERROR_DERIVED_ARG.test(line);
    if (!hasRawError && !hasErrorDerived) continue;
    if (HAS_SANITIZED.test(line)) continue;
    if (SUPPRESSED.test(line)) continue;
    violations.push({ relPath, lineNum, line: line.trim() });
  }

  return violations;
}

function collectMainTsFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      results.push(...collectMainTsFiles(joinUnderRoot(dir, ent.name)));
    } else if (ent.isFile() && ent.name.endsWith('.ts')) {
      if (ent.name.endsWith('.test.ts')) continue;
      results.push(joinUnderRoot(dir, ent.name));
    }
  }
  return results;
}

function main() {
  let allViolations = [];

  for (const filePath of collectMainTsFiles(MAIN_DIR)) {
    allViolations = allViolations.concat(checkFile(filePath));
  }

  if (allViolations.length === 0) {
    process.exit(0);
    return;
  }

  console.error(
    'check-log-injection: possible log injection (use sanitizeLogMessage at call site):\n',
  );
  for (const v of allViolations) {
    console.error(`  ${v.relPath}:${v.lineNum}`);
    console.error(`    ${v.line}`);
    console.error('');
  }
  console.error(
    'See AGENTS.md §3 (Log injection / sanitizeLogMessage). Prefer logCaughtDebug. To suppress, add // log-injection-ok with a reason.',
  );
  process.exit(1);
}

main();
