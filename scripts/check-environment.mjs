#!/usr/bin/env node
/**
 * Local development environment validator.
 * Run before pnpm install: node scripts/check-environment.mjs
 * After pnpm is available: pnpm run check:environment
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveDockerSocket } from './run-act.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const PLATFORM_LABELS = {
  darwin: 'macOS',
  linux: 'Linux',
  win32: 'Windows',
};

/**
 * @param {string} output
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
export function parseVersion(output) {
  const match = String(output).match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * @param {string} found
 * @param {string} requiredExpr e.g. ">=22.13.0"
 */
export function versionGte(found, requiredExpr) {
  const min = parseVersion(requiredExpr.replace(/^>=\s*/, ''));
  const actual = parseVersion(found);
  if (!min || !actual) return false;
  if (actual.major !== min.major) return actual.major > min.major;
  if (actual.minor !== min.minor) return actual.minor > min.minor;
  return actual.patch >= min.patch;
}

/**
 * @typedef {'pass' | 'fail' | 'warn'} CheckStatus
 * @typedef {'required' | 'optional'} CheckSeverity
 * @typedef {{ status: CheckStatus, severity: CheckSeverity, label: string, detail?: string, hint?: string }} CheckResult
 */

/**
 * @param {CheckResult} check
 * @returns {string[]}
 */
export function formatCheckResult(check) {
  const icon = check.status === 'pass' ? '✅' : check.status === 'fail' ? '❌' : '⚠️';
  const lines = [];
  const detail = check.detail ? ` — ${check.detail}` : '';
  lines.push(`${icon} ${check.label}${detail}`);
  if (check.hint && check.status !== 'pass') {
    lines.push(`   → ${check.hint}`);
  }
  return lines;
}

/**
 * @param {CheckResult[]} checks
 * @returns {0 | 1}
 */
export function resolveExitCode(checks) {
  const requiredFailed = checks.some((c) => c.severity === 'required' && c.status === 'fail');
  return requiredFailed ? 1 : 0;
}

function commandOutput(command, args) {
  const res = spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe' });
  if (res.status !== 0) return null;
  return (res.stdout || res.stderr || '').trim();
}

function commandOk(command, args) {
  const res = spawnSync(command, args, { stdio: 'ignore' });
  return res.status === 0;
}

function readEngines() {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  return {
    node: pkg.engines?.node ?? '>=22.13.0',
    pnpm: pkg.engines?.pnpm ?? '>=11.0.0',
    packageManager: typeof pkg.packageManager === 'string' ? pkg.packageManager : undefined,
  };
}

function checkGit() {
  const out = commandOutput('git', ['--version']);
  if (!out) {
    return {
      status: 'fail',
      severity: 'required',
      label: 'Git',
      detail: 'not found',
      hint: 'Install Git — see docs/development-environment.md for your platform',
    };
  }
  return {
    status: 'pass',
    severity: 'required',
    label: 'Git',
    detail: out.replace(/^git version /i, ''),
  };
}

function checkNode(nodeEngine) {
  const version = process.version;
  if (!versionGte(version, nodeEngine)) {
    return {
      status: 'fail',
      severity: 'required',
      label: `Node.js ${nodeEngine.replace('>=', '')}+ required`,
      detail: `found ${version}`,
      hint: 'Install via nvm: nvm install 22 — or winget install OpenJS.NodeJS on Windows',
    };
  }
  return {
    status: 'pass',
    severity: 'required',
    label: `Node.js ${nodeEngine.replace('>=', '')}+`,
    detail: version,
  };
}

function checkPnpm(pnpmEngine, packageManager) {
  const pinMatch =
    typeof packageManager === 'string' ? packageManager.match(/^pnpm@([^+]+)/) : null;
  const pinVersion = pinMatch?.[1] ?? null;
  const prepareHint = pinVersion
    ? `corepack enable && corepack prepare pnpm@${pinVersion} --activate`
    : 'corepack enable && corepack prepare pnpm@11 --activate';

  const out = commandOutput('pnpm', ['--version']);
  if (!out) {
    return {
      status: 'fail',
      severity: 'required',
      label: `pnpm ${pnpmEngine.replace('>=', '')}+ required`,
      detail: 'not found',
      hint: prepareHint,
    };
  }
  if (!versionGte(out, pnpmEngine)) {
    return {
      status: 'fail',
      severity: 'required',
      label: `pnpm ${pnpmEngine.replace('>=', '')}+ required`,
      detail: `found v${out}`,
      hint: prepareHint,
    };
  }

  const found = parseVersion(out);
  const pin = pinVersion ? parseVersion(pinVersion) : null;
  if (found && pin && found.major !== pin.major) {
    return {
      status: 'fail',
      severity: 'required',
      label: `pnpm ${pin.major}.x required (packageManager)`,
      detail: `found v${out}`,
      hint: prepareHint,
    };
  }

  return {
    status: 'pass',
    severity: 'required',
    label: `pnpm ${pnpmEngine.replace('>=', '')}+`,
    detail: `v${out}`,
  };
}

