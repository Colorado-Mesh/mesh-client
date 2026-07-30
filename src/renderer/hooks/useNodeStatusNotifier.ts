import { useEffect, useRef } from 'react';

import { formatMeshtasticNodeId } from '@/shared/nodeNameUtils';

import { formatDisplayTime } from '../lib/formatDisplayTime';
import i18n from '../lib/i18n';
import { getNodeStatus } from '../lib/nodeStatus';
import type { ProtocolCapabilities } from '../lib/radio/BaseRadioProvider';
import type { MeshNode } from '../lib/types';
import { useTimeFormatStore } from '../stores/timeFormatStore';
import { useWatchedNodesStore } from '../stores/watchedNodesStore';

function computeIsOnline(node: MeshNode, capabilities: ProtocolCapabilities | null): boolean {
  const status = getNodeStatus(
    node.last_heard,
    capabilities?.nodeStaleThresholdMs,
    capabilities?.nodeOfflineThresholdMs,
  );
  return status === 'online';
}

function fireNotification(title: string, body: string): void {
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
): void {
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

      const isOnline = computeIsOnline(node, capabilities);
      next.set(nodeId, isOnline);

      if (!prev.has(nodeId)) continue;
      const wasOnline = prev.get(nodeId)!;

      const protocolLabel = capabilities?.protocol === 'meshcore' ? 'MeshCore' : 'Meshtastic';
      const name =
        node.long_name ||
        node.short_name ||
        (capabilities?.protocol === 'meshcore'
          ? `Node-${nodeId.toString(16).toUpperCase()}`
          : formatMeshtasticNodeId(nodeId));
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
  }, [nodes, watchedNodeIds, capabilities, use24HourTime]);
}
