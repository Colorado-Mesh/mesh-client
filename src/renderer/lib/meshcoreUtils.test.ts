import { beforeEach, describe, expect, it } from 'vitest';

import {
  coerceMeshcoreExportPrivateKeyResult,
  isMeshcoreContactEligibleForUserGroup,
  isMeshcoreTransportStatusChatLine,
  mergeHwModelOnContactUpdate,
  mergeMeshcoreChatStubNodes,
  MESHCORE_CHANNEL_NAME_MAX_LEN,
  MESHCORE_CONTACTS_CRITICAL_THRESHOLD,
  MESHCORE_CONTACTS_WARNING_THRESHOLD,
  meshcoreAppendRepeaterAuthHint,
  meshcoreApplyRepeaterSessionAuth,
  meshcoreApplyRepeaterSessionAuthSkip,
  meshcoreChatStubNodeIdFromDisplayName,
  meshcoreClearRepeaterRemoteSessionAuth,
  meshcoreConnectionImpliesUsbPower,
  meshcoreContactToMeshNode,
  meshcoreContactTypeFromHwModel,
  meshcoreDeriveChannelKeyHexFromName,
  meshcoreGetRepeaterSessionPassword,
  meshcoreHwModelIsContactTypeLabel,
  meshcoreInferHopsFromOutPath,
  meshcoreIsPlaceholderNodeLongName,
  meshcoreIsRepeaterRemoteAuthTouched,
  meshcoreManufacturerModelFromDeviceQuery,
  meshcoreMergeChannelDisplayNameOntoNode,
  meshcoreMergeContactHopsAwayFromPrevious,
  meshcoreMilliVoltsToApproximateBatteryPercent,
  meshcoreMinimalNodeFromAdvertEvent,
  meshcoreResolvedTxPowerMax,
  meshcoreScaledAdvLatLonToDeg,
  meshcoreSelfInfoBwToDisplayKhz,
  meshcoreSelfInfoFreqToDisplayHz,
  meshcoreSliceContactOutPathForTrace,
  meshcoreTelemetryGpsAltitudeMeters,
  meshcoreTracePathLenToHops,
  minimalMeshcoreChatNode,
  pubkeyToNodeId,
  resolveMeshcoreRoomLoginHopsAway,
  sanitizeMeshcoreChatWireText,
} from './meshcoreUtils';

describe('MeshCore contact capacity thresholds', () => {
  it('critical is stricter than warning (closer to radio max)', () => {
    expect(MESHCORE_CONTACTS_CRITICAL_THRESHOLD).toBeGreaterThan(
      MESHCORE_CONTACTS_WARNING_THRESHOLD,
    );
  });
});

describe('meshcoreResolvedTxPowerMax', () => {
  it('uses firmware maxTxPower when present', () => {
    expect(meshcoreResolvedTxPowerMax({ maxTxPower: 14 })).toEqual({ max: 14, fromFirmware: true });
  });

  it('falls back when maxTxPower is missing', () => {
    expect(meshcoreResolvedTxPowerMax({})).toEqual({ max: 22, fromFirmware: false });
  });
});

describe('meshcoreScaledAdvLatLonToDeg', () => {
  it('maps non-zero scaled integers to degrees', () => {
    const r = meshcoreScaledAdvLatLonToDeg(45_123456, -93_654321);
    expect(r.lat).toBeCloseTo(45.123456, 6);
    expect(r.lon).toBeCloseTo(-93.654321, 6);
  });

  it('returns null per axis for zero on either axis', () => {
    expect(meshcoreScaledAdvLatLonToDeg(0, 0)).toEqual({ lat: null, lon: null });
    expect(meshcoreScaledAdvLatLonToDeg(1_000000, 0)).toEqual({ lat: null, lon: null });
    expect(meshcoreScaledAdvLatLonToDeg(0, -2_000000)).toEqual({ lat: null, lon: null });
  });

  it('returns null for non-finite or out-of-range inputs', () => {
    expect(meshcoreScaledAdvLatLonToDeg(Number.NaN, 1)).toEqual({ lat: null, lon: null });
    expect(meshcoreScaledAdvLatLonToDeg(1, Number.POSITIVE_INFINITY)).toEqual({
      lat: null,
      lon: null,
    });
    expect(meshcoreScaledAdvLatLonToDeg(Number.POSITIVE_INFINITY, 1)).toEqual({
      lat: null,
      lon: null,
    });
    expect(meshcoreScaledAdvLatLonToDeg(2147483647, 45_000000)).toEqual({
      lat: null,
      lon: null,
    });
  });
});

