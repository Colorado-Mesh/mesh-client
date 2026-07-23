#!/usr/bin/env node
/**
 * Run GitHub Actions workflows locally via nektos/act + a Docker-compatible
 * container engine (Podman preferred), or run equivalent checks natively on the
 * host (no container engine). Linux runner jobs only for act mode.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

/** @typedef {'docker' | 'native'} ActMode */
/** @typedef {{ event?: string, workflow: string, job?: string, matrix?: string[], containerOptions?: string, extraArgs?: string[] }} ActInvocation */
/** @typedef {{ name: string, command: string, args?: string[], shell?: boolean, optionalTool?: string, skip?: () => boolean }} NativeStep */

export const ACT_MODE_ENV = 'MESH_CLIENT_ACT_MODE';

function commandOk(command, args) {
  const res = spawnSync(command, args, { stdio: 'ignore' });
  return res.status === 0;
}

/**
 * Prefer a ready Podman daemon for act container CI; fall back to Docker when
 * Podman is missing or its machine/daemon is not ready (`podman info` fails).
 * @param {{ commandOk?: (command: string, args: string[]) => boolean }} [options]
 * @returns {'podman' | 'docker'}
 */
export function resolveContainerEngine(options = {}) {
  const ok = options.commandOk ?? commandOk;
  if (ok('podman', ['info'])) return 'podman';
  if (ok('docker', ['info'])) return 'docker';
  // Neither daemon ready: keep Podman for preflight messaging when its CLI exists.
  return ok('podman', ['--version']) ? 'podman' : 'docker';
}

/**
 * Prefer Podman for act container CI; fall back to Docker only if Podman is unavailable.
 */
export const CONTAINER_ENGINE = resolveContainerEngine();
export const ACT_PLATFORM_IMAGE = 'ghcr.io/catthehacker/ubuntu:full-latest';
export const FLATPAK_CONTAINER_IMAGE =
  'ghcr.io/flathub-infra/flatpak-github-actions:freedesktop-24.08';

export const ACT_PULL_IMAGES = [ACT_PLATFORM_IMAGE, FLATPAK_CONTAINER_IMAGE];

/** @type {Record<string, ActInvocation | ActInvocation[]>} */
export const ACT_TARGETS = {
  ci: {
    event: 'workflow_dispatch',
    workflow: '.github/workflows/ci.yaml',
    job: 'build',
  },
  tests: {
    event: 'workflow_dispatch',
    workflow: '.github/workflows/tests.yaml',
    job: 'tests',
  },
  'build-linux': {
    event: 'workflow_dispatch',
    workflow: '.github/workflows/build.yaml',
    job: 'build',
  },
  'reticulum-sidecar': [
    {
      event: 'workflow_dispatch',
      workflow: '.github/workflows/reticulum-sidecar.yaml',
      job: 'build',
    },
    {
      event: 'workflow_dispatch',
      workflow: '.github/workflows/reticulum-sidecar.yaml',
      job: 'build-rns-stack',
    },
  ],
  flatpak: [
    {
      event: 'workflow_dispatch',
      workflow: '.github/workflows/flatpak.yaml',
      job: 'reticulum-sidecar',
    },
    {
      event: 'workflow_dispatch',
      workflow: '.github/workflows/flatpak.yaml',
      job: 'flatpak',
      containerOptions: '--privileged',
    },
  ],
  list: {
    event: 'workflow_dispatch',
    workflow: '.github/workflows/ci.yaml',
  },
};

