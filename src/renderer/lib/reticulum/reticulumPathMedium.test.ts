import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  activeReticulumPathSlot,
  backupReticulumPathSlots,
  fetchReticulumPeerPaths,
  parsePathMedium,
  parsePathMediumPreference,
  parsePeerPathsResponse,
  pathMediumFromInterfaceNameOrType,
  peerMediumPinApiFromChoice,
  peerMediumPinChoiceFromApi,
  type ReticulumPathSlot,
  setReticulumPeerMediumPin,
} from './reticulumPathMedium';

function slot(
  partial: Partial<ReticulumPathSlot> & Pick<ReticulumPathSlot, 'active'>,
): ReticulumPathSlot {
  return {
    hops: null,
    via_hash: null,
    interface: null,
    interface_id: null,
    medium: null,
    timestamp: null,
    expires: null,
    expired: false,
    ...partial,
  };
}

describe('reticulumPathMedium', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['lowest', 'lowest'],
    [' Network ', 'network'],
    ['RF', 'rf'],
    ['wired', null],
    [3, null],
  ] as const)('parsePathMediumPreference(%j) → %j', (raw, expected) => {
    expect(parsePathMediumPreference(raw)).toBe(expected);
  });

  it.each([
    ['rf', 'rf'],
    ['NETWORK', 'network'],
    ['lowest', null],
  ] as const)('parsePathMedium(%j) → %j', (raw, expected) => {
    expect(parsePathMedium(raw)).toBe(expected);
  });

  it('classifies interface names into path mediums', () => {
    expect(pathMediumFromInterfaceNameOrType('rnode')).toBe('rf');
    expect(pathMediumFromInterfaceNameOrType('ble://AA')).toBe('rf');
    expect(pathMediumFromInterfaceNameOrType('tcp')).toBe('network');
    expect(pathMediumFromInterfaceNameOrType('i2p')).toBe('network');
    expect(pathMediumFromInterfaceNameOrType('auto')).toBe('network');
  });

  it('maps pin choice ↔ API null/medium', () => {
    expect(peerMediumPinChoiceFromApi(null)).toBe('auto');
    expect(peerMediumPinChoiceFromApi(undefined)).toBe('auto');
    expect(peerMediumPinChoiceFromApi('rf')).toBe('rf');
    expect(peerMediumPinApiFromChoice('auto')).toBeNull();
    expect(peerMediumPinApiFromChoice('network')).toBe('network');
  });

  it('activeReticulumPathSlot prefers active live, then first live, then first', () => {
    const active = slot({ active: true, medium: 'rf', interface: 'RNode' });
    const backup = slot({ active: false, medium: 'network', interface: 'TCP' });
    expect(activeReticulumPathSlot([active, backup])).toBe(active);

    const expiredActive = slot({ active: true, expired: true, medium: 'rf' });
    const liveBackup = slot({ active: false, medium: 'network', interface: 'Hub' });
    expect(activeReticulumPathSlot([expiredActive, liveBackup])).toBe(liveBackup);

    expect(activeReticulumPathSlot([])).toBeNull();
    expect(activeReticulumPathSlot([expiredActive])).toBe(expiredActive);
  });

  it('backupReticulumPathSlots excludes active and expired slots', () => {
    const active = slot({ active: true, medium: 'rf', interface: 'RNode' });
    const backup = slot({
      active: false,
      medium: 'network',
      interface: 'Ratspeak',
      hops: 3,
    });
    const expired = slot({ active: false, expired: true, medium: 'network', interface: 'Old' });
    expect(backupReticulumPathSlots([active, backup, expired])).toEqual([backup]);
    expect(backupReticulumPathSlots([active])).toEqual([]);
  });

  it('parsePeerPathsResponse keeps at most 3 slots and marks pin null', () => {
    const parsed = parsePeerPathsResponse({
      ok: true,
      destination_hash: 'aabbccddeeff00112233445566778899',
      preference: 'lowest',
      pin: null,
      effective_preference: 'lowest',
      live: true,
      paths: [
        { active: true, hops: 1, medium: 'rf', interface: 'RNode' },
        { active: false, hops: 3, medium: 'network', interface: 'Ratspeak' },
        { active: false, hops: 4, medium: 'network', interface: 'US-East' },
        { active: false, hops: 9, medium: 'network', interface: 'extra' },
      ],
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.pin).toBeNull();
    expect(parsed.paths).toHaveLength(3);
    expect(parsed.paths[0]?.active).toBe(true);
    expect(parsed.paths[0]?.medium).toBe('rf');
  });

  it('parsePeerPathsResponse surfaces errors', () => {
    expect(parsePeerPathsResponse({ ok: false, error: 'path_slots_query_failed' })).toEqual({
      ok: false,
      paths: [],
      error: 'path_slots_query_failed',
    });
  });

  it('rejects malformed hashes without calling proxyGet', async () => {
    const proxyGet = vi.fn();
    const proxyPut = vi.fn();
    const getStatus = vi.fn().mockResolvedValue({ running: true, port: 19437, pid: 1 });
    vi.stubGlobal('window', {
      electronAPI: {
        reticulum: { getStatus, proxyGet, proxyPut },
      },
    });
    try {
      await expect(fetchReticulumPeerPaths('not-a-hash')).resolves.toEqual({
        ok: false,
        paths: [],
        error: 'invalid_hash',
      });
      await expect(setReticulumPeerMediumPin('zzzz', 'rf')).resolves.toEqual({
        ok: false,
        error: 'invalid_hash',
      });
      expect(proxyGet).not.toHaveBeenCalled();
      expect(proxyPut).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