function checkNodeModules(root = repoRoot) {
  if (existsSync(join(root, 'node_modules'))) {
    return {
      status: 'pass',
      severity: 'required',
      label: 'Dependencies installed',
      detail: 'node_modules present',
    };
  }
  return {
    status: 'fail',
    severity: 'required',
    label: 'Dependencies installed',
    detail: 'node_modules missing',
    hint: 'Run: pnpm install',
  };
}

function checkPlatformBuildDeps() {
  const platform = process.platform;

  if (platform === 'darwin') {
    if (commandOk('xcode-select', ['-p'])) {
      return {
        status: 'pass',
        severity: 'required',
        label: 'macOS build dependencies',
        detail: 'Xcode Command Line Tools configured',
      };
    }
    return {
      status: 'fail',
      severity: 'required',
      label: 'macOS build dependencies missing',
      hint: 'Run: pnpm run setup:build-deps — or xcode-select --install',
    };
  }

  if (platform === 'linux') {
    const hasGpp = commandOk('g++', ['--version']);
    const hasGcc = commandOk('gcc', ['--version']);
    const hasMake = commandOk('make', ['--version']);
    if ((hasGpp || hasGcc) && hasMake) {
      const compiler = hasGpp ? 'g++' : 'gcc';
      return {
        status: 'pass',
        severity: 'required',
        label: 'Linux build dependencies',
        detail: `${compiler} and make found`,
      };
    }
    const missing = [];
    if (!hasGpp && !hasGcc) missing.push('g++/gcc');
    if (!hasMake) missing.push('make');
    return {
      status: 'fail',
      severity: 'required',
      label: 'Linux build dependencies missing',
      detail: `missing ${missing.join(', ')}`,
      hint: 'Run: pnpm run setup:build-deps',
    };
  }

  if (platform === 'win32') {
    if (commandOk('where', ['cl'])) {
      return {
        status: 'pass',
        severity: 'required',
        label: 'Windows build dependencies',
        detail: 'MSVC compiler (cl) found',
      };
    }
    return {
      status: 'fail',
      severity: 'required',
      label: 'Windows build dependencies missing',
      hint: "Install Visual Studio Build Tools with 'Desktop development with C++' workload",
    };
  }

  return {
    status: 'fail',
    severity: 'required',
    label: 'Platform build dependencies',
    detail: `unsupported platform: ${platform}`,
    hint: 'See docs/development-environment.md',
  };
}

function resolvePythonCommand() {
  if (process.platform === 'win32') {
    if (commandOk('py', ['-3', '--version'])) return { cmd: 'py', args: ['-3'] };
    if (commandOk('python', ['--version'])) return { cmd: 'python', args: [] };
    return null;
  }
  if (commandOk('python3', ['--version'])) return { cmd: 'python3', args: [] };
  return null;
}

function checkPython() {
  const py = resolvePythonCommand();
  if (!py) {
    return {
      status: 'warn',
      severity: 'optional',
      label: 'Python 3 not found (optional)',
      hint: 'Needed for MkDocs, yamllint, and node-gyp on Linux — see docs/development-environment.md',
    };
  }
  const out = commandOutput(py.cmd, [...py.args, '--version']);
  return {
    status: 'pass',
    severity: 'optional',
    label: 'Python 3',
    detail: out ?? 'found',
  };
}

function checkPip() {
  const py = resolvePythonCommand();
  if (!py) {
    return {
      status: 'warn',
      severity: 'optional',
      label: 'pip not found (optional)',
      hint: 'Install Python 3 with pip — pip install yamllint for pre-commit',
    };
  }
  const pipArgs = py.cmd === 'py' ? ['-3', '-m', 'pip', '--version'] : ['-m', 'pip', '--version'];
  const out = commandOutput(py.cmd, pipArgs);
  if (!out) {
    return {
      status: 'warn',
      severity: 'optional',
      label: 'pip not found (optional)',
      hint: 'pip install yamllint — or pnpm run docs:install for MkDocs deps',
    };
  }
  return {
    status: 'pass',
    severity: 'optional',
    label: 'pip',
    detail: out.split('\n')[0],
  };
}

