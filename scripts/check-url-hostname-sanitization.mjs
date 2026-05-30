#!/usr/bin/env node
/**
 * Pre-commit / CI check mirroring CodeQL js/incomplete-url-substring-sanitization.
 *
 * Flags .includes() / .indexOf() with a hostname-shaped string literal on lines
 * that look URL-related (href, url, fetch, address, etc.). Use parsed hostname
 * checks instead: new URL(...).hostname === 'allowed.example' or a Set lookup.
 *
 * To suppress a false positive, add // url-hostname-check-ok with a short reason.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['src/main', 'src/preload', 'src/renderer'].map((d) => path.join(ROOT, d));

const SUBSTRING_ON_LITERAL = /\.(?:includes|indexOf)\s*\(\s*['"]([^'"]+)['"]\s*[,)]/g;

/** At least label.tld — excludes decimals like scale(0.4167) and paths like 2/e/. */
function isHostnameLikeLiteral(literal) {
  const labels = literal.split('.');
  if (labels.length < 2) return false;
  return labels.every((label) => {
    if (label.length === 0) return false;
    if (!/^[a-z0-9-]+$/i.test(label)) return false;
    return /^[a-z0-9]/i.test(label) && /[a-z0-9]$/i.test(label);
  });
}
const URL_CONTEXT =
  /\b(?:url|href|uri|hostname|host|address|fetch|redirect|location|origin|endpoint|opengraph)\b/i;
const SUPPRESSED = /\/\/\s*url-hostname-check-ok\b/;
const SKIP_LITERAL = /^(?:text\/html|application\/|image\/|audio\/|video\/)/i;

/**
 * @returns {Array<{ name: string, literal: string, hint: string }>}
 */
export function checkLine(line) {
  if (SUPPRESSED.test(line)) return [];

  const violations = [];
  let match;
  SUBSTRING_ON_LITERAL.lastIndex = 0;
  while ((match = SUBSTRING_ON_LITERAL.exec(line)) !== null) {
    const literal = match[1];
    if (!isHostnameLikeLiteral(literal)) continue;
    if (SKIP_LITERAL.test(literal)) continue;
    if (!URL_CONTEXT.test(line)) continue;
    violations.push({
      name: 'hostname substring URL check',
      literal,
      hint: `Use new URL(...).hostname (or .hostname.toLowerCase()) instead of .includes('${literal}'). See CodeQL js/incomplete-url-substring-sanitization.`,
    });
  }
  return violations;
}

function collectSourceFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      results.push(...collectSourceFiles(path.join(dir, ent.name)));
    } else if (ent.isFile() && /\.(ts|tsx)$/.test(ent.name)) {
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
    for (const v of checkLine(lines[i])) {
      violations.push({
        relPath,
        lineNum: i + 1,
        line: lines[i].trim(),
        ...v,
      });
    }
  }

  return violations;
}

function main() {
  let allViolations = [];

  for (const scanDir of SCAN_DIRS) {
    for (const filePath of collectSourceFiles(scanDir)) {
      allViolations = allViolations.concat(checkFile(filePath));
    }
  }

  if (allViolations.length === 0) {
    process.exit(0);
    return;
  }

  console.error('check-url-hostname-sanitization: incomplete URL host checks (CodeQL CWE-020):\n');
  for (const v of allViolations) {
    console.error(`  ${v.relPath}:${v.lineNum}  [${v.name}] literal "${v.literal}"`);
    console.error(`    ${v.line}`);
    console.error(`    Hint: ${v.hint}`);
    console.error('');
  }
  console.error(
    'To suppress a false positive, add // url-hostname-check-ok with a reason on the same line.',
  );
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
