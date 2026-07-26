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
import { packetRouter, type PacketRouterListener } from '../drivers/PacketRouter';
import { errLikeToLogString } from '../errLikeToLogString';
import {
  loadMeshtasticMqttManualChannelPsks,
  resolveMeshtasticMqttPublishFieldsForChannel,
} from '../meshtasticMqttPublish';
import type { DomainEvent } from '../protocols/Protocol';
import { stripControlCharacters } from '../stripControlCharacters';
import type { IdentityId, MQTTStatus } from '../types';

const BROADCAST_ADDR = 0xffffffff;

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

type TextMessageEvent = Extract<DomainEvent, { type: 'text_message' }>;
type WaypointDomainEvent = Extract<DomainEvent, { type: 'waypoint' }>;

/** Gateway uplink: forward inbound RF broadcasts to MQTT when the channel allows it. */
function uplinkTextToMqtt(event: TextMessageEvent, deps: MeshtasticRouterSideEffectsDeps): void {
  if (deps.getMqttStatus() !== 'connected') return;
  const channelIndex = event.payload.channelIndex;
  const channelConfigs = deps.getChannelConfigs();
  if (!channelConfigs.find((c) => c.index === channelIndex)?.uplinkEnabled) return;

  const uplink = resolveMeshtasticMqttPublishFieldsForChannel(
    channelIndex,
    channelConfigs,
    loadMeshtasticMqttManualChannelPsks(),
    deps.hasRfDevice() ? undefined : { preferManualOverRadio: true },
  );
  if (!uplink.channelName) return;

  window.electronAPI.mqtt
    .publish({
      text: event.payload.payload,
      from: event.payload.from,
      channel: channelIndex,
      destination: BROADCAST_ADDR,
      channelName: uplink.channelName,
      pskBase64: uplink.pskBase64,
      publishJsonMirror: uplink.publishJsonMirror,
    })
    .then((packetId) => {
      deps.registerMqttEchoPacketId(event.payload.from, packetId);
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
function notifyHiddenWindow(event: TextMessageEvent, deps: MeshtasticRouterSideEffectsDeps): void {
  if (!document.hidden) return;
  try {
    const safeSender = stripControlCharacters(deps.getNodeName(event.payload.from)).slice(0, 120);
    const isDirect = event.payload.to !== 0 && event.payload.to !== BROADCAST_ADDR;
    new Notification(isDirect ? `DM from ${safeSender}` : `Message from ${safeSender}`, {
      body: stripControlCharacters(event.payload.payload).slice(0, 100),
      silent: true,
    });
  } catch (e) {
    console.debug(
      '[meshtasticRouterSideEffects] Notification not available ' + errLikeToLogString(e),
    );
  }
}

function handleTextMessage(event: TextMessageEvent, deps: MeshtasticRouterSideEffectsDeps): void {
  const isEcho = event.payload.from === deps.getMyNodeNum();
  if (isEcho) return;

  deps.requestNodeInfoForNode(event.payload.from);
  if (event.payload.tapback) return;

  const isDirect = event.payload.to !== 0 && event.payload.to !== BROADCAST_ADDR;
  // DMs are never uplinked (privacy); reactions would duplicate the parent row.
  if (!isDirect) uplinkTextToMqtt(event, deps);
  notifyHiddenWindow(event, deps);
}

/**
 * Gateway uplink for inbound broadcast waypoints. The waypoint row itself is
 * stored by `PacketRouter`; only the MQTT relay lives here.
 */
function uplinkWaypointToMqtt(
  event: WaypointDomainEvent,
  deps: MeshtasticRouterSideEffectsDeps,
): void {
  const waypoint = event.payload;
  if (!waypoint.id) return;
  if (deps.getMqttStatus() !== 'connected') return;
  const from = waypoint.from;
  if (!from || from === deps.getMyNodeNum()) return;
  const to = (waypoint.to ?? BROADCAST_ADDR) >>> 0;
  if (to !== BROADCAST_ADDR) return;

  const channelIndex = waypoint.channelIndex ?? 0;
  const channelConfigs = deps.getChannelConfigs();
  if (!channelConfigs.find((c) => c.index === channelIndex)?.uplinkEnabled) return;

  const uplink = resolveMeshtasticMqttPublishFieldsForChannel(
    channelIndex,
    channelConfigs,
    loadMeshtasticMqttManualChannelPsks(),
    deps.hasRfDevice() ? undefined : { preferManualOverRadio: true },
  );
  if (!uplink.channelName) return;

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
  const listener: PacketRouterListener = (event, routedIdentityId) => {
    if (routedIdentityId !== identityId) return;
    switch (event.type) {
      case 'text_message':
        handleTextMessage(event, deps);
        break;
      case 'device_log': {
        const message = event.payload.message;
        if (!message) break;
        deps.applyForeignLoraFromLog(message);
        deps.applyRoutingErrorFromLog(message);
        break;
      }
      case 'waypoint':
        uplinkWaypointToMqtt(event, deps);
        break;
      case 'device_metadata': {
        const firmwareVersion = event.payload.firmwareVersion;
        if (firmwareVersion) deps.setFirmwareVersion(firmwareVersion);
        break;
      }
      default:
        break;
    }
  };
  return packetRouter.addListener(listener);
}
