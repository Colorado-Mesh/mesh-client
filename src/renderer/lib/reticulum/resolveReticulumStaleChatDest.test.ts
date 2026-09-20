import { describe, expect, it } from 'vitest';

import { LXMF_DELIVERY_ASPECT } from '@/renderer/lib/reticulum/resolveReticulumChatLxmfDest';
import {
  isReticulumPeerHeardViaTcpHub,
  resolveReticulumStaleChatDest,
  reticulumDisplayNameFamilyTokens,
  reticulumDisplayNamesShareFamily,
  type ReticulumStaleChatDestPeerHint,
} from '@/renderer/lib/reticulum/resolveReticulumStaleChatDest';
import { LXST_TELEPHONY_ASPECT } from '@/renderer/lib/reticulumVoiceCapability';
import type { ReticulumIdentityActivityRow } from '@/renderer/stores/reticulumIdentityActivityStore';

/** Ceorl-wired (MeshChatX-era) */
const WIRED_LXMF = 'd010ea4417f71ff4fd15a6182747aaec';
const WIRED_IDENTITY = '098c1ee916253f73459dda7ced773c60';
/** Ceorl-test (mesh-client) */
const TEST_LXMF = 'e3359f1314aff4fb6261400a8202149b';
const TEST_IDENTITY = '0f79468863d76b3ba574baa92606ffcb';
const UNRELATED_LXMF = '1b3f8c0a2efffc4e5f593423fb52b6f5';
const UNRELATED_IDENTITY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function lxmfRow(dest: string, identity: string, lastSeen: number): ReticulumIdentityActivityRow {
  return {
    destination_hash: dest,
    aspect: LXMF_DELIVERY_ASPECT,
    identity_hash: identity,
    last_seen: lastSeen,
  };
}

function activityMap(
  entries: [string, ReticulumIdentityActivityRow[]][],
): Map<string, ReticulumIdentityActivityRow[]> {
  return new Map(entries);
}

function peer(
  hash: string,
  displayName: string,
  extras: Partial<ReticulumStaleChatDestPeerHint> = {},
): ReticulumStaleChatDestPeerHint {
  return {
    destination_hash: hash,
    display_name: displayName,
    ...extras,
  };
}

describe('reticulumDisplayNameFamilyTokens', () => {
  it('splits hyphenated names into tokens', () => {
    expect(reticulumDisplayNameFamilyTokens('Ceorl-wired')).toEqual(['ceorl', 'wired']);
    expect(reticulumDisplayNameFamilyTokens('Ceorl-test')).toEqual(['ceorl', 'test']);
  });
});

describe('reticulumDisplayNamesShareFamily', () => {
  it('matches Ceorl-wired and Ceorl-test via shared ceorl token', () => {
    expect(reticulumDisplayNamesShareFamily('Ceorl-wired', 'Ceorl-test')).toBe(true);
  });

  it('rejects unrelated names', () => {
    expect(reticulumDisplayNamesShareFamily('Ceorl-wired', 'NV0N - Colorado Mesh')).toBe(false);
  });

  it('matches leading token prefix of length >= 4', () => {
    expect(reticulumDisplayNamesShareFamily('ceorl', 'ceorltest')).toBe(true);
  });
});

describe('isReticulumPeerHeardViaTcpHub', () => {
  it('detects TCP / transport hub interfaces', () => {
    expect(isReticulumPeerHeardViaTcpHub('RNS_Transport_US-East')).toBe(true);
    expect(isReticulumPeerHeardViaTcpHub('tcpclient')).toBe(true);
    expect(isReticulumPeerHeardViaTcpHub('community-hub')).toBe(true);
  });

  it('rejects RF/BLE, Auto, and empty', () => {
    expect(isReticulumPeerHeardViaTcpHub('Auto')).toBe(false);
    expect(isReticulumPeerHeardViaTcpHub('ttyUSB0')).toBe(false);
    expect(isReticulumPeerHeardViaTcpHub('RNodeInterface')).toBe(false);
    expect(isReticulumPeerHeardViaTcpHub('ble://xx')).toBe(false);
    expect(isReticulumPeerHeardViaTcpHub(null)).toBe(false);
    expect(isReticulumPeerHeardViaTcpHub('')).toBe(false);
  });
});

