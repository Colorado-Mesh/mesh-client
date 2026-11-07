import { beforeEach, describe, expect, it } from 'vitest';

import { setMeshcoreRoomCredential } from '@/renderer/lib/meshcoreRoomCredentialStorage';
import {
  meshcoreApplyRoomSession,
  meshcoreClearAllRoomSessions,
} from '@/renderer/lib/meshcoreRoomSession';
import { resetSecureSecretCacheForTests } from '@/renderer/lib/secureSecretStorage';

import { isScheduledBroadcastMeshcoreRoomEligible } from './meshcoreRoomEligibility';

describe('isScheduledBroadcastMeshcoreRoomEligible', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSecureSecretCacheForTests();
    meshcoreClearAllRoomSessions();
  });

  it('returns false with neither session nor credential', () => {
    expect(isScheduledBroadcastMeshcoreRoomEligible(0x10)).toBe(false);
  });

  it('returns true when the room can post', () => {
    meshcoreApplyRoomSession(0x11, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    expect(isScheduledBroadcastMeshcoreRoomEligible(0x11)).toBe(true);
  });

  it('returns false for read-only login without a saved credential', () => {
    meshcoreApplyRoomSession(0x12, {
      guestPassword: '',
      adminPassword: '',
      role: 'readonly',
    });
    expect(isScheduledBroadcastMeshcoreRoomEligible(0x12)).toBe(false);
  });

  it('returns true when a credential is saved even without a session', async () => {
    await setMeshcoreRoomCredential(0x13, { guestPassword: 'hello' });
    expect(isScheduledBroadcastMeshcoreRoomEligible(0x13)).toBe(true);
  });

  it('returns true for an intentionally blank saved guest password', async () => {
    await setMeshcoreRoomCredential(0x14, { guestPassword: '' });
    expect(isScheduledBroadcastMeshcoreRoomEligible(0x14)).toBe(true);
  });

  it('returns false for admin-only credentials without a guest password key', async () => {
    await setMeshcoreRoomCredential(0x15, { adminPassword: 'ops-only' });
    expect(isScheduledBroadcastMeshcoreRoomEligible(0x15)).toBe(false);
  });
});
