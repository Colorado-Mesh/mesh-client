import { useEffect, useMemo } from 'react';

import type { ChannelIdentityProtocol } from '../../shared/channelIdentityKey';
import { backfillChannelKeysForLiveRadio } from '../lib/channelKeyBackfill';
import { errLikeToLogString } from '../lib/errLikeToLogString';
import { hydrateIdentityStoresFromDb } from '../lib/hydrateIdentityStoresFromDb';
import type { IdentityId } from '../lib/types';
import { type LiveChannelKeys, setLiveChannelKeys } from '../stores/liveChannelKeyStore';

export interface UseLiveChannelKeysSyncOptions {
  protocol: ChannelIdentityProtocol;
  identityId: IdentityId | null;
  /** Connected radio node number (0 / null when unknown, e.g. MQTT-only). */
  radioNodeId: number | null | undefined;
  /** Slot → channel identity key for the radio's current channel list. */
  keyByIndex: Readonly<Record<number, string>>;
}

/**
 * Publishes the connected radio's slot → channel key map (used to stamp writes and remap history
 * in the UI), then stamps that radio's unkeyed SQLite history and re-hydrates it so the new keys
 * reach the message store.
 */
export function useLiveChannelKeysSync({
  protocol,
  identityId,
  radioNodeId,
  keyByIndex,
}: UseLiveChannelKeysSyncOptions): void {
  const radio = radioNodeId != null && radioNodeId > 0 ? radioNodeId : null;
  const keySignature = useMemo(
    () =>
      Object.entries(keyByIndex)
        .map(([index, key]) => `${index}=${key}`)
        .sort()
        .join(','),
    [keyByIndex],
  );

  useEffect(() => {
    const entries = keySignature ? keySignature.split(',') : [];
    const map: Record<number, string> = {};
    for (const entry of entries) {
      const [index, key] = entry.split('=');
      if (index != null && key) map[Number(index)] = key;
    }
    const live: LiveChannelKeys | null =
      radio != null || entries.length > 0 ? { radioNodeId: radio, keyByIndex: map } : null;
    setLiveChannelKeys(protocol, live);
    if (!live || radio == null || entries.length === 0) return;

    let cancelled = false;
    void backfillChannelKeysForLiveRadio(protocol, live)
      .then((changes) => {
        if (cancelled || changes === 0 || !identityId) return;
        return hydrateIdentityStoresFromDb(protocol, identityId, {
          nodes: false,
          messages: true,
          messagesMode: 'upsert',
        });
      })
      .catch((e: unknown) => {
        console.warn(
          `[useLiveChannelKeysSync] ${protocol} rehydrate failed ` + errLikeToLogString(e),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [protocol, identityId, radio, keySignature]);
}
