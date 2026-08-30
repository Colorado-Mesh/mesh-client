import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RELAY_COVERAGE_SOFT_CAP, useRelayCoverageStore } from './relayCoverageStore';

const ID_A = 'identity-a';
const ID_B = 'identity-b';
const MSG = 'msg-1';

describe('relayCoverageStore', () => {
  beforeEach(() => {
    useRelayCoverageStore.setState({ coverage: {} });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('set creates an entry and coverageFor returns it', () => {
    useRelayCoverageStore.getState().set(ID_A, MSG, {
      protocol: 'meshcore',
      mode: 'confirmed',
      heardRepeaters: [{ nodeId: 1, name: 'R1' }],
    });
    const entry = useRelayCoverageStore.getState().coverageFor(ID_A, MSG);
    expect(entry?.protocol).toBe('meshcore');
    expect(entry?.mode).toBe('confirmed');
    expect(entry?.heardRepeaters).toEqual([{ nodeId: 1, name: 'R1' }]);
    expect(entry?.updatedAt).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
  });

  it('partial set merges without dropping other fields', () => {
    useRelayCoverageStore.getState().set(ID_A, MSG, {
      protocol: 'meshtastic',
      mode: 'binary-heard',
      broadcastHeard: null,
    });
    vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
    useRelayCoverageStore.getState().set(ID_A, MSG, {
      protocol: 'meshtastic',
      mode: 'binary-heard',
      broadcastHeard: true,
    });
    const entry = useRelayCoverageStore.getState().coverageFor(ID_A, MSG);
    expect(entry?.broadcastHeard).toBe(true);
    expect(entry?.mode).toBe('binary-heard');
    expect(entry?.updatedAt).toBe(Date.parse('2026-01-01T00:00:01.000Z'));
  });

  it('coverageFor miss returns undefined', () => {
    expect(useRelayCoverageStore.getState().coverageFor(ID_A, 'missing')).toBeUndefined();
  });

  it('isolates the same messageId under two identities', () => {
    useRelayCoverageStore.getState().set(ID_A, MSG, {
      protocol: 'reticulum',
      mode: 'predicted',
      predictedRelayHops: 2,
    });
    useRelayCoverageStore.getState().set(ID_B, MSG, {
      protocol: 'reticulum',
      mode: 'predicted',
      predictedRelayHops: 5,
    });
    expect(useRelayCoverageStore.getState().coverageFor(ID_A, MSG)?.predictedRelayHops).toBe(2);
    expect(useRelayCoverageStore.getState().coverageFor(ID_B, MSG)?.predictedRelayHops).toBe(5);
  });

  it('clearIdentity removes only that identity keys', () => {
    useRelayCoverageStore.getState().set(ID_A, MSG, {
      protocol: 'meshcore',
      mode: 'confirmed',
      heardRepeaters: [],
    });
    useRelayCoverageStore.getState().set(ID_B, MSG, {
      protocol: 'meshcore',
      mode: 'confirmed',
      heardRepeaters: [{ nodeId: 9 }],
    });
    useRelayCoverageStore.getState().clearIdentity(ID_A);
    expect(useRelayCoverageStore.getState().coverageFor(ID_A, MSG)).toBeUndefined();
    expect(useRelayCoverageStore.getState().coverageFor(ID_B, MSG)?.heardRepeaters).toEqual([
      { nodeId: 9 },
    ]);
  });

  it('updatedAt advances on each set', () => {
    useRelayCoverageStore.getState().set(ID_A, MSG, {
      protocol: 'meshtastic',
      mode: 'binary-heard',
      broadcastHeard: null,
    });
    const t0 = useRelayCoverageStore.getState().coverageFor(ID_A, MSG)!.updatedAt;
    vi.setSystemTime(new Date('2026-01-01T00:00:05.000Z'));
    useRelayCoverageStore.getState().set(ID_A, MSG, {
      protocol: 'meshtastic',
      mode: 'binary-heard',
      broadcastHeard: false,
    });
    const t1 = useRelayCoverageStore.getState().coverageFor(ID_A, MSG)!.updatedAt;
    expect(t1).toBeGreaterThan(t0);
  });

  it('renameMessage moves coverage to the new message id', () => {
    useRelayCoverageStore.getState().set(ID_A, 'temp-1', {
      protocol: 'meshtastic',
      mode: 'binary-heard',
      broadcastHeard: null,
    });
    useRelayCoverageStore.getState().renameMessage(ID_A, 'temp-1', 'wire-99');
    expect(useRelayCoverageStore.getState().coverageFor(ID_A, 'temp-1')).toBeUndefined();
    expect(
      useRelayCoverageStore.getState().coverageFor(ID_A, 'wire-99')?.broadcastHeard,
    ).toBeNull();
  });

  it('remove deletes a single message coverage entry', () => {
    useRelayCoverageStore.getState().set(ID_A, MSG, {
      protocol: 'meshcore',
      mode: 'confirmed',
      heardRepeaters: [],
    });
    useRelayCoverageStore.getState().set(ID_A, 'keep-me', {
      protocol: 'meshcore',
      mode: 'confirmed',
      heardRepeaters: [],
    });
    useRelayCoverageStore.getState().remove(ID_A, MSG);
    expect(useRelayCoverageStore.getState().coverageFor(ID_A, MSG)).toBeUndefined();
    expect(useRelayCoverageStore.getState().coverageFor(ID_A, 'keep-me')).toBeDefined();
  });

  it('renameMessage merges heardRepeaters when destination key already exists', () => {
    useRelayCoverageStore.getState().set(ID_A, 'from', {
      protocol: 'meshcore',
      mode: 'confirmed',
      heardRepeaters: [{ nodeId: 1, name: 'A' }],
    });
    useRelayCoverageStore.getState().set(ID_A, 'to', {
      protocol: 'meshcore',
      mode: 'confirmed',
      heardRepeaters: [{ nodeId: 2, name: 'B' }],
    });
    useRelayCoverageStore.getState().renameMessage(ID_A, 'from', 'to');
    expect(useRelayCoverageStore.getState().coverageFor(ID_A, 'from')).toBeUndefined();
    const heard = useRelayCoverageStore.getState().coverageFor(ID_A, 'to')?.heardRepeaters ?? [];
    expect(heard.map((r) => r.nodeId).sort()).toEqual([1, 2]);
  });

  it('set drops stale fields when protocol/mode changes', () => {
    useRelayCoverageStore.getState().set(ID_A, MSG, {
      protocol: 'meshcore',
      mode: 'confirmed',
      heardRepeaters: [{ nodeId: 9, name: 'Old' }],
    });
    useRelayCoverageStore.getState().set(ID_A, MSG, {
      protocol: 'meshtastic',
      mode: 'binary-heard',
      broadcastHeard: true,
    });
    const entry = useRelayCoverageStore.getState().coverageFor(ID_A, MSG)!;
    expect(entry.heardRepeaters).toBeUndefined();
    expect(entry.broadcastHeard).toBe(true);
  });

  it('set prunes oldest entries when soft cap is exceeded (keeps current key)', () => {
    for (let i = 0; i < RELAY_COVERAGE_SOFT_CAP; i++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)));
      useRelayCoverageStore.getState().set(ID_A, `old-${i}`, {
        protocol: 'meshcore',
        mode: 'confirmed',
        heardRepeaters: [],
      });
    }
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 1, 0)));
    useRelayCoverageStore.getState().set(ID_A, 'keep-me', {
      protocol: 'meshcore',
      mode: 'confirmed',
      heardRepeaters: [{ nodeId: 1 }],
    });
    expect(Object.keys(useRelayCoverageStore.getState().coverage).length).toBe(
      RELAY_COVERAGE_SOFT_CAP,
    );
    expect(useRelayCoverageStore.getState().coverageFor(ID_A, 'keep-me')?.heardRepeaters).toEqual([
      { nodeId: 1 },
    ]);
    expect(useRelayCoverageStore.getState().coverageFor(ID_A, 'old-0')).toBeUndefined();
  });
});
