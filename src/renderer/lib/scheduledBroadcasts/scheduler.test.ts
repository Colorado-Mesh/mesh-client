import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScheduledBroadcastRow } from '@/shared/scheduledBroadcastTypes';

import { mergeScheduledBroadcastRuntimePatch } from '../../stores/scheduledBroadcastsStore';
import { MS_PER_MINUTE } from '../timeConstants';
import { MAX_TIMER_DELAY_MS } from './constants';
import type { DeliverResult } from './deliver';
import {
  createScheduledBroadcastScheduler,
  SCHEDULER_ROOM_POST_RETRY_MS,
  SCHEDULER_SAFETY_INTERVAL_MS,
  type SchedulerDeps,
} from './scheduler';

vi.mock('./deliver', () => ({ deliverScheduledBroadcast: vi.fn() }));

const T0 = new Date(2026, 2, 10, 10, 0, 0, 0).getTime();
const at = (hh: number, mm: number, day = 10): number =>
  new Date(2026, 2, day, hh, mm, 0, 0).getTime();

function row(slot: number, over: Partial<ScheduledBroadcastRow> = {}): ScheduledBroadcastRow {
  return {
    slot,
    label: `Slot ${slot}`,
    text: `secret text ${slot}`,
    enabled: true,
    interval: 'daily',
    timeOfDayMin: 10 * 60 + 5,
    weekday: null,
    dayOfMonth: null,
    anchorYmd: null,
    nextDueAt: at(10, 5),
    lastAttemptAt: null,
    lastResult: null,
    targets: [],
    updatedAt: 0,
    ...over,
  };
}

const SENT: DeliverResult = {
  outcome: 'sent',
  targets: [{ kind: 'meshtastic-channel', label: 'Primary', ok: true }],
};

interface Rig {
  slots: Map<number, ScheduledBroadcastRow>;
  enabled: { value: boolean };
  calls: string[];
  deps: SchedulerDeps;
  claimDue: ReturnType<typeof vi.fn>;
  saveNextDueAt: ReturnType<typeof vi.fn>;
  setResult: ReturnType<typeof vi.fn>;
  deliver: ReturnType<typeof vi.fn>;
}

function rig(rows: ScheduledBroadcastRow[], over: Partial<SchedulerDeps> = {}): Rig {
  const slots = new Map(rows.map((r) => [r.slot, r]));
  const enabled = { value: true };
  const calls: string[] = [];
  const claimDue = vi.fn((slot: number, expected: number, next: number) => {
    const cur = slots.get(slot);
    if (cur?.nextDueAt !== expected) return Promise.resolve({ claimed: false });
    slots.set(slot, { ...cur, nextDueAt: next });
    calls.push(`claim:${slot}`);
    return Promise.resolve({ claimed: true });
  });
  const saveNextDueAt = vi.fn((slot: number, nextDueAt: number | null) => {
    const cur = slots.get(slot);
    if (cur) slots.set(slot, { ...cur, nextDueAt });
    return Promise.resolve();
  });
  const setResult = vi.fn((slot: number) => {
    calls.push(`result:${slot}`);
    return Promise.resolve();
  });
  const deliver = vi.fn((r: ScheduledBroadcastRow) => {
    calls.push(`deliver:${r.slot}`);
    return Promise.resolve(SENT);
  });
  const deps: SchedulerDeps = {
    now: () => Date.now(),
    isEnabled: () => enabled.value,
    getSlots: () => [...slots.values()],
    claimDue,
    saveNextDueAt,
    setResult,
    applyRuntimeState: (slot, patch, opts) => {
      const cur = slots.get(slot);
      if (cur) slots.set(slot, mergeScheduledBroadcastRuntimePatch(cur, patch, opts));
    },
    deliver,
    isMeshcoreRoomPostReady: () => true,
    ...over,
  };
  return { slots, enabled, calls, deps, claimDue, saveNextDueAt, setResult, deliver };
}