describe('meshcoreTelemetryGpsAltitudeMeters', () => {
  it('returns finite altitude in meters', () => {
    expect(meshcoreTelemetryGpsAltitudeMeters({ latitude: 1, longitude: 2, altitude: 1600 })).toBe(
      1600,
    );
    expect(meshcoreTelemetryGpsAltitudeMeters({ altitude: 0 })).toBe(0);
  });

  it('returns undefined when missing or invalid', () => {
    expect(meshcoreTelemetryGpsAltitudeMeters(undefined)).toBeUndefined();
    expect(meshcoreTelemetryGpsAltitudeMeters(null)).toBeUndefined();
    expect(meshcoreTelemetryGpsAltitudeMeters({})).toBeUndefined();
    expect(meshcoreTelemetryGpsAltitudeMeters({ altitude: Number.NaN })).toBeUndefined();
    expect(
      meshcoreTelemetryGpsAltitudeMeters({ altitude: Number.POSITIVE_INFINITY }),
    ).toBeUndefined();
  });
});

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

  it('clamps future lastAdvert to nowSec', () => {
    const nowSec = 1_700_000_000;
    const r = meshcoreMinimalNodeFromAdvertEvent(key32, {
      nowSec,
      lastAdvert: nowSec + 86_400,
    });
    expect(r!.lastHeardSec).toBe(nowSec);
    expect(r!.node.last_heard).toBe(nowSec);
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

  it('detects path hash hop summary lines', () => {
    expect(
      isMeshcoreTransportStatusChatLine(
        '[111b] @[🏴‍☠️CatDude AF5F] | 5 hops, 2-byte hashes, SNR 12.00 | recv 21:56:11',
      ),
    ).toBe(true);
  });
});

