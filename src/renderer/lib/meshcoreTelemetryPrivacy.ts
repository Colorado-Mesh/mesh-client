/**
 * MeshCore companion telemetry privacy — maps UI and wire format to firmware semantics.
 * @see meshcore-dev/MeshCore examples/companion_radio/NodePrefs.h
 * @see meshcore-dev/MeshCore examples/companion_radio/MyMesh.cpp (CMD_SET_OTHER_PARAMS, onContactRequest)
 * @see meshcore-dev/MeshCore src/helpers/SensorManager.h (TELEM_PERM_*)
 */

/** NodePrefs.h */
export const MESHCORE_TELEM_MODE_DENY = 0;
export const MESHCORE_TELEM_MODE_ALLOW_FLAGS = 1;
export const MESHCORE_TELEM_MODE_ALLOW_ALL = 2;

/** Contact flags: LSB = favourite; upper bits (after >>1) are TELEM_PERM_* for "specific contacts" mode. */
export const MESHCORE_CONTACT_FLAG_FAVORITE = 0x01;
export const MESHCORE_CONTACT_FLAG_TELEM_BASE = 0x02;
export const MESHCORE_CONTACT_FLAG_TELEM_LOCATION = 0x04;
export const MESHCORE_CONTACT_FLAG_TELEM_ENVIRONMENT = 0x08;

export type MeshcoreTelemetryTriState = 'deny' | 'allow_flags' | 'allow_all';

export function packMeshcoreTelemetryModesByte(base: number, loc: number, env: number): number {
  return (((env & 3) << 4) | ((loc & 3) << 2) | (base & 3)) & 0xff;
}

export function unpackMeshcoreTelemetryModesByte(packed: number): {
  telemetryModeBase: number;
  telemetryModeLoc: number;
  telemetryModeEnv: number;
} {
  const b = packed & 0xff;
  return {
    telemetryModeBase: b & 3,
    telemetryModeLoc: (b >> 2) & 3,
    telemetryModeEnv: (b >> 4) & 3,
  };
}

export function meshcoreTelemetryModeToTriState(mode: number): MeshcoreTelemetryTriState {
  if (mode === MESHCORE_TELEM_MODE_DENY) return 'deny';
  if (mode === MESHCORE_TELEM_MODE_ALLOW_FLAGS) return 'allow_flags';
  return 'allow_all';
}

export function meshcoreTriStateToTelemetryMode(state: MeshcoreTelemetryTriState): number {
  switch (state) {
    case 'deny':
      return MESHCORE_TELEM_MODE_DENY;
    case 'allow_flags':
      return MESHCORE_TELEM_MODE_ALLOW_FLAGS;
    default:
      return MESHCORE_TELEM_MODE_ALLOW_ALL;
  }
}

export function countMeshcoreContactsWithFlagMask(
  contacts: readonly { flags: number }[],
  mask: number,
): number {
  let n = 0;
  for (const c of contacts) {
    if ((c.flags & mask) !== 0) n += 1;
  }
  return n;
}

export interface MeshcoreSelfInfoTelemetryFields {
  multiAcks: number;
  advertLocPolicy: number;
  telemetryModeBase: number;
  telemetryModeLoc: number;
  telemetryModeEnv: number;
}

/** Raw `getSelfInfo` payload from meshcore.js (before normalization). */
export interface MeshCoreSelfInfoWire {
  name: string;
  publicKey: Uint8Array;
  type: number;
  txPower: number;
  maxTxPower?: number;
  advLat: number;
  advLon: number;
  reserved?: Uint8Array;
  manualAddContacts?: number | boolean;
  radioFreq: number;
  radioBw?: number;
  radioSf?: number;
  radioCr?: number;
  batteryMilliVolts?: number;
}

export type MeshCoreSelfInfoEnriched = Omit<
  MeshCoreSelfInfoWire,
  'reserved' | 'manualAddContacts'
> &
  MeshcoreSelfInfoTelemetryFields & { manualAddContacts: boolean };

export function enrichMeshCoreSelfInfo(wire: MeshCoreSelfInfoWire): MeshCoreSelfInfoEnriched {
  const telem = parseMeshcoreSelfInfoTelemetry(wire.reserved);
  const m = wire.manualAddContacts;
  const manualAddContacts = typeof m === 'boolean' ? m : Number(m) !== 0;
  return {
    name: wire.name,
    publicKey: wire.publicKey,
    type: wire.type,
    txPower: wire.txPower,
    maxTxPower: wire.maxTxPower,
    advLat: wire.advLat,
    advLon: wire.advLon,
    radioFreq: wire.radioFreq,
    radioBw: wire.radioBw,
    radioSf: wire.radioSf,
    radioCr: wire.radioCr,
    batteryMilliVolts: wire.batteryMilliVolts,
    manualAddContacts,
    ...telem,
  };
}

/**
 * Parse companion SelfInfo tail fields from meshcore.js `reserved` (3 bytes) + manualAddContacts.
 * v7+ firmware: [multi_acks, advert_loc_policy, telemetry_modes_packed].
 */
export function parseMeshcoreSelfInfoTelemetry(
  reserved: Uint8Array | undefined,
  defaults: Partial<MeshcoreSelfInfoTelemetryFields> = {},
): MeshcoreSelfInfoTelemetryFields {
  if (reserved && reserved.length >= 3) {
    const { telemetryModeBase, telemetryModeLoc, telemetryModeEnv } =
      unpackMeshcoreTelemetryModesByte(reserved[2]);
    return {
      multiAcks: reserved[0],
      advertLocPolicy: reserved[1],
      telemetryModeBase,
      telemetryModeLoc,
      telemetryModeEnv,
    };
  }
  return {
    multiAcks: defaults.multiAcks ?? 0,
    advertLocPolicy: defaults.advertLocPolicy ?? 0,
    telemetryModeBase: defaults.telemetryModeBase ?? MESHCORE_TELEM_MODE_ALLOW_ALL,
    telemetryModeLoc: defaults.telemetryModeLoc ?? MESHCORE_TELEM_MODE_ALLOW_ALL,
    telemetryModeEnv: defaults.telemetryModeEnv ?? MESHCORE_TELEM_MODE_ALLOW_ALL,
  };
}

/** Companion `CMD_SET_OTHER_PARAMS` (meshcore-dev/MeshCore MyMesh.cpp). */
export const MESHCORE_CMD_SET_OTHER_PARAMS = 38;

/** CMD_SET_OTHER_PARAMS extended frame (v5+ firmware): manual, telemetry packed, advert loc policy, multi-acks. */
export function buildMeshcoreSetOtherParamsFrame(
  manualAddContacts: number,
  telemetryModesByte: number,
  advertLocPolicy: number,
  multiAcks: number,
): Uint8Array {
  const out = new Uint8Array(5);
  out[0] = MESHCORE_CMD_SET_OTHER_PARAMS;
  out[1] = manualAddContacts & 0xff;
  out[2] = telemetryModesByte & 0xff;
  out[3] = advertLocPolicy & 0xff;
  out[4] = multiAcks & 0xff;
  return out;
}
