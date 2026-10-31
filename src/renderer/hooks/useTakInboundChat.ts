import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  TakChatChannel,
  TakDirectPeer,
  TakDmProtocol,
  TakIncidentMarker,
} from '@/shared/tak-types';

import { errLikeToLogString } from '../lib/errLikeToLogString';
import { listTakConversationPeers, listTakDmProtocols } from '../lib/tak/takDirectMessages';
import { startTakDmStatus } from '../lib/tak/takDmStatus';
import { enqueueTakChatRelay } from '../lib/tak/takInboundChat';
import {
  resetTakIncidentAlarms,
  type TakIncidentAlarm,
  takIncidentMarkers,
} from '../lib/tak/takIncidentMarkers';
import { setTakMecpLocale } from '../lib/tak/takMecpText';
import { sendTakTextOnMesh } from '../lib/tak/takMeshSend';
import {
  listTakServedChannels,
  meshcoreTakChannels,
  meshtasticTakChannels,
  toTakChatChannels,
} from '../lib/tak/takServedChannels';
import type { IdentityId } from '../lib/types';
import { useConnectionStore } from '../stores/connectionStore';
import { useIncidentStore } from '../stores/incidentStore';
import { mecpBlockKey, useMecpBlockStore } from '../stores/mecpBlockStore';
import { useMessageStore } from '../stores/messageStore';
import { useNodeStore } from '../stores/nodeStore';
import { setTakChannels, setTakRadio, type TakChannelInfo } from '../stores/takChannelStore';
import {
  bindTakPendingSlots,
  getTakRetiredRooms,
  useTakRelayPrefsStore,
} from '../stores/takRelayPrefsStore';
import { useTakSinkStore } from '../stores/takSinkStore';

/** First wait before re-sending a refused channel list; it doubles up to the maximum. */
export const TAK_SEND_ROOMS_RETRY_MS = 5_000;
export const TAK_SEND_ROOMS_RETRY_MAX_MS = 60_000;

/**
 * Keep main told a setting while a sink is up: `value` (JSON) is sent whenever a sink starts or
 * it changes. A refused update (main's rate limit, say) would leave main with an old value, so it
 * is retried, waiting longer each time, until it lands or a newer value or unmount replaces it.
 */
