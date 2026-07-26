/**
 * Meshtastic side effects driven by `PacketRouter` domain events.
 *
 * These used to live in a second `device.events.on*` subscription alongside the
 * one `MeshtasticProtocol` already owns, so every text packet and log record was
 * decoded twice. Everything here reacts to the event the Protocol emits instead,
 * which keeps `messageStore` / `nodeStore` the single ingress path.
 *
 * Failure point: MQTT publish and OS notification are best-effort — failures are
 * logged and never block chat ingest, which has already been persisted by
 * `PacketRouter` + `meshtasticIngest`.
 */
import i18n from '@/renderer/lib/i18n';

import { attachTypedPacketListeners } from '../drivers/attachTypedPacketListener';
import { errLikeToLogString } from '../errLikeToLogString';
import {
  loadMeshtasticMqttManualChannelPsks,
  resolveMeshtasticMqttPublishFieldsForChannel,
} from '../meshtasticMqttPublish';
import { truncatePacketText } from '../packetPayload';
import type { DomainEvent } from '../protocols/Protocol';
import { stripControlCharacters } from '../stripControlCharacters';
import type { IdentityId, MQTTStatus } from '../types';

const BROADCAST_ADDR = 0xffffffff;

/** OS notification field caps (sender line / body preview). */
const NOTIFICATION_SENDER_MAX_CHARS = 120;
const NOTIFICATION_BODY_MAX_CHARS = 100;

export interface MeshtasticRouterChannelConfig {
  index: number;
  name: string;
  role: number;
  psk: Uint8Array;
  uplinkEnabled: boolean;
  downlinkEnabled: boolean;
  positionPrecision: number;
}

export interface MeshtasticRouterSideEffectsDeps {
  getMyNodeNum: () => number;
  getMqttStatus: () => MQTTStatus;
  getChannelConfigs: () => MeshtasticRouterChannelConfig[];
  /** False for MQTT-only sessions, which prefer manually entered channel PSKs. */
  hasRfDevice: () => boolean;
  getNodeName: (nodeNum: number) => string;
  /** Register the uplinked packet id so the MQTT echo is not shown twice. */
  registerMqttEchoPacketId: (senderId: number, packetId: number) => void;
  /** Ask an unknown sender for its NodeInfo (throttled by the caller). */
  requestNodeInfoForNode: (nodeNum: number) => void;
  applyForeignLoraFromLog: (message: string) => void;
  applyRoutingErrorFromLog: (message: string) => void;
  /** Hook-local `DeviceState.firmwareVersion`; the connection store copy is set by PacketRouter. */
  setFirmwareVersion: (firmwareVersion: string) => void;
}

type TextMessagePayload = Extract<DomainEvent, { type: 'text_message' }>['payload'];
type WaypointPayload = Extract<DomainEvent, { type: 'waypoint' }>['payload'];

function resolveMqttUplink(
  channelIndex: number,
  deps: MeshtasticRouterSideEffectsDeps,
): ReturnType<typeof resolveMeshtasticMqttPublishFieldsForChannel> | undefined {
  if (deps.getMqttStatus() !== 'connected') return undefined;
  const channelConfigs = deps.getChannelConfigs();
  if (!channelConfigs.find((config) => config.index === channelIndex)?.uplinkEnabled) {
    return undefined;
  }
  const uplink = resolveMeshtasticMqttPublishFieldsForChannel(
    channelIndex,
    channelConfigs,
    loadMeshtasticMqttManualChannelPsks(),
    deps.hasRfDevice() ? undefined : { preferManualOverRadio: true },
  );
  return uplink.channelName ? uplink : undefined;
}

/** Gateway uplink: forward inbound RF broadcasts to MQTT when the channel allows it. */
function uplinkTextToMqtt(
  message: TextMessagePayload,
  deps: MeshtasticRouterSideEffectsDeps,
): void {
  const channelIndex = message.channelIndex;
  const uplink = resolveMqttUplink(channelIndex, deps);
  if (!uplink) return;

  window.electronAPI.mqtt
    .publish({
      text: message.payload,
      from: message.from,
      channel: channelIndex,
      destination: BROADCAST_ADDR,
      channelName: uplink.channelName,
      pskBase64: uplink.pskBase64,
      publishJsonMirror: uplink.publishJsonMirror,
    })
    .then((packetId) => {
      deps.registerMqttEchoPacketId(message.from, packetId);
    })
    .catch((e: unknown) => {
      console.debug(
        '[meshtasticRouterSideEffects] MQTT uplink echo register non-fatal ' +
          errLikeToLogString(e),
      );
    });
}

