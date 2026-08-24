import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MS_PER_MINUTE, MS_PER_SECOND } from '@/shared/timeConstants';

import {
  clearRrcHubAutoJoinBackoff,
  isRrcAutoJoinBackoffWorthyReason,
  isRrcHubAutoJoinBlocked,
  isRrcLinkProofNotReadyError,
  isRrcLiveNotReadyError,
  isRrcPathNotReadyError,
  recordRrcHubAutoJoinFailure,
  resetRrcHubAutoJoinBackoffForTests,
  RRC_AUTO_JOIN_GIVE_UP_AFTER,
  rrcHubAutoJoinCooldownMsForFailureCountForTests,
} from './rrcHubAutoJoinBackoff';

const HUB = 'AABBCCDDeeff00112233445566778899';

describe('rrcHubAutoJoinBackoff', () => {
  beforeEach(() => {
    resetRrcHubAutoJoinBackoffForTests();
  });

  afterEach(() => {
    resetRrcHubAutoJoinBackoffForTests();
  });

  it('normalizes hub keys', () => {
    recordRrcHubAutoJoinFailure(HUB, 1_000);
    expect(isRrcHubAutoJoinBlocked(HUB.toLowerCase(), 1_000)).toBe(true);
    expect(isRrcHubAutoJoinBlocked(`  ${HUB}  `, 1_000)).toBe(true);
  });

  it('failure #1 blocks until 30s', () => {
    const t0 = 10_000;
    recordRrcHubAutoJoinFailure(HUB, t0);
    expect(rrcHubAutoJoinCooldownMsForFailureCountForTests(1)).toBe(30 * MS_PER_SECOND);
    expect(isRrcHubAutoJoinBlocked(HUB, t0)).toBe(true);
    expect(isRrcHubAutoJoinBlocked(HUB, t0 + 30 * MS_PER_SECOND - 1)).toBe(true);
    expect(isRrcHubAutoJoinBlocked(HUB, t0 + 30 * MS_PER_SECOND)).toBe(false);
  });

  it('failure #2 doubles cooldown to 60s', () => {
    const t0 = 10_000;
    recordRrcHubAutoJoinFailure(HUB, t0);
    recordRrcHubAutoJoinFailure(HUB, t0 + 30 * MS_PER_SECOND);
    expect(rrcHubAutoJoinCooldownMsForFailureCountForTests(2)).toBe(60 * MS_PER_SECOND);
    expect(isRrcHubAutoJoinBlocked(HUB, t0 + 30 * MS_PER_SECOND + 60 * MS_PER_SECOND - 1)).toBe(
      true,
    );
    expect(isRrcHubAutoJoinBlocked(HUB, t0 + 30 * MS_PER_SECOND + 60 * MS_PER_SECOND)).toBe(false);
  });

  it('caps cooldown at 900s', () => {
    expect(rrcHubAutoJoinCooldownMsForFailureCountForTests(5)).toBe(15 * MS_PER_MINUTE);
    expect(rrcHubAutoJoinCooldownMsForFailureCountForTests(99)).toBe(15 * MS_PER_MINUTE);
  });

  it('coalesces duplicate failures within 5s', () => {
    const t0 = 10_000;
    recordRrcHubAutoJoinFailure(HUB, t0);
    recordRrcHubAutoJoinFailure(HUB, t0 + 1000);
    // Still only failure #1 cooldown (30s), not #2 (60s)
    expect(isRrcHubAutoJoinBlocked(HUB, t0 + 30 * MS_PER_SECOND)).toBe(false);
  });

  it('gives up after RRC_AUTO_JOIN_GIVE_UP_AFTER consecutive failures', () => {
    let t = 0;
    for (let i = 0; i < RRC_AUTO_JOIN_GIVE_UP_AFTER; i++) {
      recordRrcHubAutoJoinFailure(HUB, t);
      t += 60 * MS_PER_SECOND;
    }
    expect(isRrcHubAutoJoinBlocked(HUB, t + 15 * MS_PER_MINUTE)).toBe(true);
  });

  it('clear unblocks give-up and cooldown', () => {
    recordRrcHubAutoJoinFailure(HUB, 1_000);
    clearRrcHubAutoJoinBackoff(HUB);
    expect(isRrcHubAutoJoinBlocked(HUB, 1_000)).toBe(false);
  });

  it('isRrcAutoJoinBackoffWorthyReason excludes local_disconnect, cancel, and live-not-ready', () => {
    expect(isRrcAutoJoinBackoffWorthyReason('timed out waiting for WELCOME')).toBe(true);
    expect(isRrcAutoJoinBackoffWorthyReason(null)).toBe(true);
    expect(isRrcAutoJoinBackoffWorthyReason('local_disconnect')).toBe(false);
    expect(isRrcAutoJoinBackoffWorthyReason('cancelled by user')).toBe(false);
    expect(isRrcAutoJoinBackoffWorthyReason('rrc connect requires live rns-stack sidecar')).toBe(
      false,
    );
  });

  it('isRrcLiveNotReadyError matches listen-first error', () => {
    expect(isRrcLiveNotReadyError('rrc connect requires live rns-stack sidecar')).toBe(true);
    expect(isRrcLiveNotReadyError('lxmf send requires live rns-stack sidecar')).toBe(true);
    expect(isRrcLiveNotReadyError('timed out waiting for WELCOME')).toBe(false);
  });

  it('isRrcLinkProofNotReadyError matches link proof timeouts', () => {
    expect(isRrcLinkProofNotReadyError('timed out waiting for link proof')).toBe(true);
    expect(isRrcLinkProofNotReadyError('link proof validation failed')).toBe(true);
    expect(isRrcLinkProofNotReadyError('timed out waiting for WELCOME')).toBe(false);
  });

  it('isRrcPathNotReadyError matches sidecar path-not-ready rejects', () => {
    expect(isRrcPathNotReadyError('path not ready')).toBe(true);
    expect(isRrcPathNotReadyError('timed out waiting for link proof')).toBe(false);
  });

  it('isRrcAutoJoinBackoffWorthyReason excludes link proof startup timeouts', () => {
    expect(isRrcAutoJoinBackoffWorthyReason('timed out waiting for link proof')).toBe(false);
    expect(isRrcAutoJoinBackoffWorthyReason('path not ready')).toBe(false);
  });
});
