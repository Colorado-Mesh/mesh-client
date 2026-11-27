// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(import.meta.dirname, '../..');
const WORKFLOW = '.github/workflows/mobile-android.yaml';
const workflow = load(readFileSync(path.join(REPO, WORKFLOW), 'utf8'));
const runs = (job) => workflow.jobs[job].steps.map((s) => s.run ?? '').join('\n');
const step = (job, name) => workflow.jobs[job].steps.find((s) => s.name === name);

describe('mobile-android workflow', () => {
  it('runs for the mobile package, the desktop code it runs, and itself', () => {
    const paths = workflow.on.pull_request.paths;
    for (const p of ['mobile/**', 'src/main/**', 'src/renderer/**', 'pnpm-lock.yaml', WORKFLOW]) {
      expect(paths).toContain(p);
    }
    const tracked = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      {
        cwd: REPO,
        encoding: 'utf8',
      },
    ).split('\n');
    for (const pattern of paths) {
      const prefix = pattern.replace(/\*\*$/, '');
      expect(
        tracked.some((f) => f === pattern || (pattern.endsWith('**') && f.startsWith(prefix))),
        pattern,
      ).toBe(true);
    }
  });

  it('gates on the guard, typecheck, lint, log ids, Vitest and the drift audit', () => {
    const web = runs('web');
    for (const cmd of [
      'pnpm -C mobile run check:desktop-untouched',
      'pnpm -C mobile run typecheck',
      'pnpm -C mobile run lint',
      'pnpm -C mobile run check:log-ids',
      'pnpm -C mobile exec vitest run',
      'pnpm -C mobile run audit',
      'pnpm -C mobile run build',
    ]) {
      expect(web).toContain(cmd);
    }
  });

  it('makes the harness fail, not skip, when the services it starts are missing', () => {
    const harness = step('web', 'Browser harness');
    expect(harness.env.MOBILE_E2E_REQUIRE.split(',')).toEqual(['meshtasticd', 'mqtt', 'tiles']);
    expect(runs('web')).toMatch(/eclipse-mosquitto@sha256:[0-9a-f]{64}/);
    expect(runs('web')).toMatch(/meshtastic\/meshtasticd@sha256:[0-9a-f]{64}/);
    expect(step('sidecar', 'Reticulum harness spec').env.MOBILE_E2E_REQUIRE).toBe('sidecar');
  });

  it('builds and tests the Android app', () => {
    expect(runs('android')).toContain(
      './gradlew --no-daemon testDebugUnitTest lintDebug assembleDebug',
    );
    expect(runs('android')).toContain('pnpm -C mobile exec cap sync android');
  });

  it('builds the sidecar only when sidecar code changes or on request', () => {
    expect(workflow.jobs.sidecar.if).toBe(
      "needs.changes.outputs.sidecar == 'true' || inputs.build_sidecar",
    );
    expect(runs('sidecar')).toContain('node mobile/scripts/build-sidecar.mjs android');
    expect(runs('sidecar')).toContain('mobile/native/reticulum-ffi/Cargo.toml');
  });
});
