#!/usr/bin/env node
/**
 * Install Semgrep for local check:semgrep / check:environment.
 * Semgrep App login / SEMGREP_APP_TOKEN are not required.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * @param {{ platform?: string, versionOutput?: string | null, hasBrew?: boolean, hasPipx?: boolean, hasPip?: boolean }} [input]
 * @returns {{ alreadyInstalled: boolean, detail?: string, strategy: 'brew' | 'pipx' | 'pip' | 'none', note: string }}
 */
export function planSemgrepInstall(input = {}) {
  const platform = input.platform ?? process.platform;
  const versionOutput =
    input.versionOutput !== undefined
      ? input.versionOutput
      : commandOutput('semgrep', ['--version']);
  const note = 'Semgrep App login / SEMGREP_APP_TOKEN are not required for pnpm run check:semgrep.';

  if (versionOutput) {
    return {
      alreadyInstalled: true,
      detail: versionOutput.split('\n')[0],
      strategy: 'none',
      note,
    };
  }

  const hasBrew =
    input.hasBrew !== undefined
      ? input.hasBrew
      : platform === 'darwin' && commandOk('brew', ['--version']);
  if (hasBrew) {
    return { alreadyInstalled: false, strategy: 'brew', note };
  }

  const hasPipx = input.hasPipx !== undefined ? input.hasPipx : commandOk('pipx', ['--version']);
  if (hasPipx) {
    return { alreadyInstalled: false, strategy: 'pipx', note };
  }

  const hasPip =
    input.hasPip !== undefined
      ? input.hasPip
      : commandOk('python3', ['-m', 'pip', '--version']) ||
        commandOk('pip', ['--version']) ||
        commandOk('py', ['-3', '-m', 'pip', '--version']);
  if (hasPip) {
    return { alreadyInstalled: false, strategy: 'pip', note };
  }

  return { alreadyInstalled: false, strategy: 'none', note };
}

/**
 * @param {'brew' | 'pipx' | 'pip' | 'none'} strategy
 * @returns {number}
 */
function runInstall(strategy) {
  if (strategy === 'brew') {
    const res = spawnSync('brew', ['install', 'semgrep'], { stdio: 'inherit' });
    return res.status ?? 1;
  }
  if (strategy === 'pipx') {
    const res = spawnSync('pipx', ['install', 'semgrep'], { stdio: 'inherit' });
    return res.status ?? 1;
  }
  if (strategy === 'pip') {
    /** @type {[string, string[]]} */
    const py = commandOk('python3', ['-m', 'pip', '--version'])
      ? ['python3', ['-m', 'pip', 'install', '--user', 'semgrep']]
      : commandOk('py', ['-3', '-m', 'pip', '--version'])
        ? ['py', ['-3', '-m', 'pip', 'install', '--user', 'semgrep']]
        : ['pip', ['install', '--user', 'semgrep']];
    const res = spawnSync(py[0], py[1], { stdio: 'inherit' });
    return res.status ?? 1;
  }
  return 1;
}

function main() {
  const plan = planSemgrepInstall();
  console.log(plan.note);

  if (plan.alreadyInstalled) {
    console.log(`semgrep already installed: ${plan.detail}`);
    process.exit(0);
  }

  if (plan.strategy === 'none') {
    console.error('setup-semgrep: no brew/pipx/pip installer available.');
    console.error('  Install manually:');
    console.error('    macOS:  brew install semgrep');
    console.error('    pipx:   pipx install semgrep');
    console.error('    pip:    pip install --user semgrep');
    console.error('  Then re-run: pnpm run setup:semgrep');
    process.exit(1);
  }

  console.log(`Installing semgrep via ${plan.strategy}...`);
  const code = runInstall(plan.strategy);
  if (code !== 0) {
    console.error(`setup-semgrep: ${plan.strategy} install failed (exit ${code}).`);
    process.exit(code);
  }

  const after = commandOutput('semgrep', ['--version']);
  if (!after) {
    console.error(
      'setup-semgrep: install finished but `semgrep` is not on PATH. Open a new shell or add the install location to PATH, then re-run.',
    );
    process.exit(1);
  }
  console.log(`semgrep ready: ${after.split('\n')[0]}`);
  process.exit(0);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
