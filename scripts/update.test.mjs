import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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

describe('update.sh Bluetooth helper rebuild and upstream watchers', () => {
  it('builds the Bluetooth helper and cleans only after a successful opt-in build', () => {
    const rebuildFunction = updateScript.match(/rebuild_ble_sidecar\(\) \{([\s\S]*?)^\}/m)?.[1];

    expect(rebuildFunction).toBeDefined();
    expect(rebuildFunction).toContain('cargo build --features gatt-ble');
    expect(rebuildFunction).not.toContain('clone-ratspeak-stack');
    expect(rebuildFunction).not.toContain('.rsstack');
    const buildIdx = rebuildFunction.indexOf('cargo build --features gatt-ble');
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

  it('prints the vendored upstream catalog (upstream-catalog-only)', () => {
    const result = runUpdate([], { UPDATE_SH_TEST_HOOK: 'upstream-catalog-only' });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).not.toContain('RATSPEAK');
    expect(updateScript).not.toMatch(/ratspeak/i);
    expect(result.stdout).toContain('MECP_UPSTREAM_WATCH_ENTRIES:');
    expect(result.stdout).toContain('MECP_PR_WATCH_ENTRIES:');
    expect(result.stdout).toContain('xiang-dev-1/MECP|5|M16 medical supply drop|');
  });

  it('wires check_mecp_prs after check_mecp_upstream', () => {
    expect(updateScript).toContain('check_mecp_prs()');
    expect(updateScript).toContain('MECP_PR_WATCH_ENTRIES');
    const mecpUpstreamCall = updateScript.lastIndexOf('\ncheck_mecp_upstream\n');
    const mecpPrsCall = updateScript.lastIndexOf('\ncheck_mecp_prs\n');
    expect(mecpUpstreamCall).toBeGreaterThanOrEqual(0);
    expect(mecpPrsCall).toBeGreaterThan(mecpUpstreamCall);
    const mecpPrsFn = updateScript.slice(
      updateScript.indexOf('check_mecp_prs() {'),
      updateScript.indexOf('if [ "${UPDATE_SH_TEST_HOOK:-}" = \'upstream-catalog-only\' ]'),
    );
    expect(mecpPrsFn).toContain('local change present');
    expect(mecpPrsFn).not.toContain('M16');
  });

  /**
   * Fake `gh api repos/.../pulls/N` for check_mecp_prs.
   * @param {'open' | 'merged' | 'closed' | 'unavailable'} mode
   */
  function prepareMecpPrGhFixture(mode) {
    const work = mkdtempSync(path.join(os.tmpdir(), 'mesh-update-mecp-pr-'));
    tempDirs.push(work);
    const binDir = path.join(work, 'bin');
    mkdirSync(binDir, { recursive: true });
    const ghPath = path.join(binDir, 'gh');
    let body;
    if (mode === 'open') {
      body = '{"state":"open","merged":false}';
    } else if (mode === 'merged') {
      body = '{"state":"closed","merged":true,"merged_at":"2026-09-26T00:00:00Z"}';
    } else if (mode === 'closed') {
      body = '{"state":"closed","merged":false}';
    } else {
      // Empty / malformed → github_pr_state prints unknown (unavailable).
      body = '{}';
    }
    writeFileSync(
      ghPath,
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" != "api" ]]; then
  echo "unexpected gh args: $*" >&2
  exit 1
fi
path="\${2:-}"
if [[ "$path" == repos/*/pulls/* ]]; then
  printf '%s' ${JSON.stringify(body)}
  exit 0
fi
echo "unexpected gh api path: $path" >&2
exit 1
`,
      'utf8',
    );
    chmodSync(ghPath, 0o755);
    return { work, binDir };
  }

  it.each([
    {
      mode: /** @type {const} */ ('open'),
      expectedWarning: '0',
      stdoutMatch: /M16 medical supply drop: upstream PR still open/,
    },
    {
      mode: /** @type {const} */ ('merged'),
      expectedWarning: '1',
      stdoutMatch: /xiang-dev-1\/MECP#5 merged — re-vendor languages/,
    },
    {
      mode: /** @type {const} */ ('closed'),
      expectedWarning: '1',
      stdoutMatch: /xiang-dev-1\/MECP#5 closed without merge/,
    },
    {
      mode: /** @type {const} */ ('unavailable'),
      expectedWarning: '0',
      stdoutMatch: /could not query xiang-dev-1\/MECP#5/,
    },
  ])(
    'mecp-prs-only maps $mode to HAS_WARNING=$expectedWarning',
    ({ mode, expectedWarning, stdoutMatch }) => {
      const fixture = prepareMecpPrGhFixture(mode);
      const result = runUpdate([], {
        UPDATE_SH_TEST_HOOK: 'mecp-prs-only',
        PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
      });
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain(`HAS_WARNING=${expectedWarning}`);
      expect(result.stdout).toMatch(stdoutMatch);
      if (expectedWarning === '0' && mode === 'open') {
        expect(result.stdout).toContain('MECP PR watch complete.');
      }
      if (mode === 'merged') {
        expect(result.stdout).toContain('WARNING:');
        expect(result.stdout).toContain('upstream MERGED');
      }
      if (mode === 'closed') {
        expect(result.stdout).toContain('WARNING:');
        expect(result.stdout).toContain('PR closed (not merged?)');
        expect(result.stdout).toContain('local change present');
      }
    },
  );

  it('wires check_pinned_majors into the warn summary', () => {
    expect(updateScript).toContain('check_pinned_majors()');
    expect(updateScript).toContain('node scripts/check-pinned-majors.mjs');
    const pinnedCall = updateScript.lastIndexOf('\ncheck_pinned_majors\n');
    const mecpCall = updateScript.lastIndexOf('\ncheck_mecp_upstream\n');
    expect(pinnedCall).toBeGreaterThanOrEqual(0);
    expect(mecpCall).toBeGreaterThan(pinnedCall);
  });

  it.each([
    { exit: 10, expected: '1', label: 'drift' },
    { exit: 0, expected: '0', label: 'clean' },
    { exit: 1, expected: '0', label: 'inconclusive' },
  ])('maps check-pinned-majors $label exit to HAS_WARNING=$expected', ({ exit, expected }) => {
    const fixture = prepareStubNodeFixture(exit);
    const result = runUpdate([], {
      UPDATE_SH_TEST_HOOK: 'pinned-majors-only',
      PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain(`HAS_WARNING=${expected}`);
  });

  it('skips the pinned-majors check when node is unavailable', () => {
    // PATH with the shell utilities update.sh needs, but deliberately no `node`.
    const binDir = mkdtempSync(path.join(os.tmpdir(), 'mesh-update-nonode-'));
    tempDirs.push(binDir);
    for (const tool of ['bash', 'printf', 'echo']) {
      const resolved = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' })
        .stdout?.trim()
        .split('\n')[0];
      if (resolved && resolved.startsWith('/')) {
        symlinkSync(resolved, path.join(binDir, tool));
      }
    }
    const result = runUpdate([], {
      UPDATE_SH_TEST_HOOK: 'pinned-majors-only',
      PATH: binDir,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('node missing — skip.');
    expect(result.stdout).toContain('HAS_WARNING=0');
  });

  it('wires check_audit_ignores after the pinned-majors check', () => {
    expect(updateScript).toContain('check_audit_ignores()');
    expect(updateScript).toContain('node scripts/check-audit-ignores.mjs');
    const pinnedCall = updateScript.lastIndexOf('\ncheck_pinned_majors\n');
    const auditCall = updateScript.lastIndexOf('\ncheck_audit_ignores\n');
    const mecpCall = updateScript.lastIndexOf('\ncheck_mecp_upstream\n');
    expect(auditCall).toBeGreaterThan(pinnedCall);
    expect(mecpCall).toBeGreaterThan(auditCall);
  });

  it.each([
    { exit: 10, expected: '1', label: 'removable' },
    { exit: 0, expected: '0', label: 'clean' },
    { exit: 1, expected: '0', label: 'inconclusive' },
  ])('maps check-audit-ignores $label exit to HAS_WARNING=$expected', ({ exit, expected }) => {
    const fixture = prepareStubNodeFixture(exit);
    const result = runUpdate([], {
      UPDATE_SH_TEST_HOOK: 'audit-ignores-only',
      PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain(`HAS_WARNING=${expected}`);
  });

  it('syncs Flatpak Electron archives after pnpm prune', () => {
    expect(updateScript).toContain('sync_flatpak_electron()');
    expect(updateScript).toContain('node scripts/sync-flatpak-electron.mjs');
    const pruneIdx = updateScript.lastIndexOf("echo 'Running pnpm prune...'");
    const syncCallIdx = updateScript.lastIndexOf('\nsync_flatpak_electron\n');
    const rustIdx = updateScript.lastIndexOf('\nupdate_rust_toolchain\n');
    expect(pruneIdx).toBeGreaterThanOrEqual(0);
    expect(syncCallIdx).toBeGreaterThan(pruneIdx);
    expect(rustIdx).toBeGreaterThan(syncCallIdx);
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
    expect(log).toContain('build --features gatt-ble');
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
    expect(log).toContain('build --features gatt-ble');
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
    expect(log).toContain('build --features gatt-ble');
    expect(log).not.toContain('clean');
  });
});

/** Stub `node` on PATH that exits with a fixed code, standing in for check-pinned-majors.mjs. */
function prepareStubNodeFixture(exitCode) {
  const binDir = mkdtempSync(path.join(os.tmpdir(), 'mesh-update-node-'));
  tempDirs.push(binDir);
  const nodePath = path.join(binDir, 'node');
  writeFileSync(nodePath, `#!/usr/bin/env bash\nexit ${exitCode}\n`);
  chmodSync(nodePath, 0o755);
  return { binDir };
}

/**
 * Temp layout with a stub ble-sidecar crate and a logging `cargo` on PATH.
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
  const scriptPath = path.join(work, 'scripts', 'update.sh');
  writeFileSync(scriptPath, updateScript);
  chmodSync(scriptPath, 0o755);

  mkdirSync(path.join(work, 'ble-sidecar'), { recursive: true });
  writeFileSync(path.join(work, 'ble-sidecar', 'Cargo.toml'), '[package]\nname = "mesh-hub-ble"\n');
  return { work, binDir, cargoLog, scriptPath };
}
