import { beforeEach, describe, expect, it } from 'vitest';

import {
  isMeshcoreContactEligibleForUserGroup,
  isMeshcoreTransportStatusChatLine,
  mergeHwModelOnContactUpdate,
  meshcoreAppendRepeaterAuthHint,
  meshcoreApplyRepeaterSessionAuth,
  meshcoreApplyRepeaterSessionAuthSkip,
  meshcoreClearRepeaterRemoteSessionAuth,
  meshcoreConnectionImpliesUsbPower,
  meshcoreContactTypeFromHwModel,
  meshcoreDeriveChannelKeyHexFromName,
  meshcoreGetRepeaterSessionPassword,
  meshcoreIsRepeaterRemoteAuthTouched,
  meshcoreManufacturerModelFromDeviceQuery,
  meshcoreMilliVoltsToApproximateBatteryPercent,
  meshcoreMinimalNodeFromAdvertEvent,
  meshcoreSelfInfoBwToDisplayKhz,
  meshcoreSelfInfoFreqToDisplayHz,
  meshcoreTracePathLenToHops,
  pubkeyToNodeId,
} from './meshcoreUtils';

describe('meshcoreMinimalNodeFromAdvertEvent', () => {
  const key32 = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key32[i] = (i * 7 + 1) & 0xff;

  it('returns null for wrong-length pubkey', () => {
    expect(meshcoreMinimalNodeFromAdvertEvent(new Uint8Array(31), { nowSec: 1_700_000_000 })).toBe(
      null,
    );
  });

  it('returns null when node id folds to 0', () => {
    const k = new Uint8Array(32);
    expect(pubkeyToNodeId(k)).toBe(0);
    expect(meshcoreMinimalNodeFromAdvertEvent(k, { nowSec: 1_700_000_000 })).toBe(null);
  });

  it('builds node with last_heard from lastAdvert when positive', () => {
    const r = meshcoreMinimalNodeFromAdvertEvent(key32, {
      nowSec: 1_700_000_100,
      lastAdvert: 1_700_000_050,
    });
    expect(r).not.toBeNull();
    expect(r!.lastHeardSec).toBe(1_700_000_050);
    expect(r!.node.last_heard).toBe(1_700_000_050);
    expect(r!.node.hw_model).toBe('None');
    expect(r!.contactType).toBe(0);
  });

  it('uses nowSec when lastAdvert is missing or zero', () => {
    const r = meshcoreMinimalNodeFromAdvertEvent(key32, { nowSec: 1_700_000_200, lastAdvert: 0 });
    expect(r!.lastHeardSec).toBe(1_700_000_200);
  });

  it('maps scaled lat/lon to degrees and contact type', () => {
    const r = meshcoreMinimalNodeFromAdvertEvent(key32, {
      nowSec: 1,
      advLat: 45_123456 * 1,
      advLon: -93_654321 * 1,
      contactType: 2,
      advName: '  RP1 ',
    });
    expect(r!.node.latitude).toBeCloseTo(45.123456, 5);
    expect(r!.node.longitude).toBeCloseTo(-93.654321, 5);
    expect(r!.node.long_name).toBe('RP1');
    expect(r!.node.hw_model).toBe('Repeater');
    expect(r!.contactType).toBe(2);
    expect(r!.persistAdvLatDeg).toBeCloseTo(45.123456, 5);
  });
});

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

  it('converts 62500 Hz to 62.5 kHz without rounding', () => {
    expect(meshcoreSelfInfoBwToDisplayKhz(62_500)).toBe(62.5);
  });

  it('converts 31250 Hz to 31.25 kHz without rounding', () => {
    expect(meshcoreSelfInfoBwToDisplayKhz(31_250)).toBe(31.25);
  });

  it('passes through 62.5 kHz float from firmware', () => {
    expect(meshcoreSelfInfoBwToDisplayKhz(62.5)).toBe(62.5);
  });
});

describe('meshcoreMilliVoltsToApproximateBatteryPercent', () => {
  it('maps 3.5V and 4.2V to 0 and 100', () => {
    expect(meshcoreMilliVoltsToApproximateBatteryPercent(3500)).toBe(0);
    expect(meshcoreMilliVoltsToApproximateBatteryPercent(4200)).toBe(100);
  });

  it('maps midpoint to ~50%', () => {
    expect(meshcoreMilliVoltsToApproximateBatteryPercent(3850)).toBe(50);
  });

  it('clamps below empty and above full', () => {
    expect(meshcoreMilliVoltsToApproximateBatteryPercent(3000)).toBe(0);
    expect(meshcoreMilliVoltsToApproximateBatteryPercent(4300)).toBe(100);
  });

  it('returns undefined for non-finite or non-positive input', () => {
    expect(meshcoreMilliVoltsToApproximateBatteryPercent(NaN)).toBe(undefined);
    expect(meshcoreMilliVoltsToApproximateBatteryPercent(0)).toBe(undefined);
    expect(meshcoreMilliVoltsToApproximateBatteryPercent(-100)).toBe(undefined);
  });
});

