import type { MeshDevice } from '@meshtastic/core';
import type { RefObject } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { humanizeMeshtasticSdkQueueRejectionError } from '@/renderer/lib/meshtastic/meshtasticSdkRoutingErrorLog';
import {
  loadMeshtasticMqttManualChannelPsks,
  resolveMeshtasticMqttPublishFieldsForChannel,
} from '@/renderer/lib/meshtasticMqttPublish';
import { MESHTASTIC_TAPBACK_DATA_EMOJI_FLAG } from '@/shared/reactionEmoji';

import type { StatusUpdateEvent } from './types';

const BROADCAST_ADDR = 0xffffffff;

export interface TransportManagerDeps {
  deviceRef: RefObject<MeshDevice | null>;
  myNodeNumRef: RefObject<number>;
  mqttStatusRef: RefObject<string>;
  channelConfigsRef: RefObject<
    { index: number; name: string; role: number; uplinkEnabled?: boolean; psk: Uint8Array }[]
  >;
  isDuplicate: (senderId: number, packetId: number) => boolean;
  /** Stored as a ref so TransportManager always calls the latest handler across re-renders */
  onStatusUpdateRef: RefObject<(event: StatusUpdateEvent) => void>;
}

export class TransportManager {
  private deps: TransportManagerDeps;

  constructor(deps: TransportManagerDeps) {
    this.deps = deps;
  }

  /**
   * Fire both transports concurrently. Returns immediately.
   * Each transport independently calls onStatusUpdate as it resolves/rejects.
   * @param from - Node ID to use as sender (myNodeNum from device, or virtual node ID when MQTT-only).
   */
  sendMessage(
    text: string,
    channel: number,
    destination: number | undefined,
    replyId: number | undefined,
    tempId: number,
    from: number,
    /** When true, sets Meshtastic tapback flag on wire (glyph is UTF-8 in `text`). */
    tapback?: boolean,
  ): void {
    const { deviceRef, mqttStatusRef, channelConfigsRef, isDuplicate, onStatusUpdateRef } =
      this.deps;

    const chCfg = channelConfigsRef.current.find((c) => c.index === channel);
    const mqttFields = resolveMeshtasticMqttPublishFieldsForChannel(
      channel,
      channelConfigsRef.current,
      loadMeshtasticMqttManualChannelPsks(),
      deviceRef.current ? undefined : { preferManualOverRadio: true },
    );
    const mqttReady =
      from > 0 && mqttStatusRef.current === 'connected' && Boolean(mqttFields.channelName);
    const shouldMqtt = mqttReady && (Boolean(chCfg?.uplinkEnabled) || !deviceRef.current);
    // ── MQTT transport (path 1) ──────────────────────────────────────────────
    if (shouldMqtt) {
      window.electronAPI.mqtt
        .publish({
          text,
          from,
          channel,
          destination: destination ?? BROADCAST_ADDR,
          channelName: mqttFields.channelName,
          pskBase64: mqttFields.pskBase64,
          publishJsonMirror: mqttFields.publishJsonMirror,
          ...(tapback ? { emoji: MESHTASTIC_TAPBACK_DATA_EMOJI_FLAG } : {}),
          ...(replyId != null ? { replyId } : {}),
        })
        .then((mqttPacketId: number) => {
          isDuplicate(from, mqttPacketId); // register so echo is deduped
          onStatusUpdateRef.current({ tempId, transport: 'mqtt', status: 'acked' });
        })
        .catch((err: unknown) => {
          console.warn(
            `[TransportManager] MQTT publish failed ${err instanceof Error ? err.message : String(err)}`,
          );
          onStatusUpdateRef.current({
            tempId,
            transport: 'mqtt',
            status: 'failed',
            error: String(err),
          });
        });
    }

    // ── Device transport (path 2) ─────────────────────────────────────────────
    if (deviceRef.current) {
      const dest: number | 'broadcast' = destination ?? 'broadcast';

      deviceRef.current
        .sendText(
          text,
          dest,
          true,
          channel,
          replyId,
          tapback ? MESHTASTIC_TAPBACK_DATA_EMOJI_FLAG : undefined,
        )
        .then((packetId: number) => {
          onStatusUpdateRef.current({
            tempId,
            transport: 'device',
            status: 'acked',
            finalPacketId: packetId,
          });
        })
        .catch((err: unknown) => {
          const pe = err as { id?: number; packetId?: number; error?: unknown };
          let packetId: number | undefined;
          if (typeof pe.packetId === 'number') packetId = pe.packetId;
          else if (typeof pe.id === 'number') packetId = pe.id;
          // SDK queue rejections carry a numeric Routing.Error — surface readable
          // text (e.g. "recipient public key is missing") instead of a bare code.
          let fallbackError: string;
          if (typeof pe.error === 'string') fallbackError = pe.error;
          else if (pe.error != null) fallbackError = errLikeToLogString(pe.error);
          else fallbackError = errLikeToLogString(err);
          const error = humanizeMeshtasticSdkQueueRejectionError(err) ?? fallbackError;
          console.warn('[useMeshtasticRuntime] sendText failed ' + errLikeToLogString(err));
          onStatusUpdateRef.current({
            tempId,
            transport: 'device',
            status: 'failed',
            finalPacketId: packetId,
            error,
          });
        });
    }
  }
}
