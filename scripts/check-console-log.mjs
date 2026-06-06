#!/usr/bin/env node
/**
 * Pre-commit / CI check for bare console.log() calls in source files.
 *
 * The project convention is:
 *   console.debug — trace/verbose output, can be filtered in the App Log panel
 *   console.warn  — non-fatal error, recoverable
 *   console.error — fatal or unexpected failure
 *
 * console.log() is NOT one of these — it appears as an unfilterable 'log' level
 * in the App Log panel and cannot be separated from info/warn/error by the user.
 * Use console.debug() for trace-level diagnostic output instead.
 *
 * To suppress a false positive (rare case where console.log is intentional),
 * add // log-level-ok <reason> on the same line as the console.log call.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = [path.join(ROOT, 'src', 'main'), path.join(ROOT, 'src', 'renderer')];

const CONSOLE_LOG = /\bconsole\.log\s*\(/;
const SUPPRESSED = /\/\/\s*log-level-ok\b/;

const includeTests = process.argv.includes('--include-tests');

function collectSourceFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      results.push(...collectSourceFiles(path.join(dir, ent.name)));
    } else if (ent.isFile() && /\.(ts|tsx)$/.test(ent.name)) {
      if (!includeTests && (ent.name.endsWith('.test.ts') || ent.name.endsWith('.test.tsx'))) {
        continue;
      }
      results.push(path.join(dir, ent.name));
    }
  }
  return results;
}

function checkFile(filePath) {
  const relPath = path.relative(process.cwd(), filePath);
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!CONSOLE_LOG.test(line)) continue;
    if (SUPPRESSED.test(line)) continue;
    violations.push({ relPath, lineNum: i + 1, line: line.trim() });
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

  console.error(
    'check-console-log: bare console.log() calls found (use console.debug/warn/error):\n',
  );
  for (const v of allViolations) {
    console.error(`  ${v.relPath}:${v.lineNum}`);
    console.error(`    ${v.line}`);
    console.error('');
  }
  console.error(
    'Replace with console.debug() for trace output, console.warn() for non-fatal errors,\n' +
      'or console.error() for fatal failures. Add // log-level-ok <reason> to suppress.',
  );
  process.exit(1);
}

main();
