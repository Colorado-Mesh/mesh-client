#!/usr/bin/env node
/**
 * Semgrep gate (pre-commit / release / CI).
 *
 * Runs the same scan agents and humans use locally:
 *   semgrep scan --config auto --config .semgrep.yml --error
 *
 * ## When a finding looks wrong
 *
 * Semgrep (especially `--config auto`) can false-positive on Electron/Node
 * patterns that are already safe. Do **not** dismiss a finding casually:
 *
 * 1. Research the rule (CWE / Semgrep docs) and whether the sink is attacker-
 *    controlled in this call path.
 * 2. Prefer a real fix (path containment via `joinUnderRoot` /
 *    `resolveUnderRoot`, literal console format strings, argv-only spawn,
 *    `authTagLength` on AES-GCM, etc.).
 * 3. Only if you are sure the finding is incorrect for this codebase, update
 *    `.semgrep.yml` (tighten/relax a custom rule, or document an intentional
 *    policy) and/or add a **narrow** `// nosemgrep: <rule-id> -- <reason>` on
 *    the validated sink. Never blanket-ignore a rule for convenience.
 *
 * Catch-block hygiene is owned by `pnpm run check:silent-catches`, not by a
 * naive catch regex in `.semgrep.yml`.
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
  console.error('    pip:    pipx install semgrep   # or: pip install semgrep');
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

  const args = ['scan', '--config', 'auto', '--config', '.semgrep.yml', '--error'];
  console.error(`check-semgrep: ${bin} ${args.join(' ')}`);
  const result = spawnSync(bin, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
  });

  if (result.error) {
    console.error('check-semgrep: failed to spawn semgrep:', result.error.message);
    process.exit(1);
  }

  const code = result.status ?? 1;
  if (code !== 0) {
    console.error('');
    console.error('check-semgrep: findings or scan failure. Prefer a real fix; if you believe a');
    console.error(
      'finding is wrong, research the rule first, then update .semgrep.yml and/or add a',
    );
    console.error('narrow nosemgrep with a reason. See scripts/check-semgrep.mjs header.');
  }
  process.exit(code);
}

main();
