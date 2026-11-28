/**
 * Apply MeshCom MHEARD rows to nodeStore (hops/path/neighbors) and durable SQLite contacts.
 */
import {
  MESHCOM_CONTACT_CAP_DEFAULT,
  MESHCOM_MHEARD_APPLY_BURST_CAP,
  MESHCOM_RELAY_NEIGHBOR_CAP,
} from '@/shared/meshcomConstants';
import { MS_PER_MINUTE } from '@/shared/timeConstants';

import {
  type NodeRecord,
  removeNode,
  upsertNodeRecordsForIdentity,
  useNodeStore,
} from '../../stores/nodeStore';
import { persistDbWrite } from '../dbPersistRetry';
import type { IdentityId, MeshNeighbor } from '../types';
import { registerMeshcomCallsign } from './meshcomCallRegistry';
import { normalizeMeshcomCallsign } from './meshcomCallsign';
import { meshcomHwLabel } from './meshcomHwIds';
import { shouldApplyMeshcomContact } from './meshcomLocallyDeletedContacts';
import type { MeshcomMheardStation } from './meshcomMheard';
import { meshcomPersistIdentityId } from './meshcomPersistIdentity';

/** Keep the freshest {@link MESHCOM_RELAY_NEIGHBOR_CAP} neighbors (by lastRxTime). */
function pruneRelayNeighbors(list: MeshNeighbor[]): MeshNeighbor[] {
  if (list.length <= MESHCOM_RELAY_NEIGHBOR_CAP) return list;
  return [...list].sort((a, b) => b.lastRxTime - a.lastRxTime).slice(0, MESHCOM_RELAY_NEIGHBOR_CAP);
}

function mergeNeighborEntry(
  existing: MeshNeighbor[] | undefined,
  entry: MeshNeighbor,
): MeshNeighbor[] {
  const list = existing?.length ? [...existing] : [];
  const idx = list.findIndex((n) => n.nodeId === entry.nodeId);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...entry };
  } else {
    list.push(entry);
  }
  return pruneRelayNeighbors(list);
}

function persistDurableMeshcomContact(
  identityId: IdentityId,
  opts: {
    callsign: string;
    nodeId: number;
    rssi?: number;
    snr?: number;
    hwId?: number;
    lastHeardAt: number;
  },
): void {
  const callsign = normalizeMeshcomCallsign(opts.callsign);
  if (!callsign || !shouldApplyMeshcomContact(callsign)) return;
  persistDbWrite('meshcom mheard contact', () =>
    window.electronAPI.db.saveMeshcomContact({
      callsign,
      identity_id: meshcomPersistIdentityId(),
      node_id: opts.nodeId >>> 0,
      lat: null,
      lon: null,
      batt: null,
      hw_id: opts.hwId ?? null,
      last_heard: Math.floor(opts.lastHeardAt / 1000),
    }),
  );
}

/** Drop oldest non-favorited in-memory nodes when an identity exceeds the contact cap. */
function trimMeshcomIdentityNodes(identityId: IdentityId, cap: number): void {
  const bucket = useNodeStore.getState().nodes[identityId] ?? {};
  const entries: NodeRecord[] = Object.values(bucket);
  if (entries.length <= cap) return;
  const favorited = entries.filter((n) => n.favorited);
  const rest = entries
    .filter((n) => !n.favorited)
    .sort((a, b) => (a.lastHeardAt ?? 0) - (b.lastHeardAt ?? 0));
  const keepRest = Math.max(0, cap - favorited.length);
  const doomed = rest.slice(0, Math.max(0, rest.length - keepRest));
  for (const node of doomed) {
    removeNode(identityId, node.nodeId);
  }
}

function stationNodeId(station: MeshcomMheardStation): number {
  const call = normalizeMeshcomCallsign(station.callsign);
  return call ? registerMeshcomCallsign(call) : 0;
}

function viaNodeId(via: string): number {
  const call = normalizeMeshcomCallsign(via);
  return call ? registerMeshcomCallsign(call) : 0;
}

/** Direct (hopsAway 0) and a newer lastHeardAt win over a via-relay stub. */
function relayStubFields(
  identityId: IdentityId,
  relayId: number,
  queued: readonly NodeRecord[],
  heardAt: number,
): { hopsAway: number; lastHeardAt: number } {
  let hopsAway: number | undefined;
  let lastHeardAt: number | undefined;
  const bucket = useNodeStore.getState().nodes[identityId] ?? {};
  if (Object.hasOwn(bucket, relayId)) {
    hopsAway = bucket[relayId].hopsAway;
    lastHeardAt = bucket[relayId].lastHeardAt;
  }
  for (const record of queued) {
    if (record.nodeId !== relayId) continue;
    if (record.hopsAway != null) hopsAway = record.hopsAway;
    if (record.lastHeardAt != null) lastHeardAt = record.lastHeardAt;
  }
  return {
    hopsAway: hopsAway === 0 ? 0 : 1,
    lastHeardAt: lastHeardAt != null && lastHeardAt > heardAt ? lastHeardAt : heardAt,
  };
}

/** Last-heard ms: report time minus reported age when present. */
function stationLastHeardAt(heardAt: number, ageMin: number | undefined): number {
  if (ageMin == null || !Number.isFinite(ageMin) || ageMin < 0) return heardAt;
  return Math.max(0, heardAt - ageMin * MS_PER_MINUTE);
}

