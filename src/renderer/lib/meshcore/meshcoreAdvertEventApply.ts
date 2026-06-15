import { shouldPreserveStaticGpsForSelfNode } from '../gpsSource';
import {
  CONTACT_TYPE_LABELS,
  mergeHwModelOnContactUpdate,
  MESHCORE_COORD_SCALE,
  meshcoreContactTypeFromHwModel,
  meshcoreMinimalNodeFromAdvertEvent,
  pubkeyToNodeId,
} from '../meshcoreUtils';
import { LAST_HEARD_MAX_FUTURE_SKEW_SEC, mergeMeshcoreLastHeardFromAdvert } from '../nodeStatus';
import type { MeshNode } from '../types';

export interface MeshcoreAdvertEvent128Data {
  publicKey: Uint8Array;
  advLat?: number;
  advLon?: number;
  lastAdvert?: number;
  type?: number;
  advName?: string;
}

export interface MeshcoreAdvertPersistMeta {
  kind: 'none' | 'insert' | 'update';
  persistLastAdvert: number;
  persistLat: number | null;
  persistLon: number | null;
  insertContactType: number;
  insertAdvName: string | null;
  persistAdvName?: string;
  updatePubKeyMaps: boolean;
  contactTypeUpdate?: { nodeId: number; contactType: number };
}

export interface MeshcorePathUpdated129PersistMeta {
  kind: 'none' | 'insert' | 'update';
  persistLastAdvert: number;
  updatePubKeyMaps: boolean;
}

function emptyPersist128(nowSec: number): MeshcoreAdvertPersistMeta {
  return {
    kind: 'none',
    persistLastAdvert: nowSec,
    persistLat: null,
    persistLon: null,
    insertContactType: 0,
    insertAdvName: null,
    updatePubKeyMaps: false,
  };
}

/** Pure advert (event 128) → node map + SQLite persist metadata. */
export function applyMeshcoreAdvertEvent128(
  prev: Map<number, MeshNode>,
  d: MeshcoreAdvertEvent128Data,
  ctx: { nodeId: number; nowSec: number; nick?: string; myNodeNum: number | null },
): { next: Map<number, MeshNode>; persist: MeshcoreAdvertPersistMeta } {
  const { nodeId, nowSec, nick, myNodeNum } = ctx;
  const existing = prev.get(nodeId);
  const hasLat = typeof d.advLat === 'number' && Number.isFinite(d.advLat) && d.advLat !== 0;
  const hasLon = typeof d.advLon === 'number' && Number.isFinite(d.advLon) && d.advLon !== 0;
  const rawAdvertSec =
    typeof d.lastAdvert === 'number' && Number.isFinite(d.lastAdvert) && d.lastAdvert > 0
      ? Math.floor(d.lastAdvert)
      : undefined;
  const lastHeard = mergeMeshcoreLastHeardFromAdvert(
    rawAdvertSec,
    existing?.last_heard ?? nowSec,
    nowSec,
  );
  if (rawAdvertSec != null && rawAdvertSec > nowSec + LAST_HEARD_MAX_FUTURE_SKEW_SEC) {
    console.debug(
      `[useMeshcoreRuntime] clamped future lastAdvert nodeId=${nodeId.toString(16)} advertSec=${rawAdvertSec} nowSec=${nowSec}`,
    );
  }

  if (!existing) {
    const built = meshcoreMinimalNodeFromAdvertEvent(d.publicKey, {
      nowSec,
      advLat: d.advLat,
      advLon: d.advLon,
      lastAdvert: d.lastAdvert,
      contactType: d.type,
      advName: d.advName,
    });
    if (!built) {
      return { next: prev, persist: emptyPersist128(nowSec) };
    }
    const nodeWithNick = nick ? { ...built.node, long_name: nick, short_name: '' } : built.node;
    const next = new Map(prev);
    next.set(nodeId, nodeWithNick);
    return {
      next,
      persist: {
        kind: 'insert',
        persistLastAdvert: lastHeard,
        persistLat: built.persistAdvLatDeg,
        persistLon: built.persistAdvLonDeg,
        insertContactType: built.contactType,
        insertAdvName: typeof d.advName === 'string' && d.advName.trim() ? d.advName.trim() : null,
        updatePubKeyMaps: true,
      },
    };
  }

  const skipSelfStaticCoords = shouldPreserveStaticGpsForSelfNode(nodeId, myNodeNum ?? 0);
  const persistLat =
    skipSelfStaticCoords || !hasLat
      ? (existing.latitude ?? null)
      : d.advLat! / MESHCORE_COORD_SCALE;
  const persistLon =
    skipSelfStaticCoords || !hasLon
      ? (existing.longitude ?? null)
      : d.advLon! / MESHCORE_COORD_SCALE;
  const advNameTrim = typeof d.advName === 'string' && d.advName.trim() ? d.advName.trim() : '';
  const applyAdvertName = !nick && Boolean(advNameTrim);
  const advertType = typeof d.type === 'number' && Number.isFinite(d.type) ? d.type : -1;
  const newHwModel =
    advertType >= 0 ? (CONTACT_TYPE_LABELS[advertType] ?? 'Unknown') : existing.hw_model;
  const mergedHwModel = mergeHwModelOnContactUpdate(existing.hw_model, newHwModel);
  const next = new Map(prev);
  next.set(nodeId, {
    ...existing,
    last_heard: lastHeard,
    hw_model: mergedHwModel,
    latitude:
      skipSelfStaticCoords || !hasLat ? existing.latitude : d.advLat! / MESHCORE_COORD_SCALE,
    longitude:
      skipSelfStaticCoords || !hasLon ? existing.longitude : d.advLon! / MESHCORE_COORD_SCALE,
    ...(nick
      ? { long_name: nick, short_name: '' }
      : applyAdvertName
        ? { long_name: advNameTrim, short_name: '' }
        : {}),
  });

  const mergedType =
    mergedHwModel !== existing.hw_model ? meshcoreContactTypeFromHwModel(mergedHwModel) : undefined;

  return {
    next,
    persist: {
      kind: 'update',
      persistLastAdvert: lastHeard,
      persistLat,
      persistLon,
      insertContactType: 0,
      insertAdvName: null,
      ...(applyAdvertName ? { persistAdvName: advNameTrim } : {}),
      updatePubKeyMaps: true,
      ...(mergedType !== undefined
        ? { contactTypeUpdate: { nodeId, contactType: mergedType } }
        : {}),
    },
  };
}

