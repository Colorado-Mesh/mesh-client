/**
 * Pure helpers for the Meshtastic 2.8 MeshBeacon module config
 * (`ModuleConfig.MeshBeaconConfig`): flag bitfield, message byte budget and
 * broadcast target drafts.
 */
import { ModuleConfig } from '@meshtastic/protobufs';

const Flags = ModuleConfig.ModuleConfig_MeshBeaconConfig_Flags;

export const MESH_BEACON_FLAG_LISTEN: number = Flags.FLAG_LISTEN_ENABLED;
export const MESH_BEACON_FLAG_BROADCAST: number = Flags.FLAG_BROADCAST_ENABLED;
export const MESH_BEACON_FLAG_LEGACY_SPLIT: number = Flags.FLAG_LEGACY_SPLIT;

/** `broadcast_message` nanopb max_size is 61 including the terminator. */
export const MESH_BEACON_MESSAGE_MAX_BYTES = 60;
/** Firmware rejects shorter broadcast intervals. */
export const MESH_BEACON_MIN_INTERVAL_SECS = 3600;
/** Channel table size (`MAX_NUM_CHANNELS`); also bounds the target list. */
export const MESHTASTIC_MAX_CHANNELS = 8;
export const MESH_BEACON_MAX_TARGETS = MESHTASTIC_MAX_CHANNELS;

export interface MeshBeaconFlagState {
  listen: boolean;
  broadcast: boolean;
  legacySplit: boolean;
}

function toUint(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) >>> 0 : 0;
}

export function unpackMeshBeaconFlags(flags: unknown): MeshBeaconFlagState {
  const bits = toUint(flags);
  return {
    listen: (bits & MESH_BEACON_FLAG_LISTEN) !== 0,
    broadcast: (bits & MESH_BEACON_FLAG_BROADCAST) !== 0,
    legacySplit: (bits & MESH_BEACON_FLAG_LEGACY_SPLIT) !== 0,
  };
}

/** Pack toggles into `flags`, keeping any bits this client does not know about. */
export function packMeshBeaconFlags(state: MeshBeaconFlagState, previous: unknown = 0): number {
  const known =
    MESH_BEACON_FLAG_LISTEN | MESH_BEACON_FLAG_BROADCAST | MESH_BEACON_FLAG_LEGACY_SPLIT;
  let bits = toUint(previous) & ~known;
  if (state.listen) bits |= MESH_BEACON_FLAG_LISTEN;
  if (state.broadcast) bits |= MESH_BEACON_FLAG_BROADCAST;
  if (state.legacySplit) bits |= MESH_BEACON_FLAG_LEGACY_SPLIT;
  return bits >>> 0;
}

const utf8 = new TextEncoder();

export function utf8ByteLength(s: string): number {
  return utf8.encode(s).length;
}

/** Truncate to `maxBytes` of UTF-8 without splitting a code point. */
export function clampUtf8Bytes(s: string, maxBytes: number): string {
  if (utf8ByteLength(s) <= maxBytes) return s;
  let out = '';
  let used = 0;
  for (const ch of s) {
    const n = utf8ByteLength(ch);
    if (used + n > maxBytes) break;
    out += ch;
    used += n;
  }
  return out;
}

export function clampMeshBeaconMessage(s: string): string {
  return clampUtf8Bytes(s, MESH_BEACON_MESSAGE_MAX_BYTES);
}

export function clampMeshBeaconInterval(secs: number): number {
  if (!Number.isFinite(secs)) return MESH_BEACON_MIN_INTERVAL_SECS;
  return Math.max(MESH_BEACON_MIN_INTERVAL_SECS, Math.trunc(secs));
}

/**
 * Editable broadcast target. `null` means "unset" for the proto3 `optional` fields;
 * `region` 0 (`UNSET`) means "use the running region".
 */
export interface MeshBeaconTargetDraft {
  preset: number | null;
  region: number;
  channelIndex: number | null;
  frequencySlot: number | null;
}

export const EMPTY_MESH_BEACON_TARGET: MeshBeaconTargetDraft = {
  preset: null,
  region: 0,
  channelIndex: null,
  frequencySlot: null,
};

function optionalUint(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : null;
}

export function meshBeaconTargetsFromConfig(raw: unknown): MeshBeaconTargetDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MESH_BEACON_MAX_TARGETS).map((entry: unknown) => {
    const t = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    const slot = optionalUint(t.frequencySlot);
    return {
      preset: optionalUint(t.preset),
      region: optionalUint(t.region) ?? 0,
      channelIndex: optionalUint(t.channelIndex),
      frequencySlot: slot === 0 ? null : slot,
    };
  });
}

/** Wire shape for `broadcast_targets`; unset optionals are omitted, never sent as 0 slots. */
export function meshBeaconTargetsToApply(
  drafts: readonly MeshBeaconTargetDraft[],
): Record<string, unknown>[] {
  return drafts.slice(0, MESH_BEACON_MAX_TARGETS).map((d) => {
    const out: Record<string, unknown> = { region: d.region };
    if (d.preset != null) out.preset = d.preset;
    if (d.channelIndex != null) out.channelIndex = d.channelIndex;
    if (d.frequencySlot != null && d.frequencySlot > 0) out.frequencySlot = d.frequencySlot;
    return out;
  });
}

export type MeshBeaconTargetError = 'channelIndexRange' | 'channelNotConfigured' | 'frequencySlot';

/**
 * Validate one target. `configuredChannelIndices` are channel slots with a non-disabled
 * role on the radio; the firmware needs the channel's key to encrypt that copy.
 */
export function validateMeshBeaconTarget(
  d: MeshBeaconTargetDraft,
  configuredChannelIndices: ReadonlySet<number>,
): MeshBeaconTargetError | null {
  if (d.channelIndex != null) {
    if (d.channelIndex < 0 || d.channelIndex >= MESHTASTIC_MAX_CHANNELS) {
      return 'channelIndexRange';
    }
    if (!configuredChannelIndices.has(d.channelIndex)) return 'channelNotConfigured';
  }
  if (d.frequencySlot != null && d.frequencySlot < 1) return 'frequencySlot';
  return null;
}

export interface MeshBeaconOfferChannelSource {
  index: number;
  name: string;
  psk: Uint8Array;
}

/** `broadcast_offer_channel` value copied from one of the radio's channels (name + PSK only). */
export function meshBeaconOfferChannelFrom(
  channel: MeshBeaconOfferChannelSource,
): Record<string, unknown> {
  return { name: channel.name, psk: channel.psk };
}

/** Find which local channel an existing `broadcastOfferChannel` was copied from, if any. */
export function matchMeshBeaconOfferChannel(
  offer: unknown,
  channels: readonly MeshBeaconOfferChannelSource[],
): number | null {
  if (typeof offer !== 'object' || offer === null) return null;
  const o = offer as { name?: unknown; psk?: unknown };
  const name = typeof o.name === 'string' ? o.name : '';
  const psk = o.psk instanceof Uint8Array ? o.psk : new Uint8Array();
  if (name === '' && psk.length === 0) return null;
  const hit = channels.find(
    (c) =>
      c.name === name && c.psk.length === psk.length && c.psk.every((byte, i) => byte === psk[i]),
  );
  return hit ? hit.index : null;
}