describe('scheduledBroadcast scheduler', () => {
  let debug: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('start / skip-missed', () => {
    it('advances a stale nextDueAt past now and records missed without delivering', async () => {
      const r = rig([row(1, { nextDueAt: at(9, 5) })]);
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();

      expect(r.deliver).not.toHaveBeenCalled();
      expect(r.claimDue).toHaveBeenCalledWith(1, at(9, 5), at(10, 5), T0);
      expect(r.setResult).toHaveBeenCalledWith(1, T0, { at: T0, outcome: 'missed', targets: [] });
      expect(r.slots.get(1)).toMatchObject({
        nextDueAt: at(10, 5),
        lastResult: { outcome: 'missed' },
        lastAttemptAt: T0,
      });
      s.stop();
    });

    it('skips every missed occurrence, not just one', async () => {
      const r = rig([row(1, { nextDueAt: at(10, 5, 3) })]);
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      expect(r.slots.get(1)?.nextDueAt).toBe(at(10, 5));
      s.stop();
    });

    it('leaves future slots alone and gives null nextDueAt its first occurrence', async () => {
      const r = rig([row(1), row(2, { nextDueAt: null })]);
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      expect(r.claimDue).not.toHaveBeenCalled();
      expect(r.saveNextDueAt).toHaveBeenCalledWith(2, at(10, 5));
      s.stop();
    });

    it('ignores disabled slots', async () => {
      const r = rig([row(1, { enabled: false, nextDueAt: at(9, 5) })]);
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      expect(r.claimDue).not.toHaveBeenCalled();
      s.stop();
    });

    it('does not mark missed when another window already claimed the slot', async () => {
      const r = rig([row(1, { nextDueAt: at(9, 5) })]);
      r.claimDue.mockResolvedValueOnce({ claimed: false });
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      expect(r.setResult).not.toHaveBeenCalled();
      s.stop();
    });
  });

  describe('master switch', () => {
    it('arms nothing and fires nothing while off', async () => {
      const r = rig([row(1, { nextDueAt: at(9, 5) })]);
      r.enabled.value = false;
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      expect(vi.getTimerCount()).toBe(0);
      vi.setSystemTime(at(11, 0));
      await vi.advanceTimersByTimeAsync(10 * MS_PER_MINUTE);
      expect(r.claimDue).not.toHaveBeenCalled();
      expect(r.deliver).not.toHaveBeenCalled();
      s.stop();
    });

    it('turning it on skips what was missed while off, then arms', async () => {
      const r = rig([row(1, { nextDueAt: at(9, 5) })]);
      r.enabled.value = false;
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();

      r.enabled.value = true;
      await s.refresh();
      expect(r.deliver).not.toHaveBeenCalled();
      expect(r.slots.get(1)?.lastResult?.outcome).toBe('missed');
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      s.stop();
    });

    it('turning it off clears timers', async () => {
      const r = rig([row(1)]);
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      expect(vi.getTimerCount()).toBe(2);
      r.enabled.value = false;
      await s.refresh();
      expect(vi.getTimerCount()).toBe(0);
      s.stop();
    });

    it('turning it on mid-run defers skip-missed until finishRun', async () => {
      const gates: (() => void)[] = [];
      const r = rig(
        [row(1, { nextDueAt: at(10, 5) }), row(2, { nextDueAt: at(9, 0), timeOfDayMin: 9 * 60 })],
        {
          deliver: vi.fn(async (x: ScheduledBroadcastRow) => {
            r.calls.push(`deliver:${x.slot}`);
            await new Promise<void>((resolve) => gates.push(resolve));
            return SENT;
          }),
        },
      );
      r.enabled.value = false;
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();

      // Start a manual send while disabled so a run is active, then enable.
      r.enabled.value = true;
      const send = s.sendNow(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(s.isRunning()).toBe(true);
      await s.refresh();
      // Stale slot 2 must not be marked missed until the run finishes.
      expect(r.slots.get(2)?.lastResult?.outcome).not.toBe('missed');
      gates[0]?.();
      await send;
      await vi.advanceTimersByTimeAsync(0);
      expect(r.slots.get(2)?.lastResult?.outcome).toBe('missed');
      expect(r.calls.filter((c) => c.startsWith('deliver'))).toEqual(['deliver:1']);
      s.stop();
    });
  });

  describe('timer', () => {
    it('arms one timer for the earliest slot plus the safety interval', async () => {
      const r = rig([row(1, { nextDueAt: at(10, 30) }), row(2, { nextDueAt: at(10, 5) })]);
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      expect(vi.getTimerCount()).toBe(2);
      expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), at(10, 5) - T0);
      s.stop();
    });

    it('clamps very distant delays to MAX_TIMER_DELAY_MS', async () => {
      const far = T0 + 90 * 24 * 60 * MS_PER_MINUTE;
      const r = rig([row(1, { nextDueAt: far })]);
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), MAX_TIMER_DELAY_MS);
      s.stop();
    });

    it('fires: claim → deliver → setResult → applyRuntimeState, and re-arms for the next day', async () => {
      const r = rig([row(1)]);
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();

      await vi.advanceTimersByTimeAsync(at(10, 5) - T0);

      expect(r.calls).toEqual(['claim:1', 'deliver:1', 'result:1']);
      expect(r.claimDue).toHaveBeenCalledWith(1, at(10, 5), at(10, 5, 11), at(10, 5));
      expect(r.slots.get(1)).toMatchObject({
        nextDueAt: at(10, 5, 11),
        lastAttemptAt: at(10, 5),
        lastResult: { outcome: 'sent', targets: SENT.targets },
      });
      // Next timer is armed for tomorrow.
      expect(vi.getTimerCount()).toBe(2);
      await vi.advanceTimersByTimeAsync(30 * MS_PER_MINUTE);
      expect(r.deliver).toHaveBeenCalledTimes(1);
      s.stop();
    });

    it('keeps a newer save when an in-flight delivery completes', async () => {
      const original = row(1, {
        updatedAt: 5,
        text: 'old-text',
        targets: [
          {
            kind: 'meshtastic-channel',
            identityId: 'mt',
            label: 'Old',
            enabled: true,
            channelIndex: 0,
          },
        ],
      });
      const r = rig([original]);
      r.deps.deliver = (delivered) => {
        expect(delivered.text).toBe('old-text');
        expect(delivered.targets[0]?.label).toBe('Old');
        const cur = r.slots.get(1);
        if (!cur) throw new Error('missing slot');
        r.slots.set(1, {
          ...cur,
          text: 'new-text',
          targets: [
            {
              kind: 'meshtastic-channel',
              identityId: 'mt',
              label: 'New',
              enabled: true,
              channelIndex: 1,
            },
          ],
          nextDueAt: at(18, 0),
          updatedAt: 50,
        });
        return Promise.resolve(SENT);
      };
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      await vi.advanceTimersByTimeAsync(at(10, 5) - T0);
      expect(r.slots.get(1)).toMatchObject({
        text: 'new-text',
        nextDueAt: at(18, 0),
        lastResult: { outcome: 'sent' },
      });
      expect(r.slots.get(1)?.targets[0]?.label).toBe('New');
      s.stop();
    });

    it('does not claim a MeshCore room slot until the room poster is registered', async () => {
      let ready = false;
      const r = rig([
        row(1, {
          targets: [
            {
              kind: 'meshcore-room',
              identityId: 'mc',
              label: 'Room',
              enabled: true,
              roomPubKeyHex: 'ab',
            },
          ],
        }),
      ]);
      r.deps.isMeshcoreRoomPostReady = () => ready;
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      await vi.advanceTimersByTimeAsync(at(10, 5) - T0);
      expect(r.claimDue).not.toHaveBeenCalled();
      expect(r.deliver).not.toHaveBeenCalled();
      expect(r.slots.get(1)?.nextDueAt).toBe(at(10, 5));
      ready = true;
      await vi.advanceTimersByTimeAsync(SCHEDULER_ROOM_POST_RETRY_MS);
      expect(r.claimDue).toHaveBeenCalledTimes(1);
      expect(r.deliver).toHaveBeenCalledTimes(1);
      s.stop();
    });

    it('does not deliver when the claim is lost', async () => {
      const r = rig([row(1)]);
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      r.claimDue.mockResolvedValueOnce({ claimed: false });
      await vi.advanceTimersByTimeAsync(at(10, 5) - T0);
      expect(r.deliver).not.toHaveBeenCalled();
      expect(r.setResult).not.toHaveBeenCalled();
      s.stop();
    });

    it('safety interval catches a due slot that has no timer', async () => {
      const r = rig([row(1, { nextDueAt: at(10, 30) })]);
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      // Slot edited behind the scheduler's back to be due sooner than the armed timer.
      r.slots.set(1, { ...r.slots.get(1)!, nextDueAt: T0 + 1000 });
      await vi.advanceTimersByTimeAsync(SCHEDULER_SAFETY_INTERVAL_MS);
      expect(r.deliver).toHaveBeenCalledTimes(1);
      s.stop();
    });

    it('stop cancels everything', async () => {
      const r = rig([row(1)]);
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      s.stop();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(2 * 60 * MS_PER_MINUTE);
      expect(r.deliver).not.toHaveBeenCalled();
    });

    it('refresh re-arms to an edited earlier slot', async () => {
      const r = rig([row(1, { nextDueAt: at(10, 30) })]);
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      r.slots.set(1, { ...r.slots.get(1)!, nextDueAt: at(10, 2) });
      await s.refresh();
      await vi.advanceTimersByTimeAsync(2 * MS_PER_MINUTE);
      expect(r.deliver).toHaveBeenCalledTimes(1);
      s.stop();
    });
  });

  describe('serialization', () => {
    it('fires same-minute slots one after another, earliest first', async () => {
      const gates = new Map<number, () => void>();
      const r = rig([row(2, { nextDueAt: at(10, 5) }), row(1, { nextDueAt: at(10, 5) })], {
        deliver: vi.fn(async (x: ScheduledBroadcastRow) => {
          r.calls.push(`deliver:${x.slot}`);
          await new Promise<void>((resolve) => gates.set(x.slot, resolve));
          r.calls.push(`done:${x.slot}`);
          return SENT;
        }),
      });
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      await vi.advanceTimersByTimeAsync(at(10, 5) - T0);

      expect(r.calls.filter((c) => c.startsWith('deliver'))).toEqual(['deliver:1']);
      expect(s.isRunning()).toBe(true);
      gates.get(1)?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(r.calls.filter((c) => c.startsWith('deliver'))).toEqual(['deliver:1', 'deliver:2']);
      // Slot 2 must not start before slot 1 finished.
      expect(r.calls.indexOf('done:1')).toBeLessThan(r.calls.indexOf('deliver:2'));
      gates.get(2)?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(s.isRunning()).toBe(false);
      s.stop();
    });

    it('a slot that becomes due mid-run is fired by the same run', async () => {
      const gates: (() => void)[] = [];
      const r = rig([row(1, { nextDueAt: at(10, 5) }), row(2, { nextDueAt: at(10, 6) })], {
        deliver: vi.fn(async (x: ScheduledBroadcastRow) => {
          r.calls.push(`deliver:${x.slot}`);
          await new Promise<void>((resolve) => gates.push(resolve));
          return SENT;
        }),
      });
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      await vi.advanceTimersByTimeAsync(at(10, 5) - T0);
      vi.setSystemTime(at(10, 7));
      gates[0]?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(r.calls.filter((c) => c.startsWith('deliver'))).toEqual(['deliver:1', 'deliver:2']);
      gates[1]?.();
      await vi.advanceTimersByTimeAsync(0);
      s.stop();
    });

    it('does not re-fire a slot whose claim keeps failing within one run', async () => {
      const r = rig([row(1, { nextDueAt: at(10, 5) })]);
      r.claimDue.mockResolvedValue({ claimed: false });
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      await vi.advanceTimersByTimeAsync(at(10, 5) - T0);
      expect(r.claimDue).toHaveBeenCalledTimes(1);
      s.stop();
    });
  });

  describe('sendNow', () => {
    it('delivers without advancing nextDueAt and records the result', async () => {
      const r = rig([row(1)]);
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      const out = await s.sendNow(1);
      expect(out).toEqual({ status: 'done', result: SENT });
      expect(r.claimDue).not.toHaveBeenCalled();
      expect(r.slots.get(1)).toMatchObject({
        nextDueAt: at(10, 5),
        lastResult: { outcome: 'sent' },
        lastAttemptAt: T0,
      });
      expect(r.setResult).toHaveBeenCalledTimes(1);
      s.stop();
    });

    it('is rejected as busy while a run is in progress', async () => {
      let release: () => void = () => {};
      const r = rig([row(1), row(2, { nextDueAt: at(12, 0) })], {
        deliver: vi.fn(
          () =>
            new Promise<DeliverResult>((resolve) => {
              release = () => {
                resolve(SENT);
              };
            }),
        ),
      });
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      await vi.advanceTimersByTimeAsync(at(10, 5) - T0);
      expect(s.isRunning()).toBe(true);
      await expect(s.sendNow(2)).resolves.toEqual({ status: 'busy' });
      release();
      await vi.advanceTimersByTimeAsync(0);
      s.stop();
    });

    it('rejects a second sendNow while the first is delivering', async () => {
      let release: () => void = () => {};
      const r = rig([row(1)], {
        deliver: vi.fn(
          () =>
            new Promise<DeliverResult>((resolve) => {
              release = () => {
                resolve(SENT);
              };
            }),
        ),
      });
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      const first = s.sendNow(1);
      await expect(s.sendNow(1)).resolves.toEqual({ status: 'busy' });
      release();
      await expect(first).resolves.toMatchObject({ status: 'done' });
      s.stop();
    });

    it('blocks a scheduled fire during sendNow, then runs it afterwards', async () => {
      let release: () => void = () => {};
      let first = true;
      const r = rig([row(1, { nextDueAt: at(10, 5) }), row(2, { nextDueAt: at(10, 5) })], {
        deliver: vi.fn((x: ScheduledBroadcastRow) => {
          r.calls.push(`deliver:${x.slot}`);
          if (!first) return Promise.resolve(SENT);
          first = false;
          return new Promise<DeliverResult>((resolve) => {
            release = () => {
              resolve(SENT);
            };
          });
        }),
      });
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      const manual = s.sendNow(2);
      await vi.advanceTimersByTimeAsync(at(10, 5) - T0);
      expect(r.calls).toEqual(['deliver:2']); // slot 1 due but held behind the manual send
      release();
      await manual;
      await vi.advanceTimersByTimeAsync(0);
      expect(r.calls).toContain('deliver:1');
      s.stop();
    });

    it('reports unknown slots', async () => {
      const r = rig([]);
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      await expect(s.sendNow(5)).resolves.toEqual({ status: 'unknown-slot' });
      s.stop();
    });
  });

  describe('power resume', () => {
    it('skips what elapsed during sleep and re-arms', async () => {
      const r = rig([row(1)]);
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      vi.setSystemTime(at(11, 0));
      await s.onPowerResume();
      expect(r.deliver).not.toHaveBeenCalled();
      expect(r.slots.get(1)).toMatchObject({
        nextDueAt: at(10, 5, 11),
        lastResult: { outcome: 'missed' },
      });
      expect(vi.getTimerCount()).toBe(2);
      s.stop();
    });

    it('stops a run from firing slots that went stale across a sleep', async () => {
      const gates: (() => void)[] = [];
      const r = rig(
        [
          row(1, { nextDueAt: at(10, 5) }),
          row(2, { nextDueAt: at(10, 6), timeOfDayMin: 10 * 60 + 6 }),
        ],
        {
          deliver: vi.fn(async (x: ScheduledBroadcastRow) => {
            r.calls.push(`deliver:${x.slot}`);
            await new Promise<void>((resolve) => gates.push(resolve));
            return SENT;
          }),
        },
      );
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      await vi.advanceTimersByTimeAsync(at(10, 5) - T0);

      vi.setSystemTime(at(14, 0)); // laptop slept; slot 2 is now hours stale
      await s.onPowerResume();
      gates[0]?.();
      await vi.advanceTimersByTimeAsync(0);

      expect(r.calls.filter((c) => c.startsWith('deliver'))).toEqual(['deliver:1']);
      expect(r.slots.get(2)).toMatchObject({
        nextDueAt: at(10, 6, 11),
        lastResult: { outcome: 'missed' },
      });
      expect(s.isRunning()).toBe(false);
      s.stop();
    });

    it('is a no-op before start', async () => {
      const r = rig([row(1, { nextDueAt: at(9, 5) })]);
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.onPowerResume();
      expect(r.claimDue).not.toHaveBeenCalled();
    });
  });

  describe('logging and failures', () => {
    it('logs slot, outcome and length but never the text', async () => {
      const r = rig([row(1)]);
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      await vi.advanceTimersByTimeAsync(at(10, 5) - T0);
      const logged = debug.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
      expect(logged).toContain('slot=1 outcome=sent len=13');
      expect(logged).not.toContain('secret text');
      s.stop();
    });

    it('records failed when deliver throws and keeps the schedule advancing', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const r = rig([row(1)], {
        deliver: vi.fn(() => Promise.reject(new Error('boom'))),
      });
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      await vi.advanceTimersByTimeAsync(at(10, 5) - T0);
      expect(r.slots.get(1)).toMatchObject({
        nextDueAt: at(10, 5, 11),
        lastResult: { outcome: 'failed', targets: [] },
      });
      expect(warn).toHaveBeenCalled();
      s.stop();
    });

    it('still applies state when setResult rejects', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const r = rig([row(1)]);
      r.setResult.mockRejectedValueOnce(new Error('db'));
      const s = createScheduledBroadcastScheduler(r.deps);
      await s.start();
      await vi.advanceTimersByTimeAsync(at(10, 5) - T0);
      expect(r.slots.get(1)?.lastResult?.outcome).toBe('sent');
      expect(warn).toHaveBeenCalled();
      s.stop();
    });
  });
});
