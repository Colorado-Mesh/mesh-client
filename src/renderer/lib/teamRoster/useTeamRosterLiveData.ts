import { useMemo } from 'react';

import { getIdentityIdForProtocol } from '@/renderer/lib/identityByProtocol';
import { getOfflineIdentityIdForProtocol } from '@/renderer/lib/offlineProtocolIdentities';
import type { MeshNode } from '@/renderer/lib/types';
import { type NodeRecord, useNodeStore } from '@/renderer/stores/nodeStore';
import { useReticulumPeerStore } from '@/renderer/stores/reticulumPeerStore';
import type { MeshProtocol } from '@/shared/meshProtocol';

import type { NodesByProtocol } from './contactPresence';

type NodeBuckets = Readonly<Record<string, Readonly<Record<string, NodeRecord>>>>;

function nodesMapForProtocol(
  protocol: MeshProtocol,
  nodeBuckets: NodeBuckets,
): Map<number, MeshNode> {
  const identityId =
    getIdentityIdForProtocol(protocol) ?? getOfflineIdentityIdForProtocol(protocol);
  const byId = nodeBuckets[identityId] ?? {};
  const map = new Map<number, MeshNode>();
  for (const [idStr, rec] of Object.entries(byId)) {
    const nodeId = Number(idStr);
    if (!Number.isFinite(nodeId)) continue;
    map.set(nodeId >>> 0, {
      node_id: nodeId >>> 0,
      long_name: rec.longName ?? '',
      short_name: rec.shortName ?? '',
      hw_model: rec.hwModel ?? '',
      snr: rec.snr ?? 0,
      battery: rec.batteryLevel ?? 0,
      last_heard: rec.lastHeardAt ?? 0,
      latitude: rec.latitude ?? null,
      longitude: rec.longitude ?? null,
      public_key_hex: rec.publicKeyHex,
      reticulum_destination_hash: rec.reticulumDestinationHash,
    });
  }
  return map;
}

/** Subscribe to node + Reticulum peer stores for Contact Cards / Roster presence. */
export function useTeamRosterLiveData(): {
  nodesByProtocol: NodesByProtocol;
  reticulumByHash: ReadonlyMap<string, { lastHeardMs: number; displayName?: string | null }>;
} {
  const nodeBuckets = useNodeStore((s) => s.nodes);
  const peers = useReticulumPeerStore((s) => s.peers);
  const contacts = useReticulumPeerStore((s) => s.contacts);
  const history = useReticulumPeerStore((s) => s.history);

  return useMemo(() => {
    const nodesByProtocol: NodesByProtocol = {
      meshtastic: nodesMapForProtocol('meshtastic', nodeBuckets),
      meshcore: nodesMapForProtocol('meshcore', nodeBuckets),
      reticulum: nodesMapForProtocol('reticulum', nodeBuckets),
    };
    const reticulumByHash = new Map<string, { lastHeardMs: number; displayName?: string | null }>();
    const ingest = (
      hash: string,
      lastSeen: number | null | undefined,
      displayName?: string | null,
    ) => {
      const key = hash.toLowerCase();
      const ms =
        typeof lastSeen === 'number' && Number.isFinite(lastSeen) && lastSeen > 0
          ? lastSeen < 1e12
            ? lastSeen * 1000
            : lastSeen
          : 0;
      const prev = reticulumByHash.get(key);
      if (!prev || ms > prev.lastHeardMs) {
        reticulumByHash.set(key, {
          lastHeardMs: ms,
          displayName: displayName ?? prev?.displayName ?? null,
        });
      }
    };
    for (const peer of peers.values()) {
      ingest(peer.destination_hash, peer.last_seen, peer.display_name ?? peer.custom_display_name);
    }
    for (const c of contacts.values()) {
      ingest(
        c.destination_hash,
        c.last_heard > 0 ? c.last_heard : c.last_seen,
        c.display_name ?? c.custom_display_name,
      );
    }
    for (const h of history.values()) {
      ingest(
        h.destination_hash,
        h.last_heard > 0 ? h.last_heard : h.last_seen,
        h.display_name ?? h.custom_display_name,
      );
    }
    return { nodesByProtocol, reticulumByHash };
  }, [nodeBuckets, peers, contacts, history]);
}