function checkRust() {
  const out = commandOutput('cargo', ['--version']);
  if (!out) {
    return {
      status: 'warn',
      severity: 'optional',
      label: 'Rust/cargo not found (optional)',
      hint: 'Needed for Reticulum sidecar — install via https://rustup.rs/; pre-commit skips Rust checks when cargo is missing',
    };
  }
  return {
    status: 'pass',
    severity: 'optional',
    label: 'Rust/cargo',
    detail: out,
  };
}

function checkRustClippy() {
  if (!commandOutput('cargo', ['--version'])) return null;

  if (commandOk('cargo', ['clippy', '--version'])) {
    const out = commandOutput('cargo', ['clippy', '--version']);
    return {
      status: 'pass',
      severity: 'optional',
      label: 'cargo clippy',
      detail: out?.split('\n')[0] ?? 'found',
    };
  }
  return {
    status: 'warn',
    severity: 'optional',
    label: 'cargo clippy not ready (optional)',
    hint: 'cd reticulum-sidecar once — rust-toolchain.toml installs clippy/rustfmt/llvm-tools-preview via rustup',
  };
}

function checkCargoLlvmCov() {
  if (!commandOutput('cargo', ['--version'])) return null;

  const out = commandOutput('cargo', ['llvm-cov', '--version']);
  if (out) {
    return {
      status: 'pass',
      severity: 'optional',
      label: 'cargo llvm-cov',
      detail: out.split('\n')[0],
    };
  }
  return {
    status: 'warn',
    severity: 'optional',
    label: 'cargo llvm-cov not found (optional)',
    hint: 'cargo install cargo-llvm-cov — for pnpm run reticulum:sidecar:coverage (CI enforces threshold in tests.yaml)',
  };
}

function checkActionlint() {
  const binName = process.platform === 'win32' ? 'actionlint.exe' : 'actionlint';
  const localPath = join(repoRoot, '.githooks', 'bin', binName);
  if (existsSync(localPath)) {
    return {
      status: 'pass',
      severity: 'optional',
      label: 'actionlint',
      detail: localPath,
    };
  }
  const out = commandOutput('actionlint', ['--version']);
  if (out) {
    return {
      status: 'pass',
      severity: 'optional',
      label: 'actionlint',
      detail: out.split('\n')[0],
    };
  }
  return {
    status: 'warn',
    severity: 'optional',
    label: 'actionlint not found (optional)',
    hint: 'Run: pnpm run setup:actionlint — needed for pre-commit workflow linting',
  };
}

function checkYamllint() {
  const out = commandOutput('yamllint', ['--version']);
  if (!out) {
    return {
      status: 'warn',
      severity: 'optional',
      label: 'yamllint not found (optional)',
      hint: 'pip install yamllint — or brew install yamllint / sudo apt install yamllint',
    };
  }
  return {
    status: 'pass',
    severity: 'optional',
    label: 'yamllint',
    detail: out.split('\n')[0],
  };
}

function checkDocker() {
  const out = commandOutput('docker', ['--version']);
  if (!out) {
    return {
      status: 'warn',
      severity: 'optional',
      label: 'Docker not found (optional)',
      hint: 'For container CI (act): install Docker Desktop or engine. Or use host CI: pnpm run act:ci:native — see docs/ci-cd.md',
    };
  }

  if (!commandOk('docker', ['info'])) {
    return {
      status: 'warn',
      severity: 'optional',
      label: 'Docker daemon not running (optional)',
      detail: out.split('\n')[0],
      hint: 'Start Docker Desktop for pnpm run act:* (container mode), or use pnpm run act:ci:native on the host',
    };
  }

  const socket = resolveDockerSocket();
  const socketNote = socket
    ? `; act socket ${socket}`
    : '; act socket not detected (set ACT_DOCKER_SOCKET if act fails with Docker Desktop)';

  return {
    status: 'pass',
    severity: 'optional',
    label: 'Docker',
    detail: `${out.split('\n')[0]}${socketNote}`,
  };
}

