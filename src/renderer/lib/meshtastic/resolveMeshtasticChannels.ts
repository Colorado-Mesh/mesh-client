export interface MeshtasticChannelListItem {
  index: number;
  name: string;
}

/**
 * Resolve the Meshtastic channel list ChatPanel should show.
 *
 * `meshtasticIdentityId` is nulled for the brief gap between disconnect and
 * wire-effect rebind. Without bridging that gap, the caller's hook-local
 * `hookChannels` placeholder (a single generic "Primary" entry) would
 * transiently replace the real device channel list, tripping ChatPanel's
 * invalid-selection clamp and permanently resetting the user's channel
 * selection on every reconnect. `lastKnownChannels` (the caller's cache of
 * the most recently committed real channel list) bridges that gap.
 *
 * A pure function so this logic can be unit-tested directly without mocking
 * the rest of the runtime hook; the caller (`useMeshtasticRuntime`) owns
 * updating the cache, and must do so outside of render (e.g. in an effect) —
 * React may replay or discard a render, so mutating a ref from inside the
 * `useMemo` that calls this function would leak uncommitted state.
 */
export function resolveMeshtasticChannels(params: {
  meshtasticIdentityId: string | null;
  deviceRecordChannels: MeshtasticChannelListItem[] | undefined;
  hookChannels: MeshtasticChannelListItem[];
  lastKnownChannels: MeshtasticChannelListItem[];
}): MeshtasticChannelListItem[] {
  const { meshtasticIdentityId, deviceRecordChannels, hookChannels, lastKnownChannels } = params;
  if (deviceRecordChannels && deviceRecordChannels.length > 0) return deviceRecordChannels;
  if (!meshtasticIdentityId && lastKnownChannels.length > 0) return lastKnownChannels;
  return hookChannels;
}
