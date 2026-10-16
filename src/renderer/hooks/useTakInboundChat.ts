import { useEffect, useMemo } from 'react';

import type { TakChatChannel } from '@/shared/tak-types';

import { errLikeToLogString } from '../lib/errLikeToLogString';
import { enqueueTakChatRelay } from '../lib/tak/takInboundChat';
import { sendTakTextOnMesh } from '../lib/tak/takMeshSend';
import {
  listTakServedChannels,
  meshcoreTakChannels,
  meshtasticTakChannels,
  toTakChatChannels,
} from '../lib/tak/takServedChannels';
import type { IdentityId } from '../lib/types';
import { setTakChannels, type TakChannelInfo } from '../stores/takChannelStore';
import { useTakRelayPrefsStore } from '../stores/takRelayPrefsStore';
import { useTakSinkStore } from '../stores/takSinkStore';

/** First wait before re-sending a refused channel list; it doubles up to the maximum. */
export const TAK_SEND_ROOMS_RETRY_MS = 5_000;
export const TAK_SEND_ROOMS_RETRY_MAX_MS = 60_000;

/** Each radio's identity and its runtime channel list, as App has them. */
export interface TakChannelSources {
  meshcore: { identityId: IdentityId | null; channels: readonly unknown[] };
  meshtastic: { identityId: IdentityId | null; channelConfigs: readonly unknown[] };
}

/**
 * Serves mesh channels to TAK clients. Publishes each radio's channels (with their ATAK names)
 * for the TAK panel and the relay, keeps main told which channels are served, and sends what TAK
 * clients write to a channel out on the mesh, one message at a time in arrival order.
 * Mount once from AppContent.
 */
export function useTakInboundChat(sources: TakChannelSources): void {
  const meshcoreId = sources.meshcore.identityId;
  const meshcoreChannels = sources.meshcore.channels;
  const meshtasticId = sources.meshtastic.identityId;
  const meshtasticConfigs = sources.meshtastic.channelConfigs;

  const meshcoreInfos = useMemo(() => meshcoreTakChannels(meshcoreChannels), [meshcoreChannels]);
  const meshtasticInfos = useMemo(
    () => meshtasticTakChannels(meshtasticConfigs),
    [meshtasticConfigs],
  );
  // Worked out here rather than read back from the store, so the first list sent to main is
  // already complete: an empty list first would make ATAK drop and re-add every channel contact.
  const channelsByIdentity = useMemo(() => {
    const out: Record<IdentityId, readonly TakChannelInfo[]> = {};
    if (meshcoreId) out[meshcoreId] = meshcoreInfos;
    if (meshtasticId) out[meshtasticId] = meshtasticInfos;
    return out;
  }, [meshcoreId, meshcoreInfos, meshtasticId, meshtasticInfos]);

  useEffect(() => {
    if (meshcoreId) setTakChannels(meshcoreId, meshcoreInfos);
  }, [meshcoreId, meshcoreInfos]);

  useEffect(() => {
    if (meshtasticId) setTakChannels(meshtasticId, meshtasticInfos);
  }, [meshtasticId, meshtasticInfos]);

  useEffect(() => {
    return window.electronAPI.tak.onInboundChat((message) => {
      void enqueueTakChatRelay(message, sendTakTextOnMesh);
    });
  }, []);

  const sinkActive = useTakSinkStore((s) => s.active);
  const relayPrefs = useTakRelayPrefsStore((s) => s.byIdentity);
  // The stores change for many reasons that leave the served list alone. Keying the effect on
  // the list's contents sends main one update per real change, well inside its rate limit.
  const channelsJson = useMemo(
    () => JSON.stringify(toTakChatChannels(listTakServedChannels(channelsByIdentity, relayPrefs))),
    [channelsByIdentity, relayPrefs],
  );
  useEffect(() => {
    // Main keeps the list only while a sink exists, so it is sent again whenever one starts.
    if (!sinkActive) return;
    const channels = JSON.parse(channelsJson) as TakChatChannel[];
    // A refused update (main's rate limit, say) would leave main with an old list, so it is
    // retried, waiting longer each time, until it lands or a newer list or unmount replaces it.
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let delayMs = TAK_SEND_ROOMS_RETRY_MS;
    const send = (): void => {
      window.electronAPI.tak.setChatChannels(channels).catch((e: unknown) => {
        if (cancelled) return;
        console.warn('[TakInboundChat] setChatChannels failed; retrying ' + errLikeToLogString(e));
        retryTimer = setTimeout(send, delayMs);
        delayMs = Math.min(delayMs * 2, TAK_SEND_ROOMS_RETRY_MAX_MS);
      });
    };
    send();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [sinkActive, channelsJson]);
}
