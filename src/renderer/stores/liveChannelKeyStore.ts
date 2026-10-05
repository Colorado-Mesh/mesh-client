import { create } from 'zustand';

import type { ChannelIdentityProtocol } from '../../shared/channelIdentityKey';

/** Channel identity keys for the connected radio's slots (see `channelIdentityKey.ts`). */
export interface LiveChannelKeys {
  /** Connected radio node number, or null when not known (e.g. MQTT-only). */
  radioNodeId: number | null;
  keyByIndex: Readonly<Record<number, string>>;
}

interface LiveChannelKeyStoreState {
  byProtocol: Record<ChannelIdentityProtocol, LiveChannelKeys | null>;
}

const defaultState: LiveChannelKeyStoreState = { byProtocol: { meshtastic: null, meshcore: null } };

export const useLiveChannelKeyStore = create<LiveChannelKeyStoreState>()(() => defaultState);

function liveChannelKeysEqual(a: LiveChannelKeys | null, b: LiveChannelKeys | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (a.radioNodeId !== b.radioNodeId) return false;
  const aKeys = Object.keys(a.keyByIndex);
  if (aKeys.length !== Object.keys(b.keyByIndex).length) return false;
  return aKeys.every((k) => a.keyByIndex[Number(k)] === b.keyByIndex[Number(k)]);
}

/** Publish (or clear with null) the connected radio's slot → channel key map. */
export function setLiveChannelKeys(
  protocol: ChannelIdentityProtocol,
  value: LiveChannelKeys | null,
): void {
  useLiveChannelKeyStore.setState((s) => {
    if (liveChannelKeysEqual(s.byProtocol[protocol], value)) return s;
    return { byProtocol: { ...s.byProtocol, [protocol]: value } };
  });
}

export function getLiveChannelKeys(protocol: ChannelIdentityProtocol): LiveChannelKeys | null {
  return useLiveChannelKeyStore.getState().byProtocol[protocol];
}

/** Key for a group-channel slot on the connected radio; null for DMs/rooms or unknown slots. */
export function getLiveChannelKey(protocol: ChannelIdentityProtocol, index: number): string | null {
  if (!Number.isInteger(index) || index < 0) return null;
  return getLiveChannelKeys(protocol)?.keyByIndex[index] ?? null;
}

/** @internal Test helper. */
export function resetLiveChannelKeyStoreForTests(): void {
  useLiveChannelKeyStore.setState(defaultState, true);
}
