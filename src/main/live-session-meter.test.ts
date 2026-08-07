import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  __resetLiveSessionMeterRegistryForTests,
  clearLiveSessionMeter,
  createLiveSessionMeter,
  LIVE_SESSION_EWMA_ALPHA,
  LIVE_SESSION_PENDING_SAMPLE_TIMEOUT_MS,
  LIVE_SESSION_STALE_MS,
  noteLiveSessionData,
  noteLiveSessionWrite,
  resetLiveSessionMeter,
  snapshotLiveSessionMeter,
} from './live-session-meter';

describe('createLiveSessionMeter', () => {
  let now = 0;

  beforeEach(() => {
    now = 1_000;
  });

  function makeMeter() {
    return createLiveSessionMeter({
      now: () => now,
      alpha: LIVE_SESSION_EWMA_ALPHA,
      pendingTimeoutMs: LIVE_SESSION_PENDING_SAMPLE_TIMEOUT_MS,
      staleMs: LIVE_SESSION_STALE_MS,
    });
  }

  it('returns null before any completed sample', () => {
    const meter = makeMeter();
    expect(meter.snapshot().rttMs).toBeNull();
    meter.noteWrite();
    expect(meter.snapshot().rttMs).toBeNull();
  });

  it('records write→data latency and applies EWMA on the second sample', () => {
    const meter = makeMeter();
    meter.noteWrite();
    now += 40;
    meter.noteData();
    expect(meter.snapshot().rttMs).toBe(40);

    meter.noteWrite();
    now += 100;
    meter.noteData();
    // alpha * 100 + (1 - alpha) * 40
    const expected = LIVE_SESSION_EWMA_ALPHA * 100 + (1 - LIVE_SESSION_EWMA_ALPHA) * 40;
    expect(meter.snapshot().rttMs).toBeCloseTo(expected, 5);
  });

  it('overwrites pending write so only the latest write→data is sampled', () => {
    const meter = makeMeter();
    meter.noteWrite();
    now += 50;
    meter.noteWrite();
    now += 10;
    meter.noteData();
    expect(meter.snapshot().rttMs).toBe(10);
  });

  it('ignores noteData with no pending write', () => {
    const meter = makeMeter();
    meter.noteWrite();
    now += 20;
    meter.noteData();
    expect(meter.snapshot().rttMs).toBe(20);

    meter.noteData();
    expect(meter.snapshot().rttMs).toBe(20);
  });

  it('drops a pending write after the pending timeout without poisoning EWMA', () => {
    const meter = makeMeter();
    meter.noteWrite();
    now += 25;
    meter.noteData();
    expect(meter.snapshot().rttMs).toBe(25);

    meter.noteWrite();
    now += LIVE_SESSION_PENDING_SAMPLE_TIMEOUT_MS + 1;
    meter.noteData();
    expect(meter.snapshot().rttMs).toBe(25);
  });

  it('returns null after the stale window and restores after a new sample', () => {
    const meter = makeMeter();
    meter.noteWrite();
    now += 30;
    meter.noteData();
    expect(meter.snapshot().rttMs).toBe(30);

    now += LIVE_SESSION_STALE_MS + 1;
    expect(meter.snapshot().rttMs).toBeNull();

    meter.noteWrite();
    now += 15;
    meter.noteData();
    // Stale only hides the snapshot; EWMA continues from the prior sample.
    const expected = LIVE_SESSION_EWMA_ALPHA * 15 + (1 - LIVE_SESSION_EWMA_ALPHA) * 30;
    expect(meter.snapshot().rttMs).toBeCloseTo(expected, 5);
  });

  it('reset clears EWMA and pending', () => {
    const meter = makeMeter();
    meter.noteWrite();
    now += 12;
    meter.noteData();
    expect(meter.snapshot().rttMs).toBe(12);

    meter.noteWrite();
    meter.reset();
    expect(meter.snapshot().rttMs).toBeNull();
    now += 5;
    meter.noteData();
    expect(meter.snapshot().rttMs).toBeNull();
  });

  it('clear makes subsequent notes no-ops until reset', () => {
    const meter = makeMeter();
    meter.noteWrite();
    now += 18;
    meter.noteData();
    expect(meter.snapshot().rttMs).toBe(18);

    meter.clear();
    expect(meter.snapshot().rttMs).toBeNull();
    meter.noteWrite();
    now += 10;
    meter.noteData();
    expect(meter.snapshot().rttMs).toBeNull();

    meter.reset();
    meter.noteWrite();
    now += 22;
    meter.noteData();
    expect(meter.snapshot().rttMs).toBe(22);
  });
});

describe('live session meter registry', () => {
  beforeEach(() => {
    __resetLiveSessionMeterRegistryForTests();
  });

  afterEach(() => {
    __resetLiveSessionMeterRegistryForTests();
  });

  it.each(['meshtastic', 'meshcore'] as const)(
    'tracks %s session meter via registry helpers',
    (protocol) => {
      expect(snapshotLiveSessionMeter(protocol)).toBeNull();
      resetLiveSessionMeter(protocol);
      noteLiveSessionWrite(protocol);
      noteLiveSessionData(protocol);
      const snap = snapshotLiveSessionMeter(protocol);
      expect(snap).not.toBeNull();
      expect(snap?.rttMs).toBeGreaterThanOrEqual(0);

      clearLiveSessionMeter(protocol);
      expect(snapshotLiveSessionMeter(protocol)).toBeNull();
    },
  );
});
