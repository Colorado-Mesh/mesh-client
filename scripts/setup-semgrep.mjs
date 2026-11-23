#!/usr/bin/env node
/**
 * Install Semgrep for local check:semgrep / check:environment.
 * Semgrep App login / SEMGREP_APP_TOKEN are not required.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * @returns {[string, string[]] | null} python executable + prefix args (e.g. py -3)
 */
function resolvePythonInvoker() {
  if (commandOk('python3', ['-m', 'pip', '--version'])) return ['python3', []];
  if (commandOk('py', ['-3', '-m', 'pip', '--version'])) return ['py', ['-3']];
  if (commandOk('pip', ['--version'])) return null;
  return null;
}

/**
 * @param {string} python
 * @param {string[]} prefixArgs
 * @returns {boolean}
 */
export function pythonRunsInVirtualEnv(python, prefixArgs = []) {
  const res = runCapture(python, [
    ...prefixArgs,
    '-c',
    'import sys; raise SystemExit(0 if sys.prefix != getattr(sys, "base_prefix", sys.prefix) else 1)',
  ]);
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
 * @param {string} text
 * @returns {boolean}
 */
function looksExternallyManaged(text) {
  return /externally-managed-environment|PEP 668/i.test(text);
}

/**
 * @param {string} venvDir
 * @returns {{ pip: string, semgrep: string, binDir: string }}
 */
function venvPaths(venvDir) {
  if (process.platform === 'win32') {
    return {
      pip: join(venvDir, 'Scripts', 'pip.exe'),
      semgrep: join(venvDir, 'Scripts', 'semgrep.exe'),
      binDir: join(venvDir, 'Scripts'),
    };
  }
  return {
    pip: join(venvDir, 'bin', 'pip'),
    semgrep: join(venvDir, 'bin', 'semgrep'),
    binDir: join(venvDir, 'bin'),
  };
}

/**
 * Best-effort: put venv semgrep on PATH via ~/.local/bin (same place --user uses).
 * @param {string} semgrepBin
 */
function linkSemgrepIntoLocalBin(semgrepBin) {
  if (!existsSync(semgrepBin)) return;
  const localBin = join(homedir(), '.local', 'bin');
  try {
    mkdirSync(localBin, { recursive: true });
  } catch {
    return;
  }
  const linkName = process.platform === 'win32' ? 'semgrep.exe' : 'semgrep';
  const dest = join(localBin, linkName);
  try {
    if (existsSync(dest)) unlinkSync(dest);
  } catch {
    // catch-no-log-ok replace existing link/file best-effort
  }
  try {
    symlinkSync(semgrepBin, dest);
    console.log(`setup-semgrep: linked ${dest} → ${semgrepBin}`);
  } catch {
    console.error(
      `setup-semgrep: could not link into ${localBin}. Add to PATH: ${dirname(semgrepBin)}`,
    );
  }
}

/**
 * @returns {number}
 */
function installSemgrepViaPip() {
  const invoker = resolvePythonInvoker();
  if (!invoker) {
    const res = spawnSync('pip', ['install', '--user', 'semgrep'], { stdio: 'inherit' });
    return res.status ?? 1;
  }
  const [python, prefix] = invoker;
  const inVenv = pythonRunsInVirtualEnv(python, prefix);

  if (inVenv) {
    const res = spawnSync(python, [...prefix, '-m', 'pip', 'install', 'semgrep'], {
      stdio: 'inherit',
    });
    return res.status ?? 1;
  }

  const userAttempt = runCapture(python, [...prefix, '-m', 'pip', 'install', '--user', 'semgrep'], {
    inherit: false,
  });
  if (userAttempt.status === 0) {
    // Re-run with inherit so the user sees success noise consistent with other strategies.
    console.log('setup-semgrep: installed semgrep with pip --user');
    return 0;
  }
  const combined = `${userAttempt.stdout}\n${userAttempt.stderr}`;
  process.stderr.write(userAttempt.stderr || userAttempt.stdout);
  if (!looksExternallyManaged(combined)) {
    return userAttempt.status;
  }

  const venvDir = join(homedir(), '.cache', 'mesh-client', 'semgrep-venv');
  console.log(
    `setup-semgrep: system Python is externally managed — using isolated venv at ${venvDir}`,
  );
  mkdirSync(dirname(venvDir), { recursive: true });
  const venvCreate = spawnSync(python, [...prefix, '-m', 'venv', venvDir], { stdio: 'inherit' });
  if ((venvCreate.status ?? 1) !== 0) return venvCreate.status ?? 1;
  const { pip, semgrep, binDir } = venvPaths(venvDir);
  const install = spawnSync(pip, ['install', 'semgrep'], { stdio: 'inherit' });
  if ((install.status ?? 1) !== 0) return install.status ?? 1;
  linkSemgrepIntoLocalBin(semgrep);
  if (!commandOutput('semgrep', ['--version'])) {
    console.error(`setup-semgrep: add to PATH then re-run: ${binDir}`);
  }
  return 0;
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
    return installSemgrepViaPip();
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
