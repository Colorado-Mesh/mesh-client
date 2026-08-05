import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRfReconnectController } from './rfReconnectController';

describe('createRfReconnectController', () => {
  let microtasks: (() => void)[];

  beforeEach(() => {
    microtasks = [];
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function flushMicrotasks(): void {
    const queued = microtasks.splice(0, microtasks.length);
    for (const fn of queued) fn();
  }

  function create() {
    return createRfReconnectController({
      logTag: 'test',
      scheduleMicrotask: (fn) => {
        microtasks.push(fn);
      },
    });
  }

  it('idle link lost starts the owner once', () => {
    const c = create();
    const first = c.onLinkLost();
    expect(first.shouldStartOwner).toBe(true);
    expect(c.isReconnecting).toBe(true);
    expect(c.dirty).toBe(false);

    const runs: number[] = [];
    c.scheduleOwner(() => runs.push(1));
    flushMicrotasks();
    expect(runs).toEqual([1]);
  });

  it('Neal race: link lost during opening with slow teardown never double-starts owner', () => {
    const c = create();
    expect(c.onLinkLost().shouldStartOwner).toBe(true);

    const ownerStarts: number[] = [];
    const startOwner = () => {
      ownerStarts.push(ownerStarts.length + 1);
      const { generation } = c.beginAttempt(ownerStarts.length);
      c.beginOpening();
      return generation;
    };

    c.scheduleOwner(startOwner);
    flushMicrotasks();
    expect(ownerStarts).toEqual([1]);
    expect(c.phase).toBe('opening');
    expect(c.attemptActive).toBe(true);

    // Mid-open drop (tcp-disconnected): must NOT start a second owner.
    const mid = c.onLinkLost();
    expect(mid.shouldStartOwner).toBe(false);
    expect(c.dirty).toBe(true);

    // Simulate await disconnect completing after attempt finally:
    const settled = c.endAttempt({ keepReconnecting: true });
    expect(settled.shouldSchedule).toBe(true);
    c.scheduleOwner(startOwner);
    // Stale post-await schedule from a second lost handler — must coalesce to dirty, not run.
    c.scheduleOwner(startOwner);
    flushMicrotasks();
    expect(ownerStarts).toEqual([1, 2]);
  });

  it('double onLinkLost in the same tick still yields one owner start', () => {
    const c = create();
    const a = c.onLinkLost();
    const b = c.onLinkLost();
    expect(a.shouldStartOwner).toBe(true);
    expect(b.shouldStartOwner).toBe(false);
    expect(c.dirty).toBe(true);

    const runs: number[] = [];
    c.scheduleOwner(() => {
      runs.push(1);
      c.beginAttempt(1);
    });
    c.scheduleOwner(() => {
      runs.push(2);
      c.beginAttempt(2);
    });
    flushMicrotasks();
    expect(runs).toEqual([1]);
  });

  it('link lost during backoff only dirties; owner schedules after endAttempt', () => {
    const c = create();
    c.onLinkLost();
    c.beginAttempt(1);
    expect(c.phase).toBe('backoff');

    expect(c.onLinkLost().shouldStartOwner).toBe(false);
    expect(c.dirty).toBe(true);

    const runs: number[] = [];
    const settled = c.endAttempt({ keepReconnecting: true });
    expect(settled.shouldSchedule).toBe(true);
    c.scheduleOwner(() => runs.push(1));
    flushMicrotasks();
    expect(runs).toEqual([1]);
  });

  it('cancel mid-cycle prevents further owner runs', () => {
    const c = create();
    c.onLinkLost();
    c.beginAttempt(1);
    c.cancel();
    expect(c.isReconnecting).toBe(false);
    expect(c.phase).toBe('idle');

    const runs: number[] = [];
    c.scheduleOwner(() => runs.push(1));
    flushMicrotasks();
    expect(runs).toEqual([]);
  });

  it('markSuccess clears reconnecting and dirty', () => {
    const c = create();
    c.onLinkLost();
    c.beginAttempt(1);
    c.beginOpening();
    c.markDirty();
    c.markSuccess();
    expect(c.isReconnecting).toBe(false);
    expect(c.dirty).toBe(false);
    expect(c.attemptActive).toBe(false);
  });

  it('markExhausted returns to idle so a later onLinkLost can start a new owner', () => {
    const c = create();
    c.onLinkLost();
    c.beginAttempt(3);
    c.markExhausted();
    expect(c.isReconnecting).toBe(false);
    expect(c.phase).toBe('idle');
    expect(c.attemptActive).toBe(false);

    const again = c.onLinkLost();
    expect(again.shouldStartOwner).toBe(true);
    expect(c.isReconnecting).toBe(true);

    const runs: number[] = [];
    c.scheduleOwner(() => runs.push(1));
    flushMicrotasks();
    expect(runs).toEqual([1]);
  });

  it('cancel before scheduled owner runs prevents the owner', () => {
    const c = create();
    c.onLinkLost();
    const runs: number[] = [];
    c.scheduleOwner(() => runs.push(1));
    c.cancel();
    flushMicrotasks();
    expect(runs).toEqual([]);
    expect(c.isReconnecting).toBe(false);
  });

  it('scheduleOwner during attemptActive sets dirty instead of running', () => {
    const c = create();
    c.onLinkLost();
    c.beginAttempt(1);
    const runs: number[] = [];
    c.scheduleOwner(() => runs.push(1));
    flushMicrotasks();
    expect(runs).toEqual([]);
    expect(c.dirty).toBe(true);
  });
});
