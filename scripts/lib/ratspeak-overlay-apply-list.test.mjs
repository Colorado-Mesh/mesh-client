import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const listPath = fileURLToPath(new URL('./ratspeak-overlay-apply-list.sh', import.meta.url));
const helperPath = fileURLToPath(new URL('./apply-ratspeak-overlay.sh', import.meta.url));
const updatePath = fileURLToPath(new URL('../update.sh', import.meta.url));

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

describe('ratspeak overlay apply list', () => {
  it('lists every apply-rs script used by clone/ensure', () => {
    const list = readFileSync(listPath, 'utf8');
    expect(list).toContain('RS_RETICULUM_APPLY_SCRIPTS');
    expect(list).toContain('RS_LXMF_APPLY_SCRIPTS');
    expect(list).toContain('apply_ratspeak_rns_overlays');
    expect(list).toContain('apply-rsReticulum-path-medium-slots.sh');
    expect(list).toContain('apply-rsLXMF-link-delivery-has-pending-to.sh');
  });

  it('keeps apply helper fail-loud with stderr capture', () => {
    const helper = readFileSync(helperPath, 'utf8');
    expect(helper).toContain('apply_ratspeak_overlay_or_die');
    expect(helper).toContain('apply --check');
    // Must not swallow git-apply diagnostics (rev-parse may still redirect).
    expect(helper).not.toMatch(/git -C .* apply .*2>\s*\/dev\/null/);
  });

  it('patch basenames in update.sh match apply-list overlays', () => {
    const list = readFileSync(listPath, 'utf8');
    const update = readFileSync(updatePath, 'utf8');
    const applyNames = [...list.matchAll(/apply-(rs(?:Reticulum|LXMF)-[a-z0-9-]+)\.sh/g)].map(
      (m) => `${m[1]}.patch`,
    );
    expect(applyNames.length).toBeGreaterThanOrEqual(10);
    for (const patch of applyNames) {
      expect(update).toContain(patch);
    }
  });

  it('stops rns overlay apply on first failure without invoking later stubs', () => {
    const work = mkdtempSync(path.join(os.tmpdir(), 'mesh-overlay-apply-'));
    tempDirs.push(work);
    const logPath = path.join(work, 'invocations.log');
    const list = readFileSync(listPath, 'utf8');
    const names = [...list.matchAll(/apply-rsReticulum-[a-z0-9-]+\.sh/g)].map((m) => m[0]);
    expect(names.length).toBeGreaterThanOrEqual(3);
    const failAt = 1;
    for (let i = 0; i < names.length; i++) {
      const scriptPath = path.join(work, names[i]);
      const exitCode = i === failAt ? 1 : 0;
      writeFileSync(
        scriptPath,
        `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$(basename "$0")" >> ${JSON.stringify(logPath)}
exit ${exitCode}
`,
        'utf8',
      );
      chmodSync(scriptPath, 0o755);
    }
    const result = spawnSync(
      'bash',
      [
        '-c',
        `set -euo pipefail; source ${JSON.stringify(listPath)}; apply_ratspeak_rns_overlays ${JSON.stringify(work)}`,
      ],
      { encoding: 'utf8' },
    );
    expect(result.status).not.toBe(0);
    const invoked = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(invoked).toEqual(names.slice(0, failAt + 1));
  });
});
