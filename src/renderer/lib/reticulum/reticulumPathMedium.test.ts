import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  parsePathMedium,
  parsePathMediumPreference,
  parsePeerPathsResponse,
  pathMediumFromInterfaceNameOrType,
  peerMediumPinApiFromChoice,
  peerMediumPinChoiceFromApi,
} from './reticulumPathMedium';

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
});
