/**
 * Join planning for a heard MeshBeacon offer. The firmware never applies an offer on
 * its own; these helpers decide what the client may offer the user.
 */
import type { MeshBeaconPayload } from './meshBeaconCodec';
import { MESHTASTIC_MAX_CHANNELS } from './meshBeaconConfig';

interface ChannelSlot {
  index: number;
  name: string;
  role: number;
  psk: Uint8Array;
}

/** `Channel.Role.DISABLED` / `SECONDARY` */
const ROLE_DISABLED = 0;
export const MESHTASTIC_CHANNEL_ROLE_SECONDARY = 2;

function samePsk(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** Index of an active channel already matching the offered name + PSK. */
export function findJoinedChannel(
  channels: readonly ChannelSlot[],
  offer: { name: string; psk: Uint8Array },
): number | null {
  const hit = channels.find(
    (c) => c.role !== ROLE_DISABLED && c.name === offer.name && samePsk(c.psk, offer.psk),
  );
  return hit ? hit.index : null;
}

/** First secondary slot (1..7) that is absent or disabled; the primary is never replaced. */
export function findFreeChannelSlot(channels: readonly ChannelSlot[]): number | null {
  for (let i = 1; i < MESHTASTIC_MAX_CHANNELS; i++) {
    const slot = channels.find((c) => c.index === i);
    if (!slot || slot.role === ROLE_DISABLED) return i;
  }
  return null;
}

export interface MeshtasticLoraSnapshot {
  region?: number;
  modemPreset?: number;
  usePreset?: boolean;
  channelNum?: number;
}

export type MeshBeaconLoraPlan =
  | { kind: 'none' }
  | { kind: 'regionMismatch'; offerRegion: number; localRegion: number }
  | { kind: 'alreadyMatching' }
  | { kind: 'apply'; overrides: Record<string, unknown> };

/**
 * What applying the beacon's radio settings would change. A region switch is only
 * proposed while the local region is still `UNSET`; otherwise a different advertised
 * region blocks the offer (a client must not move the user to another legal band).
 */
export function planMeshBeaconLora(
  beacon: MeshBeaconPayload,
  lora: MeshtasticLoraSnapshot | null | undefined,
): MeshBeaconLoraPlan {
  const hasRadioOffer =
    beacon.offerRegion !== 0 || beacon.offerPreset != null || beacon.offerFrequencySlot != null;
  if (!hasRadioOffer || !lora) return { kind: 'none' };

  const localRegion = lora.region ?? 0;
  const overrides: Record<string, unknown> = {};
  if (beacon.offerRegion !== 0 && beacon.offerRegion !== localRegion) {
    if (localRegion !== 0) {
      return { kind: 'regionMismatch', offerRegion: beacon.offerRegion, localRegion };
    }
    overrides.region = beacon.offerRegion;
  }
  if (beacon.offerPreset != null) {
    if (beacon.offerPreset !== lora.modemPreset || lora.usePreset === false) {
      overrides.modemPreset = beacon.offerPreset;
      overrides.usePreset = true;
    }
  }
  const slot = beacon.offerFrequencySlot ?? 0;
  if (slot !== (lora.channelNum ?? 0)) overrides.channelNum = slot;

  return Object.keys(overrides).length === 0
    ? { kind: 'alreadyMatching' }
    : { kind: 'apply', overrides };
}
