import { useEffect, useRef } from 'react';

import { formatMeshtasticNodeId } from '@/shared/nodeNameUtils';

import { getNodeStatus } from '../lib/nodeStatus';
import type { ProtocolCapabilities } from '../lib/radio/BaseRadioProvider';
import type { MeshNode } from '../lib/types';
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
      void Notification.requestPermission().then((perm) => {
        if (perm === 'granted') new Notification(title, { body, silent: false });
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
        fireNotification(`${name} is online`, `${protocolLabel} node came online`);
      } else if (wasOnline && !isOnline) {
        fireNotification(
          `${name} went offline`,
          `Last heard: ${node.last_heard ? new Date(node.last_heard < 1e12 ? node.last_heard * 1000 : node.last_heard).toLocaleTimeString() : 'unknown'}`,
        );
      }
    }

    prevOnlineRef.current = next;
  }, [nodes, watchedNodeIds, capabilities]);
}
