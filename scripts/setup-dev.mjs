#!/usr/bin/env node
/**
 * First-run / contributor toolchain setup.
 * Best-effort install for required check:environment tools, then re-check and smoke typecheck.
 *
 * Does not run `pnpm install` — lockfile / engines stay with the caller.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, inherit?: boolean }} [opts]
 * @returns {{ status: number, stdout: string }}
 */
function run(command, args, opts = {}) {
  const res = spawnSync(command, args, {
    cwd: opts.cwd ?? repoRoot,
    encoding: 'utf8',
    stdio: opts.inherit === false ? 'pipe' : 'inherit',
  });
  return {
    status: res.status ?? 1,
    stdout: ((res.stdout || '') + (res.stderr || '')).trim(),
  };
}

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {string | null}
 */
function commandOutput(command, args) {
  const res = spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe' });
  if (res.status !== 0) return null;
  return (res.stdout || res.stderr || '').trim();
}

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {boolean}
 */
function commandOk(command, args) {
  const res = spawnSync(command, args, { stdio: 'ignore' });
  return res.status === 0;
}

/**
 * Decide whether to set core.hooksPath to .githooks.
 *
 * @param {{
 *   gitDirExists: boolean,
 *   currentHooksPath: string | null,
 *   repoHooksPathResolved?: string | null,
 * }} input
 * @returns {{ action: 'skip-no-git' | 'ok' | 'set', target: string }}
 */
export function planHooksPathFix(input) {
  const target = '.githooks';
  if (!input.gitDirExists) {
    return { action: 'skip-no-git', target };
  }
  const current = (input.currentHooksPath || '').trim().replace(/\\/g, '/');
  // Exact relative value from prepare / prior setup:dev.
  if (current === target) {
    return { action: 'ok', target };
  }
  // Absolute path only when it resolves to *this* checkout's hooks dir (not any
  // other repo whose path ends in /.githooks).
  const repoHooks = (input.repoHooksPathResolved || '').trim().replace(/\\/g, '/');
  if (current && repoHooks && resolve(current).replace(/\\/g, '/') === repoHooks) {
    return { action: 'ok', target };
  }
  return { action: 'set', target };
}

/**
 * Rust install / clippy plan (unit-tested).
 *
 * @param {{ cargoPresent: boolean, clippyOk: boolean, hasRustup: boolean }} input
 * @returns {{ action: 'ok' | 'add-clippy' | 'print-rustup', rustupRecipe: string }}
 */
export function planRustSetup(input) {
  const rustupRecipe =
    'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && source "$HOME/.cargo/env"';
  if (!input.cargoPresent) {
    return { action: 'print-rustup', rustupRecipe };
  }
  if (!input.clippyOk) {
    return {
      action: input.hasRustup ? 'add-clippy' : 'print-rustup',
      rustupRecipe,
    };
  }
  return { action: 'ok', rustupRecipe };
}

/**
 * @returns {number} exit code from the child (0 = ok)
 */
function runNodeScript(relPath) {
  const script = join(repoRoot, relPath);
  const res = run(process.execPath, [script], { inherit: true });
  return res.status;
}

/**
 * @returns {0 | 1} 0 = success / skip / already correct; 1 = git config failed
 */
function ensureHooksPath() {
  const gitDirExists = existsSync(join(repoRoot, '.git'));
  const current = commandOutput('git', ['config', '--get', 'core.hooksPath']);
  const plan = planHooksPathFix({
    gitDirExists,
    currentHooksPath: current,
    repoHooksPathResolved: resolve(join(repoRoot, '.githooks')),
  });
  if (plan.action === 'skip-no-git') {
    console.log('setup-dev: no .git directory — skipping hooksPath.');
    return 0;
  }
  if (plan.action === 'ok') {
    console.log(`setup-dev: core.hooksPath already ${plan.target}`);
    return 0;
  }
  const res = run('git', ['config', 'core.hooksPath', plan.target], { inherit: true });
  if (res.status !== 0) {
    console.error('setup-dev: failed to set git config core.hooksPath .githooks');
    return 1;
  }
  console.log('setup-dev: set git config core.hooksPath .githooks');
  return 0;
}