describe('sanitizeMeshcoreChatWireText', () => {
  it('truncates at first NUL and drops binary tail bytes', () => {
    const tail = String.fromCharCode(0x93, 0x6c, 0x73, 0x49);
    expect(sanitizeMeshcoreChatWireText(`called wadamesh\u0000${tail}`)).toBe('called wadamesh');
  });

  it('preserves sender prefix when stripping channel wire tail', () => {
    const tail = String.fromCharCode(0x93, 0x6c, 0x73, 0x49);
    expect(sanitizeMeshcoreChatWireText(`LLAP 🖖 TD: called wadamesh\u0000${tail}`)).toBe(
      'LLAP 🖖 TD: called wadamesh',
    );
  });

  it('leaves emoji and Unicode messages unchanged', () => {
    expect(sanitizeMeshcoreChatWireText('Hello 🌍 v2.0')).toBe('Hello 🌍 v2.0');
  });

  it('strips trailing replacement characters without NUL', () => {
    expect(sanitizeMeshcoreChatWireText('hello\uFFFD\uFFFD')).toBe('hello');
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

describe('meshcoreHwModelIsContactTypeLabel', () => {
  it('is true for MeshCore contact-type hw_model strings', () => {
    expect(meshcoreHwModelIsContactTypeLabel('Chat')).toBe(true);
    expect(meshcoreHwModelIsContactTypeLabel('Repeater')).toBe(true);
    expect(meshcoreHwModelIsContactTypeLabel('Room')).toBe(true);
    expect(meshcoreHwModelIsContactTypeLabel('Sensor')).toBe(true);
  });

  it('is false for None, unset hw_model, and Meshtastic hardware names', () => {
    expect(meshcoreHwModelIsContactTypeLabel('None')).toBe(false);
    expect(meshcoreHwModelIsContactTypeLabel(undefined)).toBe(false);
    expect(meshcoreHwModelIsContactTypeLabel('')).toBe(false);
    expect(meshcoreHwModelIsContactTypeLabel('T-Echo')).toBe(false);
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

  it('derives key for long hashtag channel names', async () => {
    const hex = await meshcoreDeriveChannelKeyHexFromName('#breakingnews');
    expect(hex).toBe('8c886da2295a9cb0de02299cb6c8598e');
  });

  it('exports firmware channel name max length', () => {
    expect(MESHCORE_CHANNEL_NAME_MAX_LEN).toBe(31);
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

describe('meshcoreSliceContactOutPathForTrace', () => {
  it('uses firmware length when 0..61', () => {
    const buf = new Uint8Array([1, 2, 3, 0, 0]);
    expect(meshcoreSliceContactOutPathForTrace(buf, 2)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('outPathLen 0 yields first byte only (firmware direct / length-zero semantics)', () => {
    const buf = new Uint8Array([9, 8, 7, 0, 0]);
    expect(meshcoreSliceContactOutPathForTrace(buf, 0)).toEqual(new Uint8Array([9]));
  });

  it('trims trailing zeros when outPathLen is negative (e.g. -1)', () => {
    const buf = new Uint8Array([10, 20, 30, 0, 0, 0]);
    expect(meshcoreSliceContactOutPathForTrace(buf, -1)).toEqual(new Uint8Array([10, 20, 30]));
  });

  it('returns empty when negative length and buffer all zeros', () => {
    const buf = new Uint8Array([0, 0, 0]);
    expect(meshcoreSliceContactOutPathForTrace(buf, -1).length).toBe(0);
  });

  it('treats undefined/null like unset length — trim trailing zeros (same as -1)', () => {
    const buf = new Uint8Array([7, 8, 9]);
    expect(meshcoreSliceContactOutPathForTrace(buf, undefined)).toEqual(new Uint8Array([7, 8, 9]));
    expect(meshcoreSliceContactOutPathForTrace(buf, null)).toEqual(new Uint8Array([7, 8, 9]));
    expect(meshcoreSliceContactOutPathForTrace(new Uint8Array([1, 2, 3, 0, 0]), undefined)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
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

describe('meshcoreInferHopsFromOutPath', () => {
  it('uses trace semantics for valid outPathLen', () => {
    expect(meshcoreInferHopsFromOutPath({ outPathLen: 1 })).toBe(0);
    expect(meshcoreInferHopsFromOutPath({ outPathLen: 3 })).toBe(2);
  });

  it('when outPathLen is 0 but buffer still encodes hops, infers from bytes', () => {
    expect(
      meshcoreInferHopsFromOutPath({ outPathLen: 0, outPath: new Uint8Array([1, 2, 3]) }),
    ).toBe(2);
  });

  it('infers from path bytes when outPathLen is invalid but buffer encodes a multi-hop path', () => {
    const outPath = new Uint8Array([1, 2, 3, 4]);
    expect(meshcoreInferHopsFromOutPath({ outPathLen: -1, outPath })).toBe(3);
  });

  it('returns undefined when path does not imply multiple hops', () => {
    expect(meshcoreInferHopsFromOutPath({ outPathLen: -1, outPath: new Uint8Array([9]) })).toBe(
      undefined,
    );
  });
});

describe('resolveMeshcoreRoomLoginHopsAway', () => {
  it('prefers positive hops_away on the node', () => {
    expect(resolveMeshcoreRoomLoginHopsAway({ hops_away: 4 }, new Uint8Array([1, 2]))).toBe(4);
  });

  it('infers from outPath when UI reports 0 hops', () => {
    const outPath = new Uint8Array([1, 2, 3, 4]);
    expect(resolveMeshcoreRoomLoginHopsAway({ hops_away: 0 }, outPath)).toBe(3);
  });

  it('returns 0 for direct room with no path', () => {
    expect(resolveMeshcoreRoomLoginHopsAway({ hops_away: 0 }, undefined)).toBe(0);
  });
});

describe('meshcoreMergeContactHopsAwayFromPrevious', () => {
  it('preserves multi-hop when radio briefly reports 0 hops with empty path', () => {
    expect(meshcoreMergeContactHopsAwayFromPrevious(0, 3, 1)).toBe(3);
  });

  it('preserves multi-hop when inferred is 0 even if path slice length > 1 (transient direct)', () => {
    expect(meshcoreMergeContactHopsAwayFromPrevious(0, 3, 4)).toBe(3);
  });

  it('preserves multi-hop when inferred hops are undefined', () => {
    expect(meshcoreMergeContactHopsAwayFromPrevious(undefined, 2, 0)).toBe(2);
  });

  it('allows a better inferred hop count when path bytes support it', () => {
    expect(meshcoreMergeContactHopsAwayFromPrevious(2, 3, 4)).toBe(2);
  });

  it('favors smaller hop count when both are defined (best known path)', () => {
    expect(meshcoreMergeContactHopsAwayFromPrevious(3, 1, 4)).toBe(1);
    expect(meshcoreMergeContactHopsAwayFromPrevious(1, 3, 2)).toBe(1);
  });

  it('fills from previous when inferred is undefined and prev is direct', () => {
    expect(meshcoreMergeContactHopsAwayFromPrevious(undefined, 0, 1)).toBe(0);
  });
});

describe('meshcoreContactToMeshNode', () => {
  const key32 = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key32[i] = (i * 11 + 3) & 0xff;

  it('sets hops_away from inferred path length', () => {
    const node = meshcoreContactToMeshNode({
      publicKey: key32,
      type: 1,
      advName: 'A',
      lastAdvert: 100,
      advLat: 0,
      advLon: 0,
      outPathLen: 2,
    });
    expect(node.hops_away).toBe(1);
  });

  it('infers hops from outPath when outPathLen is unset', () => {
    const node = meshcoreContactToMeshNode({
      publicKey: key32,
      type: 1,
      advName: 'A',
      lastAdvert: 100,
      advLat: 0,
      advLon: 0,
      outPathLen: -1,
      outPath: new Uint8Array([1, 2, 3]),
    });
    expect(node.hops_away).toBe(2);
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

  it('stops at first null and drops firmware tail from meshcore.js readString() remainder', () => {
    expect(
      meshcoreManufacturerModelFromDeviceQuery({
        manufacturerModel: 'Seeed Wio Tracker L1\u0000\u0000\u0000v1.15.0-dee3e26\u0000\u0000',
      }),
    ).toBe('Seeed Wio Tracker L1');
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

describe('meshcoreMergeChannelDisplayNameOntoNode', () => {
  it('replaces Node-HEX placeholder with channel display name', () => {
    const nodeId = meshcoreChatStubNodeIdFromDisplayName('10th mountain division');
    const device = meshcoreContactToMeshNode({
      publicKey: new Uint8Array(32).fill(1),
      type: 0,
      advName: '',
      lastAdvert: 0,
      advLat: 0,
      advLon: 0,
    });
    const withId = {
      ...device,
      node_id: nodeId,
      long_name: `Node-${nodeId.toString(16).toUpperCase()}`,
    };
    const merged = meshcoreMergeChannelDisplayNameOntoNode(withId, '10th mountain division');
    expect(merged.long_name).toBe('10th mountain division');
  });

  it('mergeMeshcoreChatStubNodes applies channel name on stub/device id collision', () => {
    const nodeId = meshcoreChatStubNodeIdFromDisplayName('10th mountain division');
    const device = new Map([
      [
        nodeId,
        {
          ...minimalMeshcoreChatNode(nodeId, `Node-${nodeId.toString(16).toUpperCase()}`, 1, 'rf'),
          hw_model: 'Unknown',
        },
      ],
    ]);
    const prev = new Map([
      [nodeId, minimalMeshcoreChatNode(nodeId, '10th mountain division', 2, 'rf')],
    ]);
    const merged = mergeMeshcoreChatStubNodes(prev, device);
    expect(merged.get(nodeId)?.long_name).toBe('10th mountain division');
    expect(meshcoreIsPlaceholderNodeLongName(merged.get(nodeId)?.long_name ?? '', nodeId)).toBe(
      false,
    );
  });
});

describe('coerceMeshcoreExportPrivateKeyResult', () => {
  it('unwraps meshcore.js { privateKey } payload', () => {
    const inner = new Uint8Array(64).fill(7);
    expect(coerceMeshcoreExportPrivateKeyResult({ privateKey: inner })).toBe(inner);
  });

  it('accepts raw non-empty Uint8Array', () => {
    const raw = new Uint8Array(32).fill(3);
    expect(coerceMeshcoreExportPrivateKeyResult(raw)).toBe(raw);
  });

  it('returns null for empty or invalid shapes', () => {
    expect(coerceMeshcoreExportPrivateKeyResult(null)).toBeNull();
    expect(coerceMeshcoreExportPrivateKeyResult(undefined)).toBeNull();
    expect(coerceMeshcoreExportPrivateKeyResult(new Uint8Array(0))).toBeNull();
    expect(coerceMeshcoreExportPrivateKeyResult({ privateKey: new Uint8Array(0) })).toBeNull();
    expect(coerceMeshcoreExportPrivateKeyResult({})).toBeNull();
  });
});
