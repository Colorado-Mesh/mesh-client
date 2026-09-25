import { useEffect, useRef } from 'react';

import { formatMeshtasticNodeId } from '@/shared/nodeNameUtils';
import { MS_PER_MINUTE } from '@/shared/timeConstants';

import { formatDisplayTime } from '../lib/formatDisplayTime';
import i18n from '../lib/i18n';
import { getNodeStatus } from '../lib/nodeStatus';
import { PROTOCOL_THEME } from '../lib/protocolTheme';
import type { ProtocolCapabilities } from '../lib/radio/BaseRadioProvider';
import type { MeshNode, MeshProtocol } from '../lib/types';
import { useTimeFormatStore } from '../stores/timeFormatStore';
import { useWatchedNodesStore } from '../stores/watchedNodesStore';

/** Brand name from the protocol theme (Meshtastic / MeshCore / Reticulum). */
export function protocolNotificationLabel(protocol: MeshProtocol | null | undefined): string {
  return PROTOCOL_THEME[protocol ?? 'meshtastic'].displayName;
}

/**
 * Id shown when a watched node has no long or short name.
 * Reticulum uses the existing 12-hex destination-hash prefix (peer/chat short id);
 * without a hash, the folded node id in uppercase hex — same fallback as Reticulum labels.
 */
export function fallbackWatchedNodeId(
  nodeId: number,
  protocol: MeshProtocol | null | undefined,
  reticulumDestinationHash?: string,
): string {
  if (protocol === 'meshcore') {
    return `Node-${nodeId.toString(16).toUpperCase()}`;
  }
  if (protocol === 'reticulum') {
    const hash = reticulumDestinationHash
      ?.replace(/[^0-9a-f]/gi, '')
      .toLowerCase()
      .slice(0, 12);
    if (hash) return hash;
    return (nodeId >>> 0).toString(16).toUpperCase();
  }
  return formatMeshtasticNodeId(nodeId);
}

export function notificationNodeName(
  node: Pick<MeshNode, 'long_name' | 'short_name' | 'reticulum_destination_hash'>,
  nodeId: number,
  protocol: MeshProtocol | null | undefined,
): string {
  return (
    node.long_name ||
    node.short_name ||
    fallbackWatchedNodeId(nodeId, protocol, node.reticulum_destination_hash)
  );
}

function computeIsOnline(
  node: MeshNode,
  capabilities: ProtocolCapabilities | null,
  silenceThresholdMs: number | null,
): boolean {
  const status = getNodeStatus(
    node.last_heard,
    silenceThresholdMs ?? capabilities?.nodeStaleThresholdMs,
    capabilities?.nodeOfflineThresholdMs,
  );
  return status === 'online';
}

export interface NodeStatusNotifierOptions {
  /** User `nodeSilenceAlertMinutes`; replaces the capability stale threshold when set. */
  silenceThresholdMinutes?: number | null;
}

export function fireNotification(title: string, body: string): void {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body, silent: false });
    } else if (Notification.permission !== 'denied') {
      void Notification.requestPermission()
        .then((perm) => {
          if (perm === 'granted') new Notification(title, { body, silent: false });
        })
        .catch(() => {
          // catch-no-log-ok: best-effort notification permission
        });
    }
  } catch {
    // catch-no-log-ok: best-effort desktop notification
  }
}

export function useNodeStatusNotifier(
  nodes: Map<number, MeshNode>,
  capabilities: ProtocolCapabilities | null,
  options: NodeStatusNotifierOptions = {},
): void {
  const silenceMinutes = options.silenceThresholdMinutes;
  const silenceThresholdMs =
    typeof silenceMinutes === 'number' && Number.isFinite(silenceMinutes) && silenceMinutes > 0
      ? silenceMinutes * MS_PER_MINUTE
      : null;
  const watchedNodeIds = useWatchedNodesStore((s) => s.watchedNodeIds);
  const use24HourTime = useTimeFormatStore((s) => s.use24HourTime);
  const prevOnlineRef = useRef<Map<number, boolean>>(new Map());

  useEffect(() => {
    if (watchedNodeIds.size === 0) return;

    const prev = prevOnlineRef.current;
    const next = new Map<number, boolean>();

    for (const nodeId of watchedNodeIds) {
      const node = nodes.get(nodeId);
      if (!node) continue;

      const isOnline = computeIsOnline(node, capabilities, silenceThresholdMs);
      next.set(nodeId, isOnline);

      if (!prev.has(nodeId)) continue;
      const wasOnline = prev.get(nodeId)!;

      const protocol = capabilities?.protocol;
      const protocolLabel = protocolNotificationLabel(protocol);
      const name = notificationNodeName(node, nodeId, protocol);
      if (!wasOnline && isOnline) {
        fireNotification(
          i18n.t('nodeStatusNotifier.onlineTitle', { name }),
          i18n.t('nodeStatusNotifier.onlineBody', { protocol: protocolLabel }),
        );
      } else if (wasOnline && !isOnline) {
        let lastHeardMs: number | null = null;
        if (node.last_heard) {
          lastHeardMs = node.last_heard < 1e12 ? node.last_heard * 1000 : node.last_heard;
        }
        const time =
          lastHeardMs != null
            ? formatDisplayTime(lastHeardMs, { use24Hour: use24HourTime })
            : i18n.t('nodeStatusNotifier.unknown');
        fireNotification(
          i18n.t('nodeStatusNotifier.offlineTitle', { name }),
          i18n.t('nodeStatusNotifier.offlineBody', { time }),
        );
      }
    }

    prevOnlineRef.current = next;
  }, [nodes, watchedNodeIds, capabilities, use24HourTime, silenceThresholdMs]);
}