/**
 * OS toast when the window is hidden. Silent on purpose: App.tsx owns typed Web
 * Audio via chatNotifications.ts, so sounding here would double-notify.
 */
function notifyHiddenWindow(
  message: TextMessagePayload,
  deps: MeshtasticRouterSideEffectsDeps,
): void {
  if (!document.hidden) return;
  try {
    const safeSender = truncatePacketText(
      stripControlCharacters(deps.getNodeName(message.from)),
      NOTIFICATION_SENDER_MAX_CHARS,
    );
    const isDirect = message.to !== 0 && message.to !== BROADCAST_ADDR;
    const title = isDirect
      ? i18n.t('chatPanel.notificationDmTitle', { sender: safeSender })
      : i18n.t('chatPanel.notificationMessageTitle', { sender: safeSender });
    new Notification(title, {
      body: truncatePacketText(
        stripControlCharacters(message.payload),
        NOTIFICATION_BODY_MAX_CHARS,
      ),
      silent: true,
    });
  } catch (e) {
    console.debug(
      '[meshtasticRouterSideEffects] Notification not available ' + errLikeToLogString(e),
    );
  }
}

function handleTextMessage(
  message: TextMessagePayload,
  deps: MeshtasticRouterSideEffectsDeps,
): void {
  const isEcho = message.from === deps.getMyNodeNum();
  if (isEcho) return;

  deps.requestNodeInfoForNode(message.from);
  if (message.tapback) return;

  const isDirect = message.to !== 0 && message.to !== BROADCAST_ADDR;
  // DMs are never uplinked (privacy); reactions would duplicate the parent row.
  if (!isDirect) uplinkTextToMqtt(message, deps);
  notifyHiddenWindow(message, deps);
}

/**
 * Gateway uplink for inbound broadcast waypoints. The waypoint row itself is
 * stored by `PacketRouter`; only the MQTT relay lives here.
 */
function uplinkWaypointToMqtt(
  waypoint: WaypointPayload,
  deps: MeshtasticRouterSideEffectsDeps,
): void {
  if (!waypoint.id) return;
  const from = waypoint.from;
  if (!from || from === deps.getMyNodeNum()) return;
  const to = (waypoint.to ?? BROADCAST_ADDR) >>> 0;
  if (to !== BROADCAST_ADDR) return;

  const channelIndex = waypoint.channelIndex ?? 0;
  const uplink = resolveMqttUplink(channelIndex, deps);
  if (!uplink) return;

  void window.electronAPI.mqtt
    .publishWaypoint({
      from,
      to,
      channel: channelIndex,
      channelName: uplink.channelName,
      pskBase64: uplink.pskBase64,
      publishJsonMirror: uplink.publishJsonMirror,
      waypoint: {
        id: waypoint.id,
        latitudeI: waypoint.latitudeI ?? 0,
        longitudeI: waypoint.longitudeI ?? 0,
        name: waypoint.name,
        description: waypoint.description ?? '',
        icon: waypoint.icon ?? 0,
        lockedTo: waypoint.lockedTo ?? 0,
        expire: waypoint.expire ?? 0,
      },
    })
    .catch((e: unknown) => {
      console.debug(
        '[meshtasticRouterSideEffects] MQTT waypoint relay failed ' + errLikeToLogString(e),
      );
    });
}

/**
 * Attach post-router side effects for one Meshtastic identity.
 * Returns a detach function; call once per active transport.
 */
export function attachMeshtasticRouterSideEffects(
  identityId: IdentityId,
  deps: MeshtasticRouterSideEffectsDeps,
): () => void {
  return attachTypedPacketListeners(identityId, {
    text_message: (payload) => {
      handleTextMessage(payload, deps);
    },
    device_log: (payload) => {
      if (!payload.message) return;
      deps.applyForeignLoraFromLog(payload.message);
      deps.applyRoutingErrorFromLog(payload.message);
    },
    waypoint: (payload) => {
      uplinkWaypointToMqtt(payload, deps);
    },
    device_metadata: (payload) => {
      if (payload.firmwareVersion) deps.setFirmwareVersion(payload.firmwareVersion);
    },
  });
}
