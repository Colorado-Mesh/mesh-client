#!/usr/bin/env node
/**
 * Install yamllint for local check:environment / pre-commit YAML lint.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const REQUIREMENTS = join(repoRoot, 'scripts', 'requirements-yamllint.txt');
const HASH_ARGS = ['--require-hashes', '--only-binary=:all:', '-r', REQUIREMENTS];

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ inherit?: boolean }} [opts]
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function runCapture(command, args, opts = {}) {
  const res = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: opts.inherit ? 'inherit' : 'pipe',
  });
  return {
    status: res.status ?? 1,
    stdout: (res.stdout || '').toString(),
    stderr: (res.stderr || '').toString(),
  };
}

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {string | null}
 */
function commandOutput(command, args) {
  const res = runCapture(command, args);
  if (res.status !== 0) return null;
  return (res.stdout || res.stderr || '').trim();
}

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {boolean}
 */
function commandOk(command, args) {
  return runCapture(command, args).status === 0;
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
  const res = runCapture(python, [
    ...prefixArgs,
    '-c',
    'import sys; raise SystemExit(0 if sys.prefix != getattr(sys, "base_prefix", sys.prefix) else 1)',
  ]);
  return res.status === 0;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function looksExternallyManaged(text) {
  return /externally-managed-environment|PEP 668/i.test(text);
}

/**
 * @param {string} venvDir
 * @returns {{ pip: string, yamllint: string, binDir: string }}
 */
function venvPaths(venvDir) {
  if (process.platform === 'win32') {
    return {
      pip: join(venvDir, 'Scripts', 'pip.exe'),
      yamllint: join(venvDir, 'Scripts', 'yamllint.exe'),
      binDir: join(venvDir, 'Scripts'),
    };
  }
  return {
    pip: join(venvDir, 'bin', 'pip'),
    yamllint: join(venvDir, 'bin', 'yamllint'),
    binDir: join(venvDir, 'bin'),
  };
}

/**
 * Best-effort: put venv yamllint on PATH via ~/.local/bin (same place --user uses).
 * @param {string} yamllintBin
 */
function linkYamllintIntoLocalBin(yamllintBin) {
  if (!existsSync(yamllintBin)) return;
  const localBin = join(homedir(), '.local', 'bin');
  try {
    mkdirSync(localBin, { recursive: true });
  } catch {
    return;
  }
  const linkName = process.platform === 'win32' ? 'yamllint.exe' : 'yamllint';
  const dest = join(localBin, linkName);
  try {
    if (existsSync(dest)) unlinkSync(dest);
  } catch {
    // catch-no-log-ok replace existing link/file best-effort
  }
  try {
    symlinkSync(yamllintBin, dest);
    console.log(`setup-yamllint: linked ${dest} → ${yamllintBin}`);
  } catch {
    console.error(
      `setup-yamllint: could not link into ${localBin}. Add to PATH: ${dirname(yamllintBin)}`,
    );
  }
}

/** Prepend a directory to this process PATH so the post-install version check can see it. */
function prependPath(dir) {
  const delim = process.platform === 'win32' ? ';' : ':';
  process.env.PATH = `${dir}${delim}${process.env.PATH || ''}`;
}

/**
 * @returns {[string, string[]] | null}
 */
function resolvePythonInvoker() {
  if (commandOk('python3', ['-m', 'pip', '--version'])) return ['python3', []];
  if (commandOk('py', ['-3', '-m', 'pip', '--version'])) return ['py', ['-3']];
  return null;
}

/** @returns {number} */
function installYamllintViaPip() {
  const invoker = resolvePythonInvoker();
  if (!invoker) {
    const res = spawnSync('pip', ['install', '--user', ...HASH_ARGS], { stdio: 'inherit' });
    return res.status ?? 1;
  }

  const [python, prefix] = invoker;
  if (pythonRunsInVirtualEnv(python, prefix)) {
    const res = spawnSync(python, [...prefix, '-m', 'pip', 'install', ...HASH_ARGS], {
      stdio: 'inherit',
    });
    return res.status ?? 1;
  }

  const userAttempt = runCapture(
    python,
    [...prefix, '-m', 'pip', 'install', '--user', ...HASH_ARGS],
    { inherit: false },
  );
  if (userAttempt.status === 0) {
    console.log('setup-yamllint: installed yamllint with pip --user');
    return 0;
  }
  const combined = `${userAttempt.stdout}\n${userAttempt.stderr}`;
  process.stderr.write(userAttempt.stderr || userAttempt.stdout);
  if (!looksExternallyManaged(combined)) {
    return userAttempt.status;
  }

  const venvDir = join(homedir(), '.cache', 'mesh-client', 'yamllint-venv');
  console.log(
    `setup-yamllint: system Python is externally managed — using isolated venv at ${venvDir}`,
  );
  mkdirSync(dirname(venvDir), { recursive: true });
  const venvCreate = spawnSync(python, [...prefix, '-m', 'venv', venvDir], { stdio: 'inherit' });
  if ((venvCreate.status ?? 1) !== 0) return venvCreate.status ?? 1;
  const { pip, yamllint, binDir } = venvPaths(venvDir);
  const install = spawnSync(pip, ['install', ...HASH_ARGS], { stdio: 'inherit' });
  if ((install.status ?? 1) !== 0) return install.status ?? 1;
  linkYamllintIntoLocalBin(yamllint);
  prependPath(binDir);
  prependPath(join(homedir(), '.local', 'bin'));
  if (!commandOutput('yamllint', ['--version'])) {
    console.error(`setup-yamllint: add to PATH then re-run: ${binDir}`);
  }
  return 0;
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
