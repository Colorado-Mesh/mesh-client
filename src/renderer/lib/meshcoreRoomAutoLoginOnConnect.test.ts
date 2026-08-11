import { afterEach, describe, expect, it } from 'vitest';

import type { MeshcoreRoomAutoLoginTargetProbe } from './meshcoreRoomAutoLoginOnConnect';
import {
  isMeshcoreRoomAutoLoginInFlight,
  meshcoreRoomAutoLoginReadyKey,
  resetMeshcoreRoomAutoLoginSingleFlight,
  runMeshcoreRoomAutoLoginSingleFlight,
  selectMeshcoreRoomAutoLoginTargets,
} from './meshcoreRoomAutoLoginOnConnect';

const READY: MeshcoreRoomAutoLoginTargetProbe = {
  isRoom: true,
  hasCredential: true,
  hasPubKey: true,
  loggedIn: false,
  queued: false,
  autoLoginFailed: false,
};

describe('selectMeshcoreRoomAutoLoginTargets', () => {
  it('keeps rooms that are ready to log in', () => {
    expect(selectMeshcoreRoomAutoLoginTargets([1, 2], () => READY)).toEqual([1, 2]);
  });

  it('skips logged-in and queued rooms', () => {
    expect(
      selectMeshcoreRoomAutoLoginTargets([1, 2, 3], (id) => ({
        ...READY,
        loggedIn: id === 1,
        queued: id === 2,
      })),
    ).toEqual([3]);
  });

  it('skips non-room, missing credential/pubkey, and prior auto-login failure', () => {
    expect(
      selectMeshcoreRoomAutoLoginTargets([1, 2, 3, 4], (id) => ({
        ...READY,
        isRoom: id !== 1,
        hasCredential: id !== 2,
        hasPubKey: id !== 3,
        autoLoginFailed: id === 4,
      })),
    ).toEqual([]);
  });
});

describe('meshcoreRoomAutoLoginReadyKey', () => {
  it('only includes configured ids that are Room contacts', () => {
    expect(meshcoreRoomAutoLoginReadyKey([10, 20, 30], (id) => id === 20 || id === 10)).toBe(
      '10,20',
    );
  });

  it('is stable when unrelated nodes appear', () => {
    const rooms = new Set([42]);
    const before = meshcoreRoomAutoLoginReadyKey([42], (id) => rooms.has(id));
    rooms.add(99);
    const after = meshcoreRoomAutoLoginReadyKey([42], (id) => rooms.has(id));
    expect(after).toBe(before);
  });

  it('changes when a configured room contact becomes available', () => {
    const rooms = new Set<number>();
    expect(meshcoreRoomAutoLoginReadyKey([7], (id) => rooms.has(id))).toBe('');
    rooms.add(7);
    expect(meshcoreRoomAutoLoginReadyKey([7], (id) => rooms.has(id))).toBe('7');
  });
});

describe('runMeshcoreRoomAutoLoginSingleFlight', () => {
  afterEach(() => {
    resetMeshcoreRoomAutoLoginSingleFlight();
  });

  it('collapses concurrent triggers onto one run', async () => {
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = async (): Promise<void> => {
      started += 1;
      await gate;
    };

    const first = runMeshcoreRoomAutoLoginSingleFlight(run);
    const second = runMeshcoreRoomAutoLoginSingleFlight(run);
    expect(isMeshcoreRoomAutoLoginInFlight()).toBe(true);
    expect(first).toBe(second);
    expect(started).toBe(1);

    release();
    await Promise.all([first, second]);
    expect(started).toBe(1);
    expect(isMeshcoreRoomAutoLoginInFlight()).toBe(false);
  });

  it('allows a later pass after the in-flight one finishes', async () => {
    let started = 0;
    await runMeshcoreRoomAutoLoginSingleFlight(() => {
      started += 1;
      return Promise.resolve();
    });
    await runMeshcoreRoomAutoLoginSingleFlight(() => {
      started += 1;
      return Promise.resolve();
    });
    expect(started).toBe(2);
  });
});
