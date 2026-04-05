import { describe, expect, it } from 'vitest';

import {
  countMeshcoreContactsWithFlagMask,
  enrichMeshCoreSelfInfo,
  MESHCORE_CONTACT_FLAG_TELEM_BASE,
  MESHCORE_CONTACT_FLAG_TELEM_ENVIRONMENT,
  MESHCORE_CONTACT_FLAG_TELEM_LOCATION,
  MESHCORE_TELEM_MODE_ALLOW_ALL,
  MESHCORE_TELEM_MODE_ALLOW_FLAGS,
  MESHCORE_TELEM_MODE_DENY,
  packMeshcoreTelemetryModesByte,
  parseMeshcoreSelfInfoTelemetry,
  unpackMeshcoreTelemetryModesByte,
} from './meshcoreTelemetryPrivacy';

describe('meshcoreTelemetryPrivacy', () => {
  it('packs and unpacks telemetry mode byte like companion firmware', () => {
    const packed = packMeshcoreTelemetryModesByte(
      MESHCORE_TELEM_MODE_ALLOW_FLAGS,
      MESHCORE_TELEM_MODE_DENY,
      MESHCORE_TELEM_MODE_ALLOW_ALL,
    );
    expect(unpackMeshcoreTelemetryModesByte(packed)).toEqual({
      telemetryModeBase: MESHCORE_TELEM_MODE_ALLOW_FLAGS,
      telemetryModeLoc: MESHCORE_TELEM_MODE_DENY,
      telemetryModeEnv: MESHCORE_TELEM_MODE_ALLOW_ALL,
    });
  });

  it('parseMeshcoreSelfInfoTelemetry reads third reserved byte', () => {
    const reserved = new Uint8Array([2, 1, packMeshcoreTelemetryModesByte(1, 2, 0)]);
    const p = parseMeshcoreSelfInfoTelemetry(reserved);
    expect(p.multiAcks).toBe(2);
    expect(p.advertLocPolicy).toBe(1);
    expect(p.telemetryModeBase).toBe(1);
    expect(p.telemetryModeLoc).toBe(2);
    expect(p.telemetryModeEnv).toBe(0);
  });

  it('enrichMeshCoreSelfInfo merges manual add and telemetry fields', () => {
    const r = new Uint8Array([0, 0, packMeshcoreTelemetryModesByte(2, 2, 2)]);
    const e = enrichMeshCoreSelfInfo({
      name: 'N',
      publicKey: new Uint8Array(32),
      type: 1,
      txPower: 10,
      advLat: 0,
      advLon: 0,
      reserved: r,
      manualAddContacts: 1,
      radioFreq: 915000,
    });
    expect(e.manualAddContacts).toBe(true);
    expect(e.telemetryModeBase).toBe(2);
    expect(e.telemetryModeLoc).toBe(2);
    expect(e.telemetryModeEnv).toBe(2);
  });

  it('countMeshcoreContactsWithFlagMask counts contacts with any flag bit set', () => {
    const contacts = [
      { flags: 0x02 },
      { flags: 0x03 },
      { flags: 0x04 },
      { flags: 0x08 },
      { flags: 0 },
    ];
    expect(countMeshcoreContactsWithFlagMask(contacts, MESHCORE_CONTACT_FLAG_TELEM_BASE)).toBe(2);
    expect(countMeshcoreContactsWithFlagMask(contacts, MESHCORE_CONTACT_FLAG_TELEM_LOCATION)).toBe(
      1,
    );
    expect(
      countMeshcoreContactsWithFlagMask(contacts, MESHCORE_CONTACT_FLAG_TELEM_ENVIRONMENT),
    ).toBe(1);
  });
});
