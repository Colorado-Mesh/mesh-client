import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  parseAnnounceActivityRows,
  resetReticulumIdentityActivityBatchForTests,
  setReticulumAnnounceBusPressureActive,
  useReticulumIdentityActivityStore,
} from './reticulumIdentityActivityStore';

describe('parseAnnounceActivityRows', () => {
  it('parses single aspect announce payload', () => {
    const rows = parseAnnounceActivityRows({
      destination_hash: 'abc123',
      aspect: 'lxmf.delivery',
      identity_hash: 'id99',
      hops: 2,
      last_seen: 1700,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      destination_hash: 'abc123',
      aspect: 'lxmf.delivery',
      identity_hash: 'id99',
      hops: 2,
      last_seen: 1700,
    });
  });

  it('expands aspects array', () => {
    const rows = parseAnnounceActivityRows({
      destination_hash: 'peer1',
      aspects: ['nomadnetwork.node', 'lxmf.delivery'],
    });
    expect(rows.map((r) => r.aspect)).toEqual(['nomadnetwork.node', 'lxmf.delivery']);
  });

  it('parses batched announces array payload', () => {
    const rows = parseAnnounceActivityRows({
      announces: [
        { destination_hash: 'aaa', hops: 1 },
        { destination_hash: 'bbb', display_name: 'Bob', hops: 2 },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.destination_hash)).toEqual(['aaa', 'bbb']);
  });
});

describe('announce-bus pressure activity gate', () => {
  afterEach(() => {
    resetReticulumIdentityActivityBatchForTests();
    vi.unstubAllGlobals();
  });

  it('skips unknown-aspect SQLite upsert while pressure is active', async () => {
    vi.useFakeTimers();
    const upsertBatch = vi.fn().mockResolvedValue(undefined);
    const upsertOne = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', {
      electronAPI: {
        db: {
          upsertReticulumIdentityActivityBatch: upsertBatch,
          upsertReticulumIdentityActivity: upsertOne,
        },
      },
    });
    try {
      setReticulumAnnounceBusPressureActive(true);
      await useReticulumIdentityActivityStore.getState().upsertActivity({
        destination_hash: 'deadbeef',
        aspect: 'unknown',
        last_seen: Date.now(),
      });
      await vi.advanceTimersByTimeAsync(600);
      expect(upsertBatch).not.toHaveBeenCalled();
      expect(upsertOne).not.toHaveBeenCalled();
      expect(useReticulumIdentityActivityStore.getState().getActivity('deadbeef')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still queues named-aspect activity while pressure is active', async () => {
    vi.useFakeTimers();
    const upsertBatch = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', {
      electronAPI: {
        db: {
          upsertReticulumIdentityActivityBatch: upsertBatch,
          upsertReticulumIdentityActivity: vi.fn(),
        },
      },
    });
    try {
      setReticulumAnnounceBusPressureActive(true);
      await useReticulumIdentityActivityStore.getState().upsertActivity({
        destination_hash: 'cafebabe',
        aspect: 'lxmf.delivery',
        last_seen: Date.now(),
      });
      await vi.advanceTimersByTimeAsync(600);
      expect(upsertBatch).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