/**
 * Upsert MHEARD stations into Zustand and SQLite contacts with RF topology for the peer graph.
 *
 * - No `via`: direct RF contact (`hopsAway` 0).
 * - With `via`: relay path + neighbor reverse link so `resolveMeshPeerRelayId` can edge peers.
 * - Tombstoned stations are skipped entirely. A tombstoned station's via relay is still updated
 *   when the relay itself is not tombstoned (relay is a separate heard contact).
 */
/**
 * Drop neighbor edges that point at nodes removed by the contact-cap trim so relay
 * `neighbors` arrays cannot outlive the node bucket.
 */
function scrubNeighborsAfterTrim(identityId: IdentityId): void {
  const bucket = useNodeStore.getState().nodes[identityId] ?? {};
  const alive = new Set<number>();
  for (const node of Object.values(bucket)) {
    alive.add(node.nodeId);
  }
  const patches: NodeRecord[] = [];
  for (const node of Object.values(bucket)) {
    const neighbors = node.neighbors;
    if (!neighbors?.length) continue;
    const kept = neighbors.filter((n) => alive.has(n.nodeId));
    if (kept.length === neighbors.length) continue;
    patches.push({ nodeId: node.nodeId, neighbors: pruneRelayNeighbors(kept) });
  }
  if (patches.length > 0) {
    upsertNodeRecordsForIdentity(identityId, patches);
  }
}

export function applyMeshcomMheardStations(
  identityId: IdentityId,
  stations: readonly MeshcomMheardStation[],
  heardAt: number,
): void {
  if (stations.length === 0) return;
  // Bound one-shot MH bursts (e.g. NET Console flood) before O(n) neighbor merges.
  const batch =
    stations.length > MESHCOM_MHEARD_APPLY_BURST_CAP
      ? stations.slice(0, MESHCOM_MHEARD_APPLY_BURST_CAP)
      : stations;
  const records: NodeRecord[] = [];
  const viaNeighborPatches = new Map<number, MeshNeighbor[]>();

  for (const station of batch) {
    const callsign = normalizeMeshcomCallsign(station.callsign);
    if (!callsign || !shouldApplyMeshcomContact(callsign)) continue;
    const nodeId = stationNodeId(station);
    if (!nodeId) continue;

    const viaCall = station.via ? normalizeMeshcomCallsign(station.via) : '';
    const relayAllowed = viaCall.length > 0 && shouldApplyMeshcomContact(viaCall);
    const relayId = relayAllowed ? viaNodeId(viaCall) : 0;
    const hasVia = relayAllowed && relayId > 0;

    const lastHeardAt = stationLastHeardAt(heardAt, station.ageMin);
    const hopsAway = hasVia ? 2 : 0;
    const path = hasVia ? [relayId, nodeId] : undefined;
    const hwModel = station.hwId != null ? meshcomHwLabel(station.hwId) : undefined;

    records.push({
      nodeId,
      longName: callsign,
      shortName: callsign.slice(0, 4),
      rssi: station.rssi,
      snr: station.snr,
      lastHeardAt,
      hopsAway,
      path,
      source: 'rf',
      ...(hwModel ? { hwModel } : {}),
    });

    persistDurableMeshcomContact(identityId, {
      callsign,
      nodeId,
      rssi: station.rssi,
      snr: station.snr,
      hwId: station.hwId,
      lastHeardAt,
    });

    if (hasVia) {
      const neighbor: MeshNeighbor = {
        nodeId,
        snr: station.snr ?? 0,
        lastRxTime: Math.floor(lastHeardAt / 1000),
      };
      const prevList = viaNeighborPatches.get(relayId) ?? [];
      viaNeighborPatches.set(relayId, mergeNeighborEntry(prevList, neighbor));

      const relayFields = relayStubFields(identityId, relayId, records, lastHeardAt);
      records.push({
        nodeId: relayId,
        longName: viaCall,
        shortName: viaCall.slice(0, 4),
        lastHeardAt: relayFields.lastHeardAt,
        hopsAway: relayFields.hopsAway,
        source: 'rf',
      });

      persistDurableMeshcomContact(identityId, {
        callsign: viaCall,
        nodeId: relayId,
        lastHeardAt: relayFields.lastHeardAt,
      });
    }
  }

  if (records.length > 0) {
    upsertNodeRecordsForIdentity(identityId, records);
  }

  if (viaNeighborPatches.size > 0) {
    const bucket = useNodeStore.getState().nodes[identityId] ?? {};
    const relayRecords: NodeRecord[] = [];
    for (const [relayId, addedNeighbors] of viaNeighborPatches) {
      // Guard missing relay rows (should be rare after the station upsert above).
      if (!Object.hasOwn(bucket, relayId)) continue;
      let merged = bucket[relayId].neighbors;
      for (const n of addedNeighbors) {
        merged = mergeNeighborEntry(merged, n);
      }
      relayRecords.push({ nodeId: relayId, neighbors: merged });
    }
    if (relayRecords.length > 0) {
      upsertNodeRecordsForIdentity(identityId, relayRecords);
    }
  }

  // Cap after both upserts so newly inserted stations count toward the limit.
  trimMeshcomIdentityNodes(identityId, MESHCOM_CONTACT_CAP_DEFAULT);
  scrubNeighborsAfterTrim(identityId);
}
