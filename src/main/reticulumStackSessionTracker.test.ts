import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  RETICULUM_STACK_FAST_FLAP_THRESHOLD,
  RETICULUM_STACK_FAST_FLAP_WINDOW_MS,
  ReticulumStackSessionTracker,
} from './reticulumStackSessionTracker';

describe('ReticulumStackSessionTracker', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function persistPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-rns-flap-'));
    dirs.push(dir);
    return path.join(dir, 'stack-sessions.json');
  }

  it('does not suspect after four stack starts', () => {
    const tracker = new ReticulumStackSessionTracker();
    for (let i = 0; i < RETICULUM_STACK_FAST_FLAP_THRESHOLD - 1; i++) {
      const start = 1_000 + i * 60_000;
      tracker.recordStart(start);
      tracker.recordStop(start + 5 * 60_000);
    }
    expect(tracker.isFastFlapSuspected(400_000)).toBe(false);
  });

  it('suspects after five stack starts within 12h even when sessions last minutes', () => {
    const tracker = new ReticulumStackSessionTracker();
    for (let i = 0; i < RETICULUM_STACK_FAST_FLAP_THRESHOLD; i++) {
      const start = 1_000 + i * 60_000;
      tracker.recordStart(start);
      tracker.recordStop(start + 5 * 60_000);
    }
    expect(tracker.isFastFlapSuspected(400_000)).toBe(true);
  });

  it('counts the current open session toward the start threshold', () => {
    const tracker = new ReticulumStackSessionTracker();
    for (let i = 0; i < RETICULUM_STACK_FAST_FLAP_THRESHOLD - 1; i++) {
      const start = 1_000 + i * 60_000;
      tracker.recordStart(start);
      tracker.recordStop(start + 5 * 60_000);
    }
    tracker.recordStart(300_000);
    expect(tracker.isFastFlapSuspected(400_000)).toBe(true);
  });

  it('treats a start without stop as closing the previous session', () => {
    const tracker = new ReticulumStackSessionTracker();
    tracker.recordStart(1_000);
    tracker.recordStart(6_000);
    tracker.recordStop(7_000);
    expect(tracker.getSessionsForTests(8_000)).toEqual([
      { startedAtMs: 1_000, endedAtMs: 6_000 },
      { startedAtMs: 6_000, endedAtMs: 7_000 },
    ]);
  });

  it('persists starts across tracker instances', () => {
    const file = persistPath();
    const first = new ReticulumStackSessionTracker(file);
    for (let i = 0; i < RETICULUM_STACK_FAST_FLAP_THRESHOLD; i++) {
      const start = 1_000 + i * 60_000;
      first.recordStart(start);
      first.recordStop(start + 5 * 60_000);
    }
    const second = new ReticulumStackSessionTracker(file);
    expect(second.isFastFlapSuspected(400_000)).toBe(true);
  });

  it('prunes starts older than the 12h window', () => {
    const tracker = new ReticulumStackSessionTracker();
    for (let i = 0; i < RETICULUM_STACK_FAST_FLAP_THRESHOLD; i++) {
      const start = i * 1_000;
      tracker.recordStart(start);
      tracker.recordStop(start + 5_000);
    }
    expect(tracker.isFastFlapSuspected(10_000)).toBe(true);
    expect(tracker.isFastFlapSuspected(RETICULUM_STACK_FAST_FLAP_WINDOW_MS + 20_000)).toBe(false);
  });
});
