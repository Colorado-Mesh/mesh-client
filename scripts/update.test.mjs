import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const updateScriptPath = fileURLToPath(new URL('./update.sh', import.meta.url));
const updateScript = readFileSync(updateScriptPath, 'utf8');
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** @type {string[]} */
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // catch-no-log-ok best-effort temp cleanup
    }
  }
});

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [cwd]
 * @param {string} [scriptPath]
 */
function runUpdate(args, env = {}, cwd = repoRoot, scriptPath = updateScriptPath) {
  return spawnSync('bash', [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

describe('update.sh Reticulum stack functionality check', () => {
  it('prepares and requires every rs path dependency before the full-feature build', () => {
    const rebuildFunction = updateScript.match(
      /rebuild_reticulum_sidecar\(\) \{([\s\S]*?)^\}/m,
    )?.[1];

    expect(rebuildFunction).toBeDefined();
    expect(rebuildFunction).toContain('bash scripts/clone-ratspeak-stack.sh');
    expect(rebuildFunction).toContain('../../rsReticulum/crates/rns-runtime/Cargo.toml');
    expect(rebuildFunction).toContain('../../rsLXMF/crates/lxmf-core/Cargo.toml');
    expect(rebuildFunction).toContain('../../rsNomad/crates/nomad-core/Cargo.toml');
    expect(rebuildFunction).toContain('cargo build --features rns-stack,rns-ble,rns-rnode-tcp');
    expect(rebuildFunction).not.toMatch(/['"]\.\.\/rs(?:Reticulum|LXMF|Nomad)\//);
    expect(rebuildFunction).not.toContain('cargo build)');
    expect(rebuildFunction).toContain('CLEAN_SIDECAR_TARGET');
    expect(rebuildFunction).toContain('cargo clean');
    // Clean only after a successful build, and only when opted in.
    const buildIdx = rebuildFunction.indexOf(
      'cargo build --features rns-stack,rns-ble,rns-rnode-tcp',
    );
    const cleanIdx = rebuildFunction.indexOf('cargo clean');
    expect(buildIdx).toBeGreaterThanOrEqual(0);
    expect(cleanIdx).toBeGreaterThan(buildIdx);
    expect(rebuildFunction).toMatch(
      /if \[ "\$\{CLEAN_SIDECAR_TARGET\}" = '1' \]; then[\s\S]*cargo clean/,
    );
  });

  it('defaults CLEAN_SIDECAR_TARGET to 0 (parse-only)', () => {
    const result = runUpdate([], { UPDATE_SH_TEST_HOOK: 'parse-only' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('CLEAN_SIDECAR_TARGET=0');
  });

  it('opts in via CLEAN_SIDECAR_TARGET=1 (parse-only)', () => {
    const result = runUpdate([], {
      UPDATE_SH_TEST_HOOK: 'parse-only',
      CLEAN_SIDECAR_TARGET: '1',
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('CLEAN_SIDECAR_TARGET=1');
  });

  it('opts in via --clean-target (parse-only)', () => {
    const result = runUpdate(['--clean-target'], { UPDATE_SH_TEST_HOOK: 'parse-only' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('CLEAN_SIDECAR_TARGET=1');
  });

  it('rejects unknown arguments', () => {
    const result = runUpdate(['--nope']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown argument: --nope');
    expect(result.stderr).toContain('Usage: scripts/update.sh [--clean-target]');
  });

  it('runs cargo clean after a successful rebuild when CLEAN_SIDECAR_TARGET=1', () => {
    const fixture = prepareRebuildFixture({ buildExit: 0 });
    const result = runUpdate(
      [],
      {
        UPDATE_SH_TEST_HOOK: 'rebuild-only',
        CLEAN_SIDECAR_TARGET: '1',
        PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
      },
      fixture.work,
      fixture.scriptPath,
    );
    expect(result.status, result.stderr || result.stdout).toBe(0);
    const log = readFileSync(fixture.cargoLog, 'utf8');
    expect(log).toContain('build --features rns-stack,rns-ble,rns-rnode-tcp');
    expect(log).toContain('clean');
    expect(log.indexOf('build')).toBeLessThan(log.indexOf('clean'));
  });

  it('skips cargo clean by default after a successful rebuild', () => {
    const fixture = prepareRebuildFixture({ buildExit: 0 });
    const result = runUpdate(
      [],
      {
        UPDATE_SH_TEST_HOOK: 'rebuild-only',
        CLEAN_SIDECAR_TARGET: '0',
        PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
      },
      fixture.work,
      fixture.scriptPath,
    );
    expect(result.status, result.stderr || result.stdout).toBe(0);
    const log = readFileSync(fixture.cargoLog, 'utf8');
    expect(log).toContain('build --features rns-stack,rns-ble,rns-rnode-tcp');
    expect(log).not.toContain('clean');
  });

  it('does not run cargo clean when the rebuild fails', () => {
    const fixture = prepareRebuildFixture({ buildExit: 1 });
    const result = runUpdate(
      [],
      {
        UPDATE_SH_TEST_HOOK: 'rebuild-only',
        CLEAN_SIDECAR_TARGET: '1',
        PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
      },
      fixture.work,
      fixture.scriptPath,
    );
    expect(result.status).not.toBe(0);
    const log = readFileSync(fixture.cargoLog, 'utf8');
    expect(log).toContain('build --features rns-stack,rns-ble,rns-rnode-tcp');
    expect(log).not.toContain('clean');
  });
});

/**
 * Temp layout matching Ratspeak siblings: mesh-client/reticulum-sidecar + ../../rs*.
 * @param {{ buildExit: number }} opts
 */
function prepareRebuildFixture(opts) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mesh-update-root-'));
  tempDirs.push(root);
  const work = path.join(root, 'mesh-client');
  const binDir = mkdtempSync(path.join(os.tmpdir(), 'mesh-update-bin-'));
  tempDirs.push(binDir);
  const cargoLog = path.join(binDir, 'cargo.log');

  writeFileSync(
    path.join(binDir, 'cargo'),
    `#!/usr/bin/env bash
echo "$*" >> ${JSON.stringify(cargoLog)}
if [[ "$*" == build* ]]; then
  exit ${opts.buildExit}
fi
exit 0
`,
    { encoding: 'utf8' },
  );
  chmodSync(path.join(binDir, 'cargo'), 0o755);

  mkdirSync(path.join(work, 'scripts'), { recursive: true });
  writeFileSync(
    path.join(work, 'scripts', 'clone-ratspeak-stack.sh'),
    '#!/usr/bin/env bash\nexit 0\n',
  );
  chmodSync(path.join(work, 'scripts', 'clone-ratspeak-stack.sh'), 0o755);
  const scriptPath = path.join(work, 'scripts', 'update.sh');
  writeFileSync(scriptPath, updateScript);
  chmodSync(scriptPath, 0o755);

  mkdirSync(path.join(work, 'reticulum-sidecar'), { recursive: true });
  writeFileSync(
    path.join(work, 'reticulum-sidecar', 'Cargo.toml'),
    '[package]\nname = "mesh-client-reticulum"\n',
  );
  // Path deps are ../../rs* from reticulum-sidecar → siblings of mesh-client.
  for (const rel of [
    'rsReticulum/crates/rns-runtime/Cargo.toml',
    'rsLXMF/crates/lxmf-core/Cargo.toml',
    'rsNomad/crates/nomad-core/Cargo.toml',
  ]) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, '[package]\nname = "stub"\n');
  }

  return { work, binDir, cargoLog, scriptPath };
}
