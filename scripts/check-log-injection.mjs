#!/usr/bin/env node
/**
 * Pre-commit / CI check for log injection in main process.
 *
 * Flags console.log/warn/error in src/main that pass raw error-like variables
 * (err, e, error, reason) or error-derived content (e.message, String(e), etc.)
 * without sanitizeLogMessage() at the call site.
 * See CONTRIBUTING.md § Log injection (CodeQL js/log-injection).
 *
 * To suppress a false positive, add // log-injection-ok with a short reason
 * on the same line as the console call.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAIN_DIR = path.resolve(__dirname, '..', 'src', 'main');

// Match console.(log|warn|error|info|debug)( ... , <var> ) where <var> is err|e|error|reason
// and the line does not wrap the value in sanitizeLogMessage (or is suppressed).
const CONSOLE_CALL = /console\.(log|warn|error|info|debug)\s*\(/;
const RAW_ERROR_ARG = /[,(\s]\s*\b(err|e|error|reason)\b/;
// Error-derived content (e.message, String(e), etc.) must also be sanitized at call site.
const ERROR_DERIVED_ARG = /\b(err|e|error|reason)\.message|String\s*\(\s*(err|e|error|reason)\s*\)/;
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
    const hasRawError = RAW_ERROR_ARG.test(line);
    const hasErrorDerived = ERROR_DERIVED_ARG.test(line);
    if (!hasRawError && !hasErrorDerived) continue;
    if (HAS_SANITIZED.test(line)) continue;
    if (SUPPRESSED.test(line)) continue;
    violations.push({ relPath, lineNum, line: line.trim() });
  }

  return violations;
}

function main() {
  const files = fs.readdirSync(MAIN_DIR, { withFileTypes: true });
  let allViolations = [];

  for (const ent of files) {
    if (!ent.isFile() || !ent.name.endsWith('.ts')) continue;
    const filePath = path.join(MAIN_DIR, ent.name);
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
    'See CONTRIBUTING.md § Log injection (CodeQL js/log-injection). To suppress, add // log-injection-ok with a reason.',
  );
  process.exit(1);
}

main();
