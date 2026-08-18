import { describe, expect, it } from 'vitest';

import {
  isReticulumTcpHubActivelyRejecting,
  isReticulumTcpProbeSidecarMismatch,
  listReticulumTcpProbeSidecarMismatches,
  resolveReticulumTcpRecoveryCooldownMs,
  RETICULUM_TCP_RECOVERY_COOLDOWN_MS,
  RETICULUM_TCP_RECOVERY_RETRY_COOLDOWN_MS,
  RETICULUM_TCP_RECOVERY_RETRY_WINDOW_MS,
} from './reticulumTcpInterfaceRecovery';

describe('reticulumTcpInterfaceRecovery', () => {
  const ratspeak = {
    id: 'ratspeak',
    name: 'Ratspeak',
    type: 'tcp',
    enabled: true,
    status: 'down',
    host: 'rns.ratspeak.org',
    port: 4242,
  };

  it('detects probe-ok sidecar-down mismatch', () => {
    expect(isReticulumTcpProbeSidecarMismatch(ratspeak, 120)).toBe(true);
  });

  it('returns false when sidecar reports up', () => {
    expect(isReticulumTcpProbeSidecarMismatch({ ...ratspeak, status: 'up' }, 120)).toBe(false);
  });

  it('returns false when probe failed', () => {
    expect(isReticulumTcpProbeSidecarMismatch(ratspeak, null)).toBe(false);
  });

  it('uses shorter cooldown for repeat failures within retry window', () => {
    const now = 1_000_000;
    const lastRecovery = now - 2 * 60_000;
    expect(resolveReticulumTcpRecoveryCooldownMs(now, lastRecovery)).toBe(
      RETICULUM_TCP_RECOVERY_RETRY_COOLDOWN_MS,
    );
  });

  it('uses full cooldown after retry window elapses', () => {
    const now = 1_000_000;
    const lastRecovery = now - RETICULUM_TCP_RECOVERY_RETRY_WINDOW_MS - 1;
    expect(resolveReticulumTcpRecoveryCooldownMs(now, lastRecovery)).toBe(
      RETICULUM_TCP_RECOVERY_COOLDOWN_MS,
    );
  });

  it('lists all mismatched enabled TCP rows', () => {
    const rows = [
      ratspeak,
      {
        id: 'rmap',
        name: 'RMAP World',
        type: 'tcp',
        enabled: true,
        status: 'up',
        host: 'rmap.world',
        port: 4242,
      },
    ];
    const rtt = new Map([
      ['ratspeak', 120],
      ['rmap', 130],
    ]);
    expect(listReticulumTcpProbeSidecarMismatches(rows, rtt).map((r) => r.id)).toEqual([
      'ratspeak',
    ]);
  });

  it('detects when hub is actively rejecting a TCP session', () => {
    expect(isReticulumTcpHubActivelyRejecting('Ratspeak', { tcpResetByPeer: ['Ratspeak'] })).toBe(
      true,
    );
    expect(isReticulumTcpHubActivelyRejecting('Ratspeak', { tcpReadEof: ['Ratspeak'] })).toBe(true);
    expect(isReticulumTcpHubActivelyRejecting('Ratspeak', null)).toBe(false);
    expect(isReticulumTcpHubActivelyRejecting('Ratspeak', { tcpResetByPeer: ['RMAP World'] })).toBe(
      false,
    );
  });
});
