import type { MeshDevice } from '@meshtastic/core';
import type { RefObject } from 'react';

import type { StatusUpdateEvent } from './types';

const BROADCAST_ADDR = 0xffffffff;

export interface TransportManagerDeps {
  deviceRef: RefObject<MeshDevice | null>;
  myNodeNumRef: RefObject<number>;
  mqttStatusRef: RefObject<string>;
  channelConfigsRef: RefObject<{ index: number; uplinkEnabled?: boolean }[]>;
  isDuplicate: (packetId: number) => boolean;
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
    emoji?: number,
  ): void {
    const {
      deviceRef,
      myNodeNumRef,
      mqttStatusRef,
      channelConfigsRef,
      isDuplicate,
      onStatusUpdateRef,
    } = this.deps;

    const chCfg = channelConfigsRef.current.find((c) => c.index === channel);
    const shouldUplink =
      chCfg?.uplinkEnabled && mqttStatusRef.current === 'connected' && myNodeNumRef.current;
    // ── MQTT transport (path 1) ──────────────────────────────────────────────
    if (shouldUplink || (!deviceRef.current && mqttStatusRef.current === 'connected')) {
      window.electronAPI.mqtt
        .publish({
          text,
          from,
          channel,
          destination: destination ?? BROADCAST_ADDR,
          channelName: 'LongFast',
          ...(emoji != null ? { emoji, replyId } : {}),
        })
        .then((mqttPacketId: number) => {
          isDuplicate(mqttPacketId); // register so echo is deduped
          onStatusUpdateRef.current({ tempId, transport: 'mqtt', status: 'acked' });
        })
        .catch((err: unknown) => {
          console.warn('[TransportManager] MQTT publish failed', err);
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
        .sendText(text, dest, true, channel)
        .then((packetId: number) => {
          onStatusUpdateRef.current({
            tempId,
            transport: 'device',
            status: 'acked',
            finalPacketId: packetId,
          });
        })
        .catch((err: unknown) => {
          const pe = err as { packetId?: number; error?: string };
          const packetId = typeof pe.packetId === 'number' ? pe.packetId : undefined;
          const error = pe.error ?? String(err);
          console.warn('[Meshtastic] sendText failed', err);
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