/** @type {Record<string, NativeStep[]>} */
export const NATIVE_TARGETS = {
  ci: [
    { name: 'Lint', command: 'pnpm', args: ['run', 'lint'] },
    {
      name: 'YAML Lint',
      command: 'yamllint',
      args: ['-f', 'github', '-s', '.'],
      optionalTool: 'yamllint',
    },
    { name: 'Typecheck', command: 'pnpm', args: ['run', 'typecheck'] },
    { name: 'Build', command: 'pnpm', args: ['run', 'build'] },
    { name: 'Check Flatpak', command: 'pnpm', args: ['run', 'check:flatpak'] },
    {
      name: 'Check Flatpak offline pnpm',
      command: 'pnpm',
      args: ['run', 'check:flatpak-offline-pnpm'],
    },
    {
      name: 'Validate desktop file',
      command: 'desktop-file-validate',
      args: ['flatpak/org.coloradomesh.MeshClient.desktop'],
      optionalTool: 'desktop-file-validate',
    },
    {
      name: 'Validate metainfo',
      command: 'appstreamcli',
      args: ['validate', '--no-net', 'flatpak/org.coloradomesh.MeshClient.metainfo.xml'],
      optionalTool: 'appstreamcli',
    },
  ],
  tests: [{ name: 'Coverage', command: 'pnpm', args: ['run', 'test:coverage'] }],
  'build-linux': [{ name: 'Linux dist', command: 'pnpm', args: ['run', 'dist:linux'] }],
  'reticulum-sidecar': [
    {
      name: 'Reticulum sidecar tests (stub)',
      command: 'cargo',
      args: ['test'],
      shell: true,
      optionalTool: 'cargo',
    },
    {
      name: 'Reticulum sidecar build (stub)',
      command: 'cargo',
      args: ['build', '--release'],
      shell: true,
      optionalTool: 'cargo',
    },
  ],
};

/**
 * @param {string | undefined} envValue
 * @returns {ActMode}
 */
export function parseActMode(envValue) {
  return envValue === 'native' ? 'native' : 'docker';
}

/**
 * @param {string[]} argv
 * @param {string | undefined} envValue
 * @returns {{ target?: string, mode: ActMode, passthrough: string[] }}
 */
export function parseArgv(argv, envValue = process.env[ACT_MODE_ENV]) {
  let mode = parseActMode(envValue);
  const filtered = [];

  for (const arg of argv) {
    if (arg === '--native') {
      mode = 'native';
      continue;
    }
    if (arg === '--docker') {
      mode = 'docker';
      continue;
    }
    filtered.push(arg);
  }

  const dashIndex = filtered.indexOf('--');
  const target = filtered[0];
  const passthrough = dashIndex >= 0 ? filtered.slice(dashIndex + 1) : filtered.slice(1);

  return { target, mode, passthrough };
}

/**
 * Resolve container-engine socket path for act.
 * Preferred engine: Podman Desktop, typically at /var/run/docker.sock.
 * Fallback engine: Docker Desktop, often at ~/.docker/run/docker.sock.
 * @param {{ homeDir?: string, platform?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {string | undefined}
 */