/** Pure path-updated (event 129) → node map + SQLite persist metadata. */
export function applyMeshcorePathUpdated129(
  prev: Map<number, MeshNode>,
  publicKey: Uint8Array,
  ctx: { nodeId: number; nowSec: number; nick?: string },
): { next: Map<number, MeshNode>; persist: MeshcorePathUpdated129PersistMeta } {
  const { nodeId, nowSec, nick } = ctx;
  const existing = prev.get(nodeId);

  if (!existing) {
    const built = meshcoreMinimalNodeFromAdvertEvent(publicKey, { nowSec });
    if (!built) {
      return {
        next: prev,
        persist: { kind: 'none', persistLastAdvert: nowSec, updatePubKeyMaps: false },
      };
    }
    const nodeWithNick = nick ? { ...built.node, long_name: nick, short_name: '' } : built.node;
    const next = new Map(prev);
    next.set(nodeId, nodeWithNick);
    return {
      next,
      persist: {
        kind: 'insert',
        persistLastAdvert: built.lastHeardSec,
        updatePubKeyMaps: true,
      },
    };
  }

  const next = new Map(prev);
  next.set(nodeId, {
    ...existing,
    last_heard: Math.max(existing.last_heard ?? 0, nowSec),
  });
  return {
    next,
    persist: { kind: 'update', persistLastAdvert: nowSec, updatePubKeyMaps: false },
  };
}

export function updateMeshcorePubKeyPrefixMaps(
  nodeId: number,
  publicKey: Uint8Array,
  pubKeyMap: Map<number, Uint8Array>,
  pubKeyPrefixMap: Map<string, number>,
): void {
  pubKeyMap.set(nodeId, publicKey);
  const prefix = Array.from(publicKey.slice(0, 6))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  pubKeyPrefixMap.set(prefix, nodeId);
}

export { pubkeyToNodeId };