describe('meshcoreConnectionImpliesUsbPower', () => {
  it('is true only for serial (USB data link / typical VBUS)', () => {
    expect(meshcoreConnectionImpliesUsbPower('serial')).toBe(true);
    expect(meshcoreConnectionImpliesUsbPower('ble')).toBe(false);
    expect(meshcoreConnectionImpliesUsbPower('http')).toBe(false);
    expect(meshcoreConnectionImpliesUsbPower(null)).toBe(false);
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

describe('meshcoreTracePathLenToHops', () => {
  it('maps direct trace (pathLen 1) to 0 hops', () => {
    expect(meshcoreTracePathLenToHops(1)).toBe(0);
  });

  it('subtracts one for multi-segment paths', () => {
    expect(meshcoreTracePathLenToHops(2)).toBe(1);
    expect(meshcoreTracePathLenToHops(5)).toBe(4);
  });

  it('clamps non-positive or non-finite values to 0', () => {
    expect(meshcoreTracePathLenToHops(0)).toBe(0);
    expect(meshcoreTracePathLenToHops(-1)).toBe(0);
    expect(meshcoreTracePathLenToHops(Number.NaN)).toBe(0);
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

describe('mergeHwModelOnContactUpdate', () => {
  it('preserves Repeater hw_model when device pushes type None', () => {
    expect(mergeHwModelOnContactUpdate('Repeater', 'None')).toBe('Repeater');
  });

  it('preserves Repeater hw_model when device pushes type Chat', () => {
    expect(mergeHwModelOnContactUpdate('Repeater', 'Chat')).toBe('Repeater');
  });

  it('preserves Sensor hw_model when device pushes type Unknown', () => {
    expect(mergeHwModelOnContactUpdate('Sensor', 'Unknown')).toBe('Sensor');
  });

  it('uses incoming hw_model when existing is None', () => {
    expect(mergeHwModelOnContactUpdate('None', 'Repeater')).toBe('Repeater');
  });

  it('uses incoming hw_model when existing is undefined (new node)', () => {
    expect(mergeHwModelOnContactUpdate(undefined, 'Chat')).toBe('Chat');
  });

  it('uses incoming hw_model when existing is Unknown', () => {
    expect(mergeHwModelOnContactUpdate('Unknown', 'Repeater')).toBe('Repeater');
  });

  it('uses incoming hw_model when existing is Chat', () => {
    expect(mergeHwModelOnContactUpdate('Chat', 'Repeater')).toBe('Repeater');
  });
});

describe('meshcoreManufacturerModelFromDeviceQuery', () => {
  it('reads manufacturerModel and snake_case aliases', () => {
    expect(meshcoreManufacturerModelFromDeviceQuery({ manufacturerModel: '  XIAO  ' })).toBe(
      'XIAO',
    );
    expect(meshcoreManufacturerModelFromDeviceQuery({ manufacturer_model: 'nRF52' })).toBe('nRF52');
  });

  it('reads nested data / payload', () => {
    expect(
      meshcoreManufacturerModelFromDeviceQuery({
        data: { model: 'Heltec' },
      }),
    ).toBe('Heltec');
    expect(
      meshcoreManufacturerModelFromDeviceQuery({
        payload: { manufacturerModel: 'Lilygo' },
      }),
    ).toBe('Lilygo');
  });

  it('coerces numeric model fields', () => {
    expect(meshcoreManufacturerModelFromDeviceQuery({ model: 42 })).toBe('42');
  });

  it('returns undefined when absent', () => {
    expect(meshcoreManufacturerModelFromDeviceQuery(null)).toBeUndefined();
    expect(meshcoreManufacturerModelFromDeviceQuery({ firmwareVer: 1 })).toBeUndefined();
  });
});

describe('meshcoreContactTypeFromHwModel', () => {
  it('maps known hw_model strings to contact_type', () => {
    expect(meshcoreContactTypeFromHwModel('Repeater')).toBe(2);
    expect(meshcoreContactTypeFromHwModel('Chat')).toBe(1);
    expect(meshcoreContactTypeFromHwModel('None')).toBe(0);
    expect(meshcoreContactTypeFromHwModel('Sensor')).toBe(4);
  });

  it('returns undefined for labels not in CONTACT_TYPE_LABELS', () => {
    expect(meshcoreContactTypeFromHwModel('Unknown')).toBeUndefined();
  });
});

/** Regression: event 128 used to overwrite hw_model from raw advert type; must match contact refresh merge. */
describe('event 128 advert hw_model merge', () => {
  it('preserves Repeater when firmware advert reports Chat (type 1)', () => {
    const newHwModelFromAdvert = 'Chat';
    const mergedHwModel = mergeHwModelOnContactUpdate('Repeater', newHwModelFromAdvert);
    expect(mergedHwModel).toBe('Repeater');
    expect(meshcoreContactTypeFromHwModel(mergedHwModel)).toBe(2);
  });

  it('preserves Repeater when firmware advert reports None (type 0)', () => {
    const mergedHwModel = mergeHwModelOnContactUpdate('Repeater', 'None');
    expect(mergedHwModel).toBe('Repeater');
  });
});