function ensureRust() {
  const cargoPresent = Boolean(commandOutput('cargo', ['--version']));
  const clippyOk = cargoPresent && commandOk('cargo', ['clippy', '--version']);
  const hasRustup = commandOk('rustup', ['--version']);
  const plan = planRustSetup({ cargoPresent, clippyOk, hasRustup });

  if (plan.action === 'ok') {
    console.log('setup-dev: Rust/cargo and clippy look ready.');
    return 0;
  }
  if (plan.action === 'add-clippy') {
    console.log('setup-dev: installing clippy via rustup...');
    const res = run('rustup', ['component', 'add', 'clippy'], { inherit: true });
    if (res.status !== 0) {
      console.error(
        'setup-dev: rustup component add clippy failed. Try: cd reticulum-sidecar && cargo clippy --version',
      );
      return res.status;
    }
    console.log(
      'setup-dev: clippy installed. (First cargo in reticulum-sidecar/ also installs rust-toolchain.toml components.)',
    );
    return 0;
  }

  console.error('setup-dev: Rust/cargo not found. Install with rustup (non-interactive):');
  console.error(`  ${plan.rustupRecipe}`);
  console.error('Then re-run: pnpm run setup:dev');
  return 1;
}

function main() {
  console.log('Mesh Client setup:dev — installing required contributor tooling\n');

  const steps = [
    { name: 'build-deps', run: () => runNodeScript('scripts/setup-build-deps.mjs') },
    { name: 'semgrep', run: () => runNodeScript('scripts/setup-semgrep.mjs') },
    { name: 'yamllint', run: () => runNodeScript('scripts/setup-yamllint.mjs') },
    { name: 'rust', run: () => ensureRust() },
  ];

  /** @type {string[]} */
  const failed = [];
  for (const step of steps) {
    console.log(`── ${step.name} ──`);
    const code = step.run();
    if (code !== 0) {
      failed.push(step.name);
      console.error(`setup-dev: step "${step.name}" exited ${code}\n`);
    } else {
      console.log('');
    }
  }

  console.log('── hooksPath ──');
  if (ensureHooksPath() !== 0) {
    failed.push('hooksPath');
  }
  console.log('');

  const nodeModules = existsSync(join(repoRoot, 'node_modules'));
  if (!nodeModules) {
    console.log(
      'setup-dev: node_modules missing — run `pnpm install` (or `pnpm install --frozen-lockfile`), then re-run `pnpm run setup:dev`.',
    );
  }

  console.log('── check:environment ──');
  const env = run(process.execPath, [join(repoRoot, 'scripts/check-environment.mjs')], {
    inherit: true,
  });
  if (env.status !== 0) {
    console.error(
      '\nsetup-dev: check:environment reported required failures. Fix the hints above, then re-run.',
    );
    process.exit(env.status);
  }

  if (!nodeModules) {
    console.log('\nsetup-dev: skipping typecheck smoke (node_modules missing).');
    if (failed.length > 0) {
      console.error(`setup-dev: completed with step failures: ${failed.join(', ')}`);
      process.exit(1);
    }
    process.exit(0);
  }

  console.log('\n── typecheck smoke ──');
  const tc = run('pnpm', ['run', 'typecheck'], { inherit: true });
  if (tc.status !== 0) {
    console.error('\nsetup-dev: typecheck smoke failed.');
    process.exit(tc.status);
  }

  if (failed.length > 0) {
    console.error(
      `\nsetup-dev: environment check passed, but earlier step(s) failed: ${failed.join(', ')}`,
    );
    process.exit(1);
  }

  console.log('\nsetup-dev: ready. Next: pnpm run dev (optional UI smoke).');
  process.exit(0);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
