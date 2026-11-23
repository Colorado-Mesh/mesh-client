#!/usr/bin/env node
/**
 * Install yamllint for local check:environment / pre-commit YAML lint.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const REQUIREMENTS = join(repoRoot, 'scripts', 'requirements-yamllint.txt');

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
 * @param {{ platform?: string, versionOutput?: string | null, hasBrew?: boolean, hasApt?: boolean, hasPip?: boolean }} [input]
 * @returns {{ alreadyInstalled: boolean, detail?: string, strategy: 'brew' | 'apt' | 'pip' | 'none' }}
 */
export function planYamllintInstall(input = {}) {
  const platform = input.platform ?? process.platform;
  const versionOutput =
    input.versionOutput !== undefined
      ? input.versionOutput
      : commandOutput('yamllint', ['--version']);

  if (versionOutput) {
    return {
      alreadyInstalled: true,
      detail: versionOutput.split('\n')[0],
      strategy: 'none',
    };
  }

  const hasBrew =
    input.hasBrew !== undefined
      ? input.hasBrew
      : platform === 'darwin' && commandOk('brew', ['--version']);
  if (hasBrew) {
    return { alreadyInstalled: false, strategy: 'brew' };
  }

  const hasApt =
    input.hasApt !== undefined
      ? input.hasApt
      : platform === 'linux' && commandOk('apt-get', ['--version']);
  if (hasApt) {
    return { alreadyInstalled: false, strategy: 'apt' };
  }

  const hasPip =
    input.hasPip !== undefined
      ? input.hasPip
      : commandOk('python3', ['-m', 'pip', '--version']) ||
        commandOk('pip', ['--version']) ||
        commandOk('py', ['-3', '-m', 'pip', '--version']);
  if (hasPip) {
    return { alreadyInstalled: false, strategy: 'pip' };
  }

  return { alreadyInstalled: false, strategy: 'none' };
}

/**
 * @param {'brew' | 'apt' | 'pip' | 'none'} strategy
 * @returns {number}
 */
function runInstall(strategy) {
  if (strategy === 'brew') {
    const res = spawnSync('brew', ['install', 'yamllint'], { stdio: 'inherit' });
    return res.status ?? 1;
  }
  if (strategy === 'apt') {
    const upd = spawnSync('sudo', ['apt-get', 'update'], { stdio: 'inherit' });
    if ((upd.status ?? 1) !== 0) return upd.status ?? 1;
    const res = spawnSync('sudo', ['apt-get', 'install', '-y', 'yamllint'], {
      stdio: 'inherit',
    });
    return res.status ?? 1;
  }
  if (strategy === 'pip') {
    return installYamllintViaPip();
  }
  return 1;
}

/**
 * @param {string} python
 * @param {string[]} prefixArgs
 * @returns {boolean}
 */
function pythonRunsInVirtualEnv(python, prefixArgs = []) {
  const res = spawnSync(
    python,
    [
      ...prefixArgs,
      '-c',
      'import sys; raise SystemExit(0 if sys.prefix != getattr(sys, "base_prefix", sys.prefix) else 1)',
    ],
    { stdio: 'ignore' },
  );
  return res.status === 0;
}

/** @returns {number} */
function installYamllintViaPip() {
  const hashArgs = ['--require-hashes', '--only-binary=:all:', '-r', REQUIREMENTS];
  /** @type {[string, string[]] | null} */
  const invoker = commandOk('python3', ['-m', 'pip', '--version'])
    ? ['python3', []]
    : commandOk('py', ['-3', '-m', 'pip', '--version'])
      ? ['py', ['-3']]
      : null;

  if (!invoker) {
    const res = spawnSync('pip', ['install', '--user', ...hashArgs], { stdio: 'inherit' });
    return res.status ?? 1;
  }

  const [python, prefix] = invoker;
  const userFlag = pythonRunsInVirtualEnv(python, prefix) ? [] : ['--user'];
  const res = spawnSync(python, [...prefix, '-m', 'pip', 'install', ...userFlag, ...hashArgs], {
    stdio: 'inherit',
  });
  return res.status ?? 1;
}

function main() {
  const plan = planYamllintInstall();

  if (plan.alreadyInstalled) {
    console.log(`yamllint already installed: ${plan.detail}`);
    process.exit(0);
  }

  if (plan.strategy === 'none') {
    console.error('setup-yamllint: no brew/apt/pip installer available.');
    console.error('  Install manually:');
    console.error('    macOS:  brew install yamllint');
    console.error('    Linux:  sudo apt install yamllint');
    console.error(
      '    pip:    pip install --user --require-hashes --only-binary=:all: -r scripts/requirements-yamllint.txt',
    );
    console.error('  Then re-run: pnpm run setup:yamllint');
    process.exit(1);
  }

  console.log(`Installing yamllint via ${plan.strategy}...`);
  const code = runInstall(plan.strategy);
  if (code !== 0) {
    console.error(`setup-yamllint: ${plan.strategy} install failed (exit ${code}).`);
    process.exit(code);
  }

  const after = commandOutput('yamllint', ['--version']);
  if (!after) {
    console.error(
      'setup-yamllint: install finished but `yamllint` is not on PATH. Open a new shell or add ~/.local/bin to PATH, then re-run.',
    );
    process.exit(1);
  }
  console.log(`yamllint ready: ${after.split('\n')[0]}`);
  process.exit(0);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
