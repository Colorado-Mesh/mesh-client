import { describe, expect, it } from 'vitest';

import {
  computeNodeInfoLastHeardMs,
  mergeMeshtasticLivePacketLastHeard,
  mergeMeshtasticUserPacketLastHeard,
  meshtasticPacketRxTimeMs,
  meshtasticTracerouteLastHeardNodeIds,
} from '@/renderer/lib/meshtasticLastHeard';
import { getNodeStatus } from '@/renderer/lib/nodeStatus';

describe('meshtasticPacketRxTimeMs', () => {
  it('normalizes Date objects', () => {
    const d = new Date('2024-06-01T12:00:00Z');
    expect(meshtasticPacketRxTimeMs(d)).toBe(d.getTime());
  });

  it('normalizes Unix seconds to ms', () => {
    expect(meshtasticPacketRxTimeMs(1_700_000_000)).toBe(1_700_000_000_000);
  });

  it('passes through epoch ms', () => {
    expect(meshtasticPacketRxTimeMs(1_700_000_000_123)).toBe(1_700_000_000_123);
  });

  it('returns 0 for invalid values', () => {
    expect(meshtasticPacketRxTimeMs(undefined)).toBe(0);
    expect(meshtasticPacketRxTimeMs(0)).toBe(0);
    expect(meshtasticPacketRxTimeMs(NaN)).toBe(0);
  });
});

describe('mergeMeshtasticLivePacketLastHeard', () => {
  it('does not bump during configure replay', () => {
    const stale = 1_000_000;
    expect(mergeMeshtasticLivePacketLastHeard(stale, Date.now(), true)).toBe(stale);
  });

  it('bumps stale last_heard on live packet without rxTime', () => {
    const before = Date.now();
    const bumped = mergeMeshtasticLivePacketLastHeard(1_000_000, 0, false);
    const after = Date.now();
    expect(bumped).toBeGreaterThanOrEqual(before);
    expect(bumped).toBeLessThanOrEqual(after);
  });

  it('takes max of existing and packet rx when post-configure', () => {
    const rx = 5_000_000;
    expect(mergeMeshtasticLivePacketLastHeard(0, rx, false)).toBe(rx);
    expect(mergeMeshtasticLivePacketLastHeard(10_000_000, rx, false)).toBe(10_000_000);
    expect(mergeMeshtasticLivePacketLastHeard(1000, rx, false)).toBe(rx);
  });
});

describe('mergeMeshtasticUserPacketLastHeard', () => {
  it('does not bump during configure replay', () => {
    expect(mergeMeshtasticUserPacketLastHeard(0, Date.now(), true)).toBe(0);
    expect(mergeMeshtasticUserPacketLastHeard(1_000_000, Date.now(), true)).toBe(1_000_000);
  });

  it('ignores invalid rx times (no Date.now fallback)', () => {
    expect(mergeMeshtasticUserPacketLastHeard(1000, 0, false)).toBe(1000);
    expect(mergeMeshtasticUserPacketLastHeard(1000, NaN, false)).toBe(1000);
  });

  it('takes max of existing and packet rx when post-configure', () => {
    const rx = 5_000_000;
    expect(mergeMeshtasticUserPacketLastHeard(0, rx, false)).toBe(rx);
    expect(mergeMeshtasticUserPacketLastHeard(10_000_000, rx, false)).toBe(10_000_000);
    expect(mergeMeshtasticUserPacketLastHeard(1000, rx, false)).toBe(rx);
  });
});

describe('computeNodeInfoLastHeardMs', () => {
  it('preserves newer client last_heard over stale NodeDB info.lastHeard', () => {
    const clientMs = Date.now() - 60_000;
    const nodeDbSec = Math.floor((Date.now() - 7 * 24 * 3_600_000) / 1000);
    const merged = computeNodeInfoLastHeardMs(nodeDbSec, clientMs, false);
    expect(merged).toBe(clientMs);
  });

  it('uses NodeDB lastHeard when newer than client', () => {
    const nodeDbSec = Math.floor(Date.now() / 1000);
    const clientMs = Date.now() - 7 * 24 * 3_600_000;
    const merged = computeNodeInfoLastHeardMs(nodeDbSec, clientMs, false);
    expect(merged).toBe(nodeDbSec * 1000);
  });

  it('fallback to Date.now() for self when info.lastHeard and existing are both 0', () => {
    const lastHeardMs = computeNodeInfoLastHeardMs(0, 0, true);
    expect(getNodeStatus(lastHeardMs)).toBe('online');
  });

  it('non-self node with info.lastHeard=0 and existing=0 stays offline', () => {
    const lastHeardMs = computeNodeInfoLastHeardMs(0, 0, false);
    expect(getNodeStatus(lastHeardMs)).toBe('offline');
  });

  it('clamps future info.lastHeard from device RTC skew to Date.now()', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const futureSec = nowSec + 86_400;
    const before = Date.now();
    const lastHeardMs = computeNodeInfoLastHeardMs(futureSec, 0, false);
    const after = Date.now();
    expect(lastHeardMs).toBeGreaterThanOrEqual(before);
    expect(lastHeardMs).toBeLessThanOrEqual(after);
  });
});

describe('meshtasticTracerouteLastHeardNodeIds', () => {
  it('includes reply sender and correlated target', () => {
    expect(meshtasticTracerouteLastHeardNodeIds(0x1111, 0x2222)).toEqual([0x1111, 0x2222]);
  });

  it('deduplicates when sender equals target', () => {
    expect(meshtasticTracerouteLastHeardNodeIds(0x1111, 0x1111)).toEqual([0x1111]);
  });

  it('includes only sender when no correlated target', () => {
    expect(meshtasticTracerouteLastHeardNodeIds(0x1111, undefined)).toEqual([0x1111]);
  });

  it('includes correlated target when sender is invalid (0)', () => {
    expect(meshtasticTracerouteLastHeardNodeIds(0, 0x2222)).toEqual([0x2222]);
  });

  it('returns empty when sender and correlated target are both invalid', () => {
    expect(meshtasticTracerouteLastHeardNodeIds(0, 0)).toEqual([]);
    expect(meshtasticTracerouteLastHeardNodeIds(0, undefined)).toEqual([]);
  });
});
