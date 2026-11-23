#!/usr/bin/env node
/**
 * Semgrep gate (pre-commit / release / CI).
 *
 * Full scan (release / CI / manual):
 *   pnpm run check:semgrep
 *     -> semgrep scan --config p/typescript --config p/javascript --config p/nodejs --config p/security-audit --config .semgrep.yml --error --disable-version-check --metrics=off
 *
 * Staged scan (pre-commit): pass staged file paths as arguments:
 *   pnpm run check:semgrep -- <file1> <file2> ...
 *
 * `p/nodejs` is belt-and-suspenders beyond `auto` (currently clean on this tree).
 * Custom Electron/crypto rules live in `.semgrep.yml`.
 *
 * `auto` was dropped because it resolves to the Semgrep Registry's Pro rule
 * set, which the community engine (no Pro engine available locally) cannot run:
 * it loads ~2000 rules that can never produce a finding and slows every scan by
 * minutes. The community packs above are bounded and loadable locally.
 *
 * ## When a finding looks wrong (false-positive remediation)
 *
 * Research the rule and call path before dismissing. Prefer a real fix; if the
 * finding is wrong for this codebase, update `.semgrep.yml` and/or add a narrow
 * `nosemgrep` with a reason.
 *
 * ## Semgrep fixes vs ESLint
 *
 * After Semgrep-driven edits, run ESLint on the touched paths — do not replace eslint
 * suppressions with nosemgrep alone (stack both for non-literal RegExp).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SEMGREP_YML = path.join(ROOT, '.semgrep.yml');

function resolveSemgrepBin() {
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['semgrep'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const line = (which.stdout || '').toString().trim().split(/\r?\n/)[0];
  return line || null;
}

function printInstallHint() {
  console.error('check-semgrep: `semgrep` not found on PATH.');
  console.error('  Install (pick one):');
  console.error('    macOS:  brew install semgrep');
  console.error('    pip:    pipx install semgrep   # or: pip install semgrep   ');
  console.error('  Then re-run: pnpm run check:semgrep');
  console.error('  (pnpm run check:environment also reports Semgrep readiness.)');
}

function main() {
  if (!fs.existsSync(SEMGREP_YML)) {
    console.error(`check-semgrep: missing ${path.relative(ROOT, SEMGREP_YML)}`);
    process.exit(1);
  }

  const bin = resolveSemgrepBin();
  if (!bin) {
    printInstallHint();
    process.exit(1);
  }

  const args = [
    'scan',
    '--config',
    'p/typescript',
    '--config',
    'p/javascript',
    '--config',
    'p/nodejs',
    '--config',
    'p/security-audit',
    '--config',
    '.semgrep.yml',
    '--error',
    '--disable-version-check',
    '--metrics=off',
  ];

  // Positional targets: everything after the option-separator `--`.
  const idx = process.argv.indexOf('--');
  let targets = null;
  if (idx !== -1) {
    targets = process.argv.slice(idx + 1).filter((arg) => !arg.startsWith('-'));
  }

  if (targets && targets.length > 0) {
    // Staged scan: pass the paths as explicit targets so semgrep only scans them.
    const result = spawnSync(bin, [...args, '--', ...targets], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'inherit',
    });

    if (result.error) {
      console.error('check-semgrep: failed to spawn semgrep:', result.error.message);
      process.exit(1);
    }

    const statusCode = result.status ?? 1;
    if (statusCode !== 0) {
      console.error('');
      console.error(
        'check-semgrep: findings or scan failure. Prefer a real fix; if you believe a finding is wrong, research the rule first, then update .semgrep.yml and/or add a narrow nosemgrep with a reason. See scripts/check-semgrep.mjs header.',
      );
      process.exit(statusCode);
    }
    process.exit(0);
  } else {
    // Full repository scan (no targets) — used by CI policy-scanners and release.sh.
    const result = spawnSync(bin, args, { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' });

    if (result.error) {
      console.error('check-semgrep: failed to spawn semgrep:', result.error.message);
      process.exit(1);
    }

    process.exit(result.status ?? 1);
  }
}

main();