export function resolveDockerSocket(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? homedir();

  if (env.ACT_DOCKER_SOCKET) {
    return env.ACT_DOCKER_SOCKET;
  }

  if (env.DOCKER_HOST?.startsWith('unix://')) {
    return env.DOCKER_HOST.slice('unix://'.length);
  }

  if (platform === 'win32') {
    return '//./pipe/docker_engine';
  }

  const candidates = [
    '/var/run/docker.sock',
    join(homeDir, '.docker/run/docker.sock'),
    join(homeDir, '.docker/desktop/docker.sock'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * @param {{ hostArch?: string, dockerSocket?: string | null, passthrough?: string[] }} [options]
 * @returns {string | undefined}
 */
export function resolveContainerArch(options = {}) {
  const hostArch = options.hostArch ?? process.arch;
  return hostArch === 'arm64' ? 'linux/amd64' : undefined;
}

/**
 * @param {{ hostArch?: string, dockerSocket?: string | null, passthrough?: string[] }} [options]
 * @returns {string[]}
 */
export function buildActBaseArgs(options = {}) {
  const args = ['-P', `ubuntu-latest=${ACT_PLATFORM_IMAGE}`];
  const containerArch = resolveContainerArch(options);
  if (containerArch) {
    args.push('--container-architecture', containerArch);
  }

  const dockerSocket =
    options.dockerSocket === null ? undefined : (options.dockerSocket ?? resolveDockerSocket());
  if (dockerSocket) {
    args.push('--container-daemon-socket', dockerSocket);
  }

  if (options.passthrough?.length) {
    args.push(...options.passthrough);
  }
  return args;
}

/**
 * @param {ActInvocation} invocation
 * @param {{ hostArch?: string, dockerSocket?: string | null, passthrough?: string[] }} [options]
 * @returns {string[]}
 */
export function buildActArgs(invocation, options = {}) {
  const args = buildActBaseArgs(options);
  args.push('-W', invocation.workflow);
  if (invocation.job) {
    args.push('-j', invocation.job);
  }
  if (invocation.matrix?.length) {
    for (const entry of invocation.matrix) {
      args.push('--matrix', entry);
    }
  }
  if (invocation.containerOptions) {
    args.push('--container-options', invocation.containerOptions);
  }
  if (invocation.extraArgs?.length) {
    args.push(...invocation.extraArgs);
  }
  args.push(invocation.event ?? 'workflow_dispatch');
  return args;
}

function toolAvailable(tool) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  return commandOk(checker, [tool]);
}

function commandOutput(command, args) {
  const res = spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe' });
  if (res.status !== 0) return null;
  return (res.stdout || res.stderr || '').trim();
}

function printInstallHints() {
  console.error(
    'Install act + a Docker-compatible container engine to run GitHub Actions in containers:',
  );
  console.error('  macOS:   brew install act && Podman Desktop');
  console.error('  Linux:   https://github.com/nektos/act/releases + Podman or Docker engine');
  console.error('  Windows: choco install act-cli && Podman Desktop');
  console.error('');
  console.error('Or run on the host without a container engine: pnpm run act:ci:native');
  console.error('Then (container mode): pnpm run act:pull-images');
  console.error('Docs: docs/ci-cd.md');
}

function preflightActAndContainerEngine() {
  const containerVersion = commandOutput(CONTAINER_ENGINE, ['--version']);
  if (!containerVersion) {
    console.error(
      '❌ No container engine found (need a Docker-compatible engine, e.g. Podman Desktop or Docker Desktop).',
    );
    printInstallHints();
    process.exit(1);
  }

  if (!commandOk(CONTAINER_ENGINE, ['info'])) {
    console.error(`❌ Container engine is not running (${containerVersion.split('\n')[0]}).`);
    console.error(
      `   Start Podman Desktop (preferred) / Docker Desktop, or use native mode: pnpm run act:ci:native`,
    );
    process.exit(1);
  }

  const actVersion = commandOutput('act', ['--version']);
  if (!actVersion) {
    console.error('❌ act not found or not on PATH.');
    printInstallHints();
    process.exit(1);
  }

  const dockerSocket = resolveDockerSocket();
  if (dockerSocket) {
    console.log(`Using Docker socket for act: ${dockerSocket}`);
  } else {
    console.warn('⚠️  Could not detect Docker socket; act will use its default.');
    console.warn('   Set ACT_DOCKER_SOCKET if act cannot reach the container engine.');
  }

  return { containerVersion, actVersion, dockerSocket };
}

/**
 * @param {string[]} dockerArgs
 * @returns {number}
 */
function runContainerEngine(containerArgs) {
  console.log(`$ ${CONTAINER_ENGINE} ${containerArgs.join(' ')}`);
  const res = spawnSync(CONTAINER_ENGINE, containerArgs, { cwd: repoRoot, stdio: 'inherit' });
  return res.status ?? 1;
}

/**
 * @param {string[]} actArgs
 * @returns {number}
 */
function runAct(actArgs) {
  console.log(`$ act ${actArgs.join(' ')}`);
  const res = spawnSync('act', actArgs, { cwd: repoRoot, stdio: 'inherit' });
  return res.status ?? 1;
}

/**
 * @param {NativeStep} step
 * @param {{ cwd?: string }} [options]
 * @returns {number}
 */
export function runNativeStep(step, options = {}) {
  if (step.skip?.()) {
    console.log(`↷ Skipping ${step.name}`);
    return 0;
  }

  if (step.optionalTool && !toolAvailable(step.optionalTool)) {
    console.warn(
      `⚠️  Skipping ${step.name}: ${step.optionalTool} not found (optional on native CI)`,
    );
    return 0;
  }

  const cwd =
    options.cwd ?? (step.command === 'cargo' ? join(repoRoot, 'reticulum-sidecar') : repoRoot);
  const args = step.args ?? [];
  console.log(`$ ${step.command} ${args.join(' ')}`.trim());

  const res = spawnSync(step.command, args, {
    cwd,
    stdio: 'inherit',
    shell: step.shell,
  });
  return res.status ?? 1;
}

/**
 * @param {string} target
 * @returns {number}
 */
export function runNativeTarget(target) {
  if (target === 'pull-images') {
    console.error('pull-images requires Docker mode. Use: pnpm run act:pull-images');
    return 1;
  }

  if (target === 'flatpak') {
    console.error('Flatpak workflow is not available in native mode.');
    console.error('Use Docker mode: pnpm run act:flatpak');
    console.error('Or build Flatpak locally per docs/development-environment.md');
    return 1;
  }

  if (target === 'list') {
    console.log('Native targets:', Object.keys(NATIVE_TARGETS).join(', '));
    console.log('Docker (act) targets:', Object.keys(ACT_TARGETS).join(', '), '+ pull-images, pr');
    console.log('');
    console.log('Modes: default docker (act) | --native | MESH_CLIENT_ACT_MODE=native');
    return 0;
  }

  const steps = NATIVE_TARGETS[target];
  if (!steps) {
    console.error(`Unknown native target: ${target}`);
    return 1;
  }

  console.log(`Running native CI steps for "${target}" (host, no container engine)…`);
  for (const step of steps) {
    const code = runNativeStep(step);
    if (code !== 0) {
      return code;
    }
  }
  return 0;
}

function pullImages() {
  preflightActAndContainerEngine();
  for (const image of ACT_PULL_IMAGES) {
    const code = runContainerEngine(['pull', image]);
    if (code !== 0) {
      process.exit(code);
    }
  }
}

/**
 * @param {ActInvocation} invocation
 * @param {{ passthrough?: string[], dockerSocket?: string | null }} [options]
 * @returns {number}
 */
function runInvocation(invocation, options = {}) {
  const actArgs = buildActArgs(invocation, options);
  return runAct(actArgs);
}

/**
 * @param {string} target
 * @param {{ mode?: ActMode, passthrough?: string[], dockerSocket?: string | null }} [options]
 * @returns {number}
 */
export function runActTarget(target, options = {}) {
  const mode = options.mode ?? 'docker';

  if (mode === 'native') {
    if (target === 'pr') {
      const ciCode = runNativeTarget('ci');
      if (ciCode !== 0) return ciCode;
      return runNativeTarget('tests');
    }
    return runNativeTarget(target);
  }

  if (target === 'pull-images') {
    pullImages();
    return 0;
  }

  const { dockerSocket } = preflightActAndContainerEngine();

  const config = ACT_TARGETS[target];
  if (!config) {
    console.error(`Unknown act target: ${target}`);
    console.error(`Available: ${Object.keys(ACT_TARGETS).join(', ')}, pull-images, pr`);
    console.error('Native mode: append --native or use pnpm run act:<target>:native');
    return 1;
  }

  if (target === 'list') {
    const listArgs = [
      ...buildActBaseArgs({ ...options, dockerSocket }),
      '-l',
      '-W',
      config.workflow,
    ];
    return runAct(listArgs);
  }

  console.log(`Running act workflow "${target}" in Docker containers…`);
  const invocations = Array.isArray(config) ? config : [config];
  for (const invocation of invocations) {
    const code = runInvocation(invocation, { ...options, dockerSocket });
    if (code !== 0) {
      return code;
    }
  }
  return 0;
}

function printUsage() {
  console.log(`Usage: node scripts/run-act.mjs <target> [--native|--docker] [-- extra act args]

Modes (default: docker / act in containers):
  --docker           Run workflow jobs via act + containers (any Docker-compatible engine, e.g. Podman Desktop or Docker Desktop)
  --native           Run equivalent pnpm/cargo commands on the host (no container engine)
  MESH_CLIENT_ACT_MODE=native|docker

Targets:
  ci                 CI workflow (lint, typecheck, build, flatpak checks)
  tests              Tests workflow (coverage)
  build-linux        build.yaml ubuntu-latest leg (dist:linux)
  reticulum-sidecar  Reticulum sidecar Linux jobs
  flatpak            Flatpak x86_64 path (docker mode only)
  pull-images        docker pull act platform + Flatpak images (docker mode)
  list               List docker or native targets
  pr                 Run ci then tests

Examples:
  pnpm run act:ci
  pnpm run act:ci:native
  node scripts/run-act.mjs tests --native
  node scripts/run-act.mjs ci -- -n
`);
}

function main() {
  const { target, mode, passthrough } = parseArgv(process.argv.slice(2));

  if (!target || target === '--help' || target === '-h') {
    printUsage();
    process.exit(target ? 0 : 1);
  }

  if (target === 'pr') {
    const ciCode = runActTarget('ci', { mode, passthrough });
    if (ciCode !== 0) {
      process.exit(ciCode);
    }
    process.exit(runActTarget('tests', { mode, passthrough }));
  }

  process.exit(runActTarget(target, { mode, passthrough }));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