describe('resolveReticulumStaleChatDest', () => {
  it('returns ok when there is no alternate', () => {
    const result = resolveReticulumStaleChatDest({
      openHash: WIRED_LXMF,
      activityByDestination: activityMap([
        [WIRED_LXMF, [lxmfRow(WIRED_LXMF, WIRED_IDENTITY, 100)]],
      ]),
      peers: [peer(WIRED_LXMF, 'Ceorl-wired')],
      failedOutboundHashes: new Set(),
      openHasDelivered: true,
    });
    expect(result).toEqual({ status: 'ok' });
  });

  it('returns ok for the same hash only', () => {
    const result = resolveReticulumStaleChatDest({
      openHash: WIRED_LXMF,
      activityByDestination: activityMap([
        [WIRED_LXMF, [lxmfRow(WIRED_LXMF, WIRED_IDENTITY, 100)]],
      ]),
      peers: [peer(WIRED_LXMF, 'Ceorl-wired'), peer(WIRED_LXMF, 'Ceorl-wired')],
      failedOutboundHashes: new Set([WIRED_LXMF]),
      openHasDelivered: true,
    });
    expect(result).toEqual({ status: 'ok' });
  });

  it('returns ok when activity is missing / open is not lxmf.delivery', () => {
    const result = resolveReticulumStaleChatDest({
      openHash: WIRED_LXMF,
      activityByDestination: activityMap([
        [
          WIRED_LXMF,
          [
            {
              destination_hash: WIRED_LXMF,
              aspect: LXST_TELEPHONY_ASPECT,
              identity_hash: WIRED_IDENTITY,
              last_seen: 100,
            },
          ],
        ],
        [TEST_LXMF, [lxmfRow(TEST_LXMF, TEST_IDENTITY, 200)]],
      ]),
      peers: [peer(WIRED_LXMF, 'Ceorl-wired'), peer(TEST_LXMF, 'Ceorl-test')],
      failedOutboundHashes: new Set(),
      openHasDelivered: false,
    });
    expect(result).toEqual({ status: 'ok' });
  });

  it('flags name-family Ceorl-wired vs Ceorl-test', () => {
    const result = resolveReticulumStaleChatDest({
      openHash: WIRED_LXMF,
      activityByDestination: activityMap([
        [WIRED_LXMF, [lxmfRow(WIRED_LXMF, WIRED_IDENTITY, 100)]],
        [TEST_LXMF, [lxmfRow(TEST_LXMF, TEST_IDENTITY, 200)]],
      ]),
      peers: [peer(WIRED_LXMF, 'Ceorl-wired'), peer(TEST_LXMF, 'Ceorl-test')],
      failedOutboundHashes: new Set(),
      openHasDelivered: false,
    });
    expect(result).toEqual({
      status: 'stale_alternate',
      openHash: WIRED_LXMF,
      alternateHash: TEST_LXMF,
      alternateDisplayName: 'Ceorl-test',
      reason: 'name_family',
    });
  });

  it('flags failed pending to e3359f while open d010ea44 has delivered', () => {
    const result = resolveReticulumStaleChatDest({
      openHash: WIRED_LXMF,
      activityByDestination: activityMap([
        [WIRED_LXMF, [lxmfRow(WIRED_LXMF, WIRED_IDENTITY, 100)]],
        [TEST_LXMF, [lxmfRow(TEST_LXMF, TEST_IDENTITY, 50)]],
      ]),
      peers: [peer(WIRED_LXMF, 'OtherName'), peer(TEST_LXMF, 'TotallyDifferent')],
      failedOutboundHashes: new Set([TEST_LXMF]),
      openHasDelivered: true,
    });
    expect(result).toEqual({
      status: 'stale_alternate',
      openHash: WIRED_LXMF,
      alternateHash: TEST_LXMF,
      alternateDisplayName: 'TotallyDifferent',
      reason: 'failed_other_lxmf',
    });
  });

  it('matches failed outbound via the alternate identity hash', () => {
    const result = resolveReticulumStaleChatDest({
      openHash: WIRED_LXMF,
      activityByDestination: activityMap([
        [WIRED_LXMF, [lxmfRow(WIRED_LXMF, WIRED_IDENTITY, 100)]],
        [TEST_LXMF, [lxmfRow(TEST_LXMF, TEST_IDENTITY, 50)]],
      ]),
      peers: [peer(WIRED_LXMF, 'A'), peer(TEST_LXMF, 'B')],
      failedOutboundHashes: new Set([TEST_IDENTITY]),
      openHasDelivered: true,
    });
    expect(result.status).toBe('stale_alternate');
    if (result.status === 'stale_alternate') {
      expect(result.reason).toBe('failed_other_lxmf');
      expect(result.alternateHash).toBe(TEST_LXMF);
    }
  });

  it('returns ok for unrelated names without failed pending', () => {
    const result = resolveReticulumStaleChatDest({
      openHash: WIRED_LXMF,
      activityByDestination: activityMap([
        [WIRED_LXMF, [lxmfRow(WIRED_LXMF, WIRED_IDENTITY, 100)]],
        [UNRELATED_LXMF, [lxmfRow(UNRELATED_LXMF, UNRELATED_IDENTITY, 200)]],
      ]),
      peers: [peer(WIRED_LXMF, 'Ceorl-wired'), peer(UNRELATED_LXMF, 'NV0N - Colorado Mesh')],
      failedOutboundHashes: new Set(),
      openHasDelivered: true,
    });
    expect(result).toEqual({ status: 'ok' });
  });

  it('does not flag failed-other when open has never delivered', () => {
    const result = resolveReticulumStaleChatDest({
      openHash: WIRED_LXMF,
      activityByDestination: activityMap([
        [WIRED_LXMF, [lxmfRow(WIRED_LXMF, WIRED_IDENTITY, 100)]],
        [TEST_LXMF, [lxmfRow(TEST_LXMF, TEST_IDENTITY, 50)]],
      ]),
      peers: [peer(WIRED_LXMF, 'A'), peer(TEST_LXMF, 'B')],
      failedOutboundHashes: new Set([TEST_LXMF]),
      openHasDelivered: false,
    });
    expect(result).toEqual({ status: 'ok' });
  });

  it('prefers failed-other over name-family when ranking', () => {
    const nameOnly = 'c1111111111111111111111111111111';
    const nameOnlyIdentity = 'c2222222222222222222222222222222';
    const result = resolveReticulumStaleChatDest({
      openHash: WIRED_LXMF,
      activityByDestination: activityMap([
        [WIRED_LXMF, [lxmfRow(WIRED_LXMF, WIRED_IDENTITY, 100)]],
        [nameOnly, [lxmfRow(nameOnly, nameOnlyIdentity, 999)]],
        [TEST_LXMF, [lxmfRow(TEST_LXMF, TEST_IDENTITY, 1)]],
      ]),
      peers: [
        peer(WIRED_LXMF, 'Ceorl-wired'),
        peer(nameOnly, 'Ceorl-other'),
        peer(TEST_LXMF, 'ZZZ-unrelated'),
      ],
      failedOutboundHashes: new Set([TEST_LXMF]),
      openHasDelivered: true,
    });
    expect(result).toEqual({
      status: 'stale_alternate',
      openHash: WIRED_LXMF,
      alternateHash: TEST_LXMF,
      alternateDisplayName: 'ZZZ-unrelated',
      reason: 'failed_other_lxmf',
    });
  });

  it('skips alternates that share the same RNS identity', () => {
    const otherAspectLxmf = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    // Same identity announcing two lxmf hashes should not happen often; still ignore.
    const result = resolveReticulumStaleChatDest({
      openHash: WIRED_LXMF,
      activityByDestination: activityMap([
        [WIRED_LXMF, [lxmfRow(WIRED_LXMF, WIRED_IDENTITY, 100)]],
        [otherAspectLxmf, [lxmfRow(otherAspectLxmf, WIRED_IDENTITY, 200)]],
      ]),
      peers: [peer(WIRED_LXMF, 'Ceorl-wired'), peer(otherAspectLxmf, 'Ceorl-wired-2')],
      failedOutboundHashes: new Set(),
      openHasDelivered: true,
    });
    expect(result).toEqual({ status: 'ok' });
  });
});
