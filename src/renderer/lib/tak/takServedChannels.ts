import { computeChannelIdentityKey } from '@/shared/channelIdentityKey';
import type { TakChatChannel } from '@/shared/tak-types';

import { type TakChannelInfo, useTakChannelStore } from '../../stores/takChannelStore';
import { type TakRelayIdentityPrefs, useTakRelayPrefsStore } from '../../stores/takRelayPrefsStore';
import { MESHCORE_UNCONFIGURED_CHANNEL_SECRET_HEX } from '../meshcoreConfiguredChatChannels';
import { resolveMeshtasticMqttChannelName } from '../meshtasticMqttPublish';
import type { IdentityId } from '../types';
import {
  meshcoreChannelKind,
  meshtasticChannelKind,
  takChannelContactName,
} from './takChannelNames';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function isSlot(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * MeshCore runtime channels (`{ index, name, secret }`) as TAK channels. Unset slots (no name,
 * or the all-zero key) are left out, as Chat leaves them out.
 */
export function meshcoreTakChannels(channels: readonly unknown[]): TakChannelInfo[] {
  const out: TakChannelInfo[] = [];
  const seen = new Set<number>();
  for (const ch of channels) {
    const rec = asRecord(ch);
    if (!rec) continue;
    const { index, name, secret } = rec;
    if (!isSlot(index) || seen.has(index) || typeof name !== 'string' || !name.trim()) continue;
    if (!(secret instanceof Uint8Array) || secret.length !== 16) continue;
    if (hex(secret) === MESHCORE_UNCONFIGURED_CHANNEL_SECRET_HEX) continue;
    seen.add(index);
    const kind = meshcoreChannelKind(name, secret);
    out.push({
      protocol: 'meshcore',
      index,
      key: computeChannelIdentityKey('meshcore', name, secret),
      name: name.trim(),
      atakName: takChannelContactName('meshcore', kind, name),
    });
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * Meshtastic channel configs (`{ index, name, role, psk }`) as TAK channels. Disabled slots are
 * left out; an unnamed primary takes the name mesh-client gives it elsewhere (`LongFast`), and
 * any other unnamed slot keeps an empty name for the panel to label.
 */
export function meshtasticTakChannels(channelConfigs: readonly unknown[]): TakChannelInfo[] {
  const out: TakChannelInfo[] = [];
  const seen = new Set<number>();
  for (const cfg of channelConfigs) {
    const rec = asRecord(cfg);
    if (!rec) continue;
    const { index, name, role, psk } = rec;
    if (!isSlot(index) || seen.has(index) || role === 0 || !(psk instanceof Uint8Array)) continue;
    seen.add(index);
    const rawName = typeof name === 'string' ? name : '';
    const shown = resolveMeshtasticMqttChannelName({
      index,
      name: rawName,
      role: typeof role === 'number' ? role : 1,
      psk,
    });
    out.push({
      protocol: 'meshtastic',
      index,
      key: computeChannelIdentityKey('meshtastic', rawName, psk),
      name: shown,
      // ATAK names are data on the wire, not interface text, so an unnamed slot is not translated.
      atakName: takChannelContactName(
        'meshtastic',
        meshtasticChannelKind(psk),
        shown || `Channel ${index}`,
      ),
    });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** A channel served to TAK clients, on one radio. */
export interface TakServedChannel extends TakChannelInfo {
  identityId: IdentityId;
  /** TAK clients may send to it. */
  send: boolean;
  /** Streamed to the remote TAK server. */
  remote: boolean;
  /** What TAK clients send goes out with their callsign in front. */
  callsign: boolean;
}

/** One radio's channels that its preferences serve to TAK. */
export function servedChannelsFor(
  identityId: IdentityId,
  channels: readonly TakChannelInfo[],
  prefs: TakRelayIdentityPrefs | undefined,
): TakServedChannel[] {
  if (!prefs || prefs.channelMode === 'off') return [];
  const served =
    prefs.channelMode === 'all'
      ? channels
      : channels.filter((c) => prefs.chatChannels.includes(c.key));
  return served.map((c) => ({
    ...c,
    // A name the user chose wins over the automatic one.
    atakName: prefs.atakNames[c.key] ?? c.atakName,
    identityId,
    send: prefs.sendChannels.includes(c.key),
    remote: prefs.remoteChannels.includes(c.key),
    callsign: !prefs.noCallsignChannels.includes(c.key),
  }));
}

/** Every served channel on every radio. Reads the stores unless given their state. */
export function listTakServedChannels(
  channelsByIdentity: Record<IdentityId, readonly TakChannelInfo[]> = useTakChannelStore.getState()
    .channelsByIdentity,
  prefsByIdentity: Record<IdentityId, TakRelayIdentityPrefs> = useTakRelayPrefsStore.getState()
    .byIdentity,
): TakServedChannel[] {
  return Object.entries(channelsByIdentity).flatMap(([identityId, channels]) =>
    servedChannelsFor(identityId, channels, prefsByIdentity[identityId]),
  );
}

/** The served channel in `index` on one radio, if that channel is served. */
export function findServedChannel(
  identityId: IdentityId,
  index: number,
): TakServedChannel | undefined {
  return listTakServedChannels().find((c) => c.identityId === identityId && c.index === index);
}

/**
 * The served channels as main sees them, one per channel key. A channel served on two radios is
 * one ATAK contact: it accepts sends if either radio does, and streams if either does.
 */
export function toTakChatChannels(served: readonly TakServedChannel[]): TakChatChannel[] {
  const byKey = new Map<string, TakChatChannel>();
  for (const c of served) {
    const prev = byKey.get(c.key);
    byKey.set(c.key, {
      key: c.key,
      name: prev?.name ?? c.atakName,
      send: (prev?.send ?? false) || c.send,
      remote: (prev?.remote ?? false) || c.remote,
    });
  }
  return [...byKey.values()];
}
