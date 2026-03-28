import { beforeEach, describe, expect, it } from 'vitest';

import {
  isMeshcoreContactEligibleForUserGroup,
  isMeshcoreTransportStatusChatLine,
  meshcoreAppendRepeaterAuthHint,
  meshcoreApplyRepeaterSessionAuth,
  meshcoreApplyRepeaterSessionAuthSkip,
  meshcoreClearRepeaterRemoteSessionAuth,
  meshcoreDeriveChannelKeyHexFromName,
  meshcoreGetRepeaterSessionPassword,
  meshcoreIsRepeaterRemoteAuthTouched,
  meshcoreSelfInfoBwToDisplayKhz,
  meshcoreSelfInfoFreqToDisplayHz,
} from './meshcoreUtils';

describe('isMeshcoreTransportStatusChatLine', () => {
  it('detects MeshCore hop ACK lines', () => {
    expect(
      isMeshcoreTransportStatusChatLine(
        'ack @[🛜 NV0N 1200] | 07,3e,0a | SNR: 11.75 dB | RSSI: -19 dBm | Received at: 19:56:58',
      ),
    ).toBe(true);
  });

  it('allows normal chat', () => {
    expect(isMeshcoreTransportStatusChatLine('Alice: hello SNR: 5')).toBe(false);
  });

  it('detects nack prefix', () => {
    expect(isMeshcoreTransportStatusChatLine('nack @[x] detail')).toBe(true);
  });
});

describe('meshcoreSelfInfoFreqToDisplayHz', () => {
  it('treats large values as Hz', () => {
    expect(meshcoreSelfInfoFreqToDisplayHz(915_000_000)).toBe(915_000_000);
  });

  it('converts kHz integers from firmware to Hz', () => {
    expect(meshcoreSelfInfoFreqToDisplayHz(910_525)).toBe(910_525_000);
  });

  it('converts MHz floats to Hz', () => {
    expect(meshcoreSelfInfoFreqToDisplayHz(915.5)).toBe(915_500_000);
  });
});

describe('meshcoreSelfInfoBwToDisplayKhz', () => {
  it('converts Hz to kHz for UI', () => {
    expect(meshcoreSelfInfoBwToDisplayKhz(250_000)).toBe(250);
  });

  it('passes through kHz when firmware already uses kHz', () => {
    expect(meshcoreSelfInfoBwToDisplayKhz(250)).toBe(250);
  });
});

describe('isMeshcoreContactEligibleForUserGroup', () => {
  it('allows Chat and None-like types', () => {
    expect(isMeshcoreContactEligibleForUserGroup({ hw_model: 'Chat' })).toBe(true);
    expect(isMeshcoreContactEligibleForUserGroup({ hw_model: 'None' })).toBe(true);
    expect(isMeshcoreContactEligibleForUserGroup({ hw_model: 'Unknown' })).toBe(true);
  });

  it('excludes Repeater and Room', () => {
    expect(isMeshcoreContactEligibleForUserGroup({ hw_model: 'Repeater' })).toBe(false);
    expect(isMeshcoreContactEligibleForUserGroup({ hw_model: 'Room' })).toBe(false);
  });

  it('treats empty hw_model as eligible', () => {
    expect(isMeshcoreContactEligibleForUserGroup({ hw_model: '' })).toBe(true);
  });
});

describe('meshcoreDeriveChannelKeyHexFromName', () => {
  it('matches SHA-256("#name") first 16 bytes as 32 hex chars', async () => {
    const hex = await meshcoreDeriveChannelKeyHexFromName('test');
    expect(hex).toBe('9cd8fcf22a47333b591d96a2b848b73f');
  });

  it('treats leading # as part of the hashed string', async () => {
    const a = await meshcoreDeriveChannelKeyHexFromName('#foo');
    const b = await meshcoreDeriveChannelKeyHexFromName('foo');
    expect(a).toBe(b);
  });
});

describe('repeater session auth (in-memory)', () => {
  beforeEach(() => {
    meshcoreClearRepeaterRemoteSessionAuth();
  });

  it('starts untouched with empty password', () => {
    expect(meshcoreIsRepeaterRemoteAuthTouched()).toBe(false);
    expect(meshcoreGetRepeaterSessionPassword()).toBe('');
  });

  it('apply sets password and marks touched', () => {
    meshcoreApplyRepeaterSessionAuth('s3cr3t');
    expect(meshcoreIsRepeaterRemoteAuthTouched()).toBe(true);
    expect(meshcoreGetRepeaterSessionPassword()).toBe('s3cr3t');
  });

  it('skip marks touched with empty password', () => {
    meshcoreApplyRepeaterSessionAuthSkip();
    expect(meshcoreIsRepeaterRemoteAuthTouched()).toBe(true);
    expect(meshcoreGetRepeaterSessionPassword()).toBe('');
  });

  it('clear resets both touched and password', () => {
    meshcoreApplyRepeaterSessionAuth('s3cr3t');
    meshcoreClearRepeaterRemoteSessionAuth();
    expect(meshcoreIsRepeaterRemoteAuthTouched()).toBe(false);
    expect(meshcoreGetRepeaterSessionPassword()).toBe('');
  });

  it('password is never written to sessionStorage', () => {
    meshcoreApplyRepeaterSessionAuth('topsecret');
    expect(sessionStorage.getItem('meshclient:meshcoreRepeaterPassword')).toBeNull();
    expect(sessionStorage.getItem('meshclient:meshcoreRepeaterAuthTouched')).toBeNull();
  });
});

describe('meshcoreAppendRepeaterAuthHint', () => {
  it('appends hint for authentication failed', () => {
    const out = meshcoreAppendRepeaterAuthHint('Authentication failed');
    expect(out).toContain('Authentication failed');
    expect(out).toContain('Repeaters panel');
  });

  it('leaves unrelated errors unchanged', () => {
    expect(meshcoreAppendRepeaterAuthHint('Request timed out (~10s)')).toBe(
      'Request timed out (~10s)',
    );
  });

  it('does not double-append hint', () => {
    const once = meshcoreAppendRepeaterAuthHint('Authentication failed');
    expect(meshcoreAppendRepeaterAuthHint(once)).toBe(once);
  });
});