function useSendWhileSinkActive(
  sinkActive: boolean,
  valueJson: string,
  send: (value: unknown) => Promise<void>,
  label: string,
): void {
  useEffect(() => {
    // Main keeps the setting only while a sink exists, so it is sent again whenever one starts.
    if (!sinkActive) return;
    const value: unknown = JSON.parse(valueJson);
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let delayMs = TAK_SEND_ROOMS_RETRY_MS;
    const attempt = (): void => {
      send(value).catch((e: unknown) => {
        if (cancelled) return;
        console.warn(`[TakInboundChat] ${label} failed; retrying ` + errLikeToLogString(e));
        retryTimer = setTimeout(attempt, delayMs);
        delayMs = Math.min(delayMs * 2, TAK_SEND_ROOMS_RETRY_MAX_MS);
      });
    };
    attempt();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [sinkActive, valueJson, send, label]);
}

const sendChatChannels = (value: unknown): Promise<void> =>
  window.electronAPI.tak.setChatChannels(value as TakChatChannel[]);
const sendDirectMessaging = (value: unknown): Promise<void> =>
  window.electronAPI.tak.setDirectMessaging(value as TakDmProtocol[]);
const sendDirectPeers = (value: unknown): Promise<void> =>
  window.electronAPI.tak.setDirectPeers(value as TakDirectPeer[]);
const sendIncidentMarkers = (value: unknown): Promise<void> =>
  window.electronAPI.tak.setIncidentMarkers(value as TakIncidentMarker[]);

/** Each radio's identity and its runtime channel list, as App has them. */
export interface TakChannelSources {
  meshcore: { identityId: IdentityId | null; channels: readonly unknown[] };
  meshtastic: { identityId: IdentityId | null; channelConfigs: readonly unknown[] };
  /** The Reticulum identity, whose LXMF peers TAK clients may message; it has no channels. */
  reticulum?: { identityId: IdentityId | null };
}

/**
 * Serves mesh channels and direct messages to TAK clients. Publishes each radio's channels (with
 * their ATAK names) for the TAK panel and the relay, and which radio TAK uses per protocol; keeps
 * main told which channels are served and which radios take direct messages; and sends what TAK
 * clients write to a channel or a companion out on the mesh, one message at a time in arrival
 * order. Mount once from AppContent.
 */
export function useTakInboundChat(sources: TakChannelSources): void {
  const meshcoreId = sources.meshcore.identityId;
  const meshcoreChannels = sources.meshcore.channels;
  const meshtasticId = sources.meshtastic.identityId;
  const meshtasticConfigs = sources.meshtastic.channelConfigs;
  const reticulumId = sources.reticulum?.identityId ?? null;

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

  // Settings saved by slot before an upgrade go to the channels now in those slots.
  useEffect(() => {
    if (!meshcoreId) return;
    bindTakPendingSlots(meshcoreId, meshcoreInfos);
    setTakChannels(meshcoreId, meshcoreInfos);
  }, [meshcoreId, meshcoreInfos]);

  // Tell each device how its direct messages went, as their automatic resends settle.
  useEffect(() => startTakDmStatus(), []);

  useEffect(() => {
    setTakRadio('meshcore', meshcoreId);
    setTakRadio('meshtastic', meshtasticId);
    setTakRadio('reticulum', reticulumId);
  }, [meshcoreId, meshtasticId, reticulumId]);

  useEffect(() => {
    if (!meshtasticId) return;
    bindTakPendingSlots(meshtasticId, meshtasticInfos);
    setTakChannels(meshtasticId, meshtasticInfos);
  }, [meshtasticId, meshtasticInfos]);

  useEffect(() => {
    return window.electronAPI.tak.onInboundChat((message) => {
      void enqueueTakChatRelay(message, sendTakTextOnMesh);
    });
  }, []);

  const sinkActive = useTakSinkStore((s) => s.active);
  const { t, i18n } = useTranslation();
  // MECP reports reach TAK clients in the app's language; its pack loads on demand, and the
  // incident markers are written again once it has.
  const [mecpLocaleLoads, setMecpLocaleLoads] = useState(0);
  useEffect(() => {
    if (!sinkActive) return;
    let cancelled = false;
    void setTakMecpLocale(i18n.language, (key, opts) => t(key, opts)).then(() => {
      if (!cancelled) setMecpLocaleLoads((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [sinkActive, i18n.language, t]);

  // Open MECP emergencies with a position, as markers on TAK clients' maps; a MAYDAY's marker
  // also sounds ATAK's emergency alarm when the user has turned it on.
  const incidents = useIncidentStore((s) => s.incidents);
  const mecpAlarm = useTakRelayPrefsStore((s) => s.mecpAlarm);
  const blockedSenders = useMecpBlockStore((s) => s.blocked);
  const incidentMarkers = useMemo(() => {
    // Only built while a sink is up: nothing is sent otherwise.
    if (!sinkActive) {
      // Main forgets the alarms with the sink; a MAYDAY still unseen sounds again with the next.
      resetTakIncidentAlarms();
      return [];
    }
    const alarm: TakIncidentAlarm | undefined = mecpAlarm
      ? {
          isBlocked: (incident) =>
            incident.protocolsSeen.some((protocol) =>
              Object.hasOwn(blockedSenders, mecpBlockKey(protocol, incident.senderId)),
            ),
        }
      : undefined;
    return takIncidentMarkers(incidents, alarm);
    // The markers' words follow the app's language once its pack has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mecpLocaleLoads only triggers a rebuild.
  }, [sinkActive, incidents, mecpLocaleLoads, mecpAlarm, blockedSenders]);
  const incidentMarkersJson = useMemo(() => JSON.stringify(incidentMarkers), [incidentMarkers]);
  useSendWhileSinkActive(
    sinkActive,
    incidentMarkersJson,
    sendIncidentMarkers,
    'setIncidentMarkers',
  );
  // Main forgets the markers when its sinks stop, but a server error can leave it reporting
  // stopped with devices still connected. Clear the list then too, so their markers go and a
  // MAYDAY alarm is cancelled rather than left sounding.
  const wasSinkActive = useRef(sinkActive);
  useEffect(() => {
    if (wasSinkActive.current && !sinkActive) {
      sendIncidentMarkers([]).catch((e: unknown) => {
        console.warn('[TakInboundChat] setIncidentMarkers failed ' + errLikeToLogString(e));
      });
    }
    wasSinkActive.current = sinkActive;
  }, [sinkActive]);
  const relayPrefs = useTakRelayPrefsStore((s) => s.byIdentity);

  // For a day after an upgrade, ATAK devices are told to drop the old GeoChat room contacts.
  const retiredRooms = useTakRelayPrefsStore((s) => s.retiredRooms);
  useEffect(() => {
    const rooms = getTakRetiredRooms();
    if (!sinkActive || rooms.length === 0) return;
    window.electronAPI.tak.retireChatRooms(rooms).catch((e: unknown) => {
      console.warn('[TakInboundChat] retireChatRooms failed ' + errLikeToLogString(e));
    });
  }, [sinkActive, retiredRooms]);
  // The stores change for many reasons that leave the served list alone. Keying the effect on
  // the list's contents sends main one update per real change, well inside its rate limit.
  const channelsJson = useMemo(
    () => JSON.stringify(toTakChatChannels(listTakServedChannels(channelsByIdentity, relayPrefs))),
    [channelsByIdentity, relayPrefs],
  );
  useSendWhileSinkActive(sinkActive, channelsJson, sendChatChannels, 'setChatChannels');

  const dmJson = useMemo(() => {
    const radios: Partial<Record<TakDmProtocol, IdentityId>> = {};
    if (meshcoreId) radios.meshcore = meshcoreId;
    if (meshtasticId) radios.meshtastic = meshtasticId;
    if (reticulumId) radios.reticulum = reticulumId;
    return JSON.stringify(listTakDmProtocols(radios, relayPrefs));
  }, [meshcoreId, meshtasticId, reticulumId, relayPrefs]);
  useSendWhileSinkActive(sinkActive, dmJson, sendDirectMessaging, 'setDirectMessaging');

  // LXMF peers with a conversation in mesh-client, so ATAK can carry it on with peers that
  // have no marker. Worked out only while TAK is up and the Reticulum radio takes DMs.
  const reticulumDms =
    reticulumId !== null && sinkActive && relayPrefs[reticulumId]?.directMessages;
  const reticulumMessages = useMessageStore((s) =>
    reticulumDms && reticulumId ? s.messages[reticulumId] : undefined,
  );
  const reticulumNodes = useNodeStore((s) =>
    reticulumDms && reticulumId ? s.nodes[reticulumId] : undefined,
  );
  const reticulumSelf = useConnectionStore((s) =>
    reticulumId ? (s.connections[reticulumId]?.myNodeNum ?? 0) : 0,
  );
  const peersJson = useMemo(
    () =>
      JSON.stringify(
        reticulumDms
          ? listTakConversationPeers(reticulumMessages, reticulumNodes, reticulumSelf)
          : [],
      ),
    [reticulumDms, reticulumMessages, reticulumNodes, reticulumSelf],
  );
  useSendWhileSinkActive(sinkActive, peersJson, sendDirectPeers, 'setDirectPeers');
}