function checkAct() {
  const out = commandOutput('act', ['--version']);
  if (!out) {
    return {
      status: 'warn',
      severity: 'optional',
      label: 'act not found (optional)',
      hint: 'For container CI: install act + Docker, then pnpm run act:pull-images. Or use host CI: pnpm run act:ci:native',
    };
  }
  return {
    status: 'pass',
    severity: 'optional',
    label: 'act',
    detail: out.split('\n')[0],
  };
}

/**
 * @param {CheckResult[]} checks
 * @returns {string | null}
 */
export function formatLocalActDockerNote(checks) {
  const docker = checks.find((c) => c.label.startsWith('Docker'));
  const actCheck = checks.find((c) => c.label === 'act' || c.label.startsWith('act not found'));

  if (!docker && !actCheck) {
    return null;
  }

  const dockerReady = docker?.status === 'pass';
  const actReady = actCheck?.status === 'pass';

  if (dockerReady && actReady) {
    return 'ℹ️  Container CI: pnpm run act:ci (act + Docker). Host CI (no Docker): pnpm run act:ci:native. See docs/ci-cd.md.';
  }

  if (actReady && !dockerReady) {
    return 'ℹ️  act is installed but Docker is not ready — start Docker Desktop for act:* or use pnpm run act:ci:native on the host.';
  }

  if (dockerReady && !actReady) {
    return 'ℹ️  Docker is ready; install act for container workflows (pnpm run act:ci) or use pnpm run act:ci:native on the host.';
  }

  return 'ℹ️  Local CI: pnpm run act:ci:native (host) or install act + Docker for container workflows. See docs/ci-cd.md.';
}

function checkLinuxDialout() {
  if (process.platform !== 'linux') return null;

  const { username } = userInfo();
  const user = process.env.USER || username;
  if (!user) {
    return {
      status: 'warn',
      severity: 'optional',
      label: 'Linux dialout group (optional)',
      detail: 'could not determine current user',
      hint: 'Run: pnpm run setup:dialout — then log out and back in',
    };
  }

  const res = spawnSync('id', ['-nG', user], { encoding: 'utf8', stdio: 'pipe' });
  const groups = (res.stdout || '').toString();
  const inDialout = groups.split(/\s+/).includes('dialout');

  if (inDialout) {
    return {
      status: 'pass',
      severity: 'optional',
      label: 'Linux dialout group',
      detail: `user ${user} is a member`,
    };
  }
  return {
    status: 'warn',
    severity: 'optional',
    label: 'Linux dialout group (optional)',
    detail: `user ${user} not in dialout`,
    hint: 'Run: pnpm run setup:dialout — then log out and back in for USB serial access',
  };
}

/**
 * @returns {CheckResult[]}
 */
export function runChecks(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const engines = options.engines ?? readEngines();

  const checks = [
    checkGit(),
    checkNode(engines.node),
    checkPnpm(engines.pnpm, engines.packageManager),
    options.skipNodeModules ? null : checkNodeModules(root),
    checkPlatformBuildDeps(),
    checkPython(),
    checkPip(),
    checkRust(),
    checkRustClippy(),
    checkCargoLlvmCov(),
    checkActionlint(),
    checkYamllint(),
    checkDocker(),
    checkAct(),
    checkLinuxDialout(),
  ].filter(Boolean);

  return checks;
}

function printSummary(checks) {
  const requiredFailed = checks.filter((c) => c.severity === 'required' && c.status === 'fail');
  const optionalWarnings = checks.filter((c) => c.severity === 'optional' && c.status === 'warn');

  console.log('━'.repeat(40));
  if (requiredFailed.length === 0) {
    console.log('✅ Required checks passed.');
    if (optionalWarnings.length > 0) {
      console.log(
        `⚠️  ${optionalWarnings.length} optional item(s) above may be worth fixing later.`,
      );
    }
  } else {
    console.log('❌ Required checks failed. Fix items above, then re-run.');
  }

  const actDockerNote = formatLocalActDockerNote(checks);
  if (actDockerNote) {
    console.log('');
    console.log(actDockerNote);
  }
}

function main() {
  const platformLabel = PLATFORM_LABELS[process.platform] ?? process.platform;
  console.log(`Mesh Client environment check (platform: ${platformLabel})\n`);

  const checks = runChecks();

  for (const check of checks) {
    for (const line of formatCheckResult(check)) {
      console.log(line);
    }
    console.log('');
  }

  printSummary(checks);
  process.exit(resolveExitCode(checks));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
