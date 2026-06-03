/**
 * Persist MeshCore live advert / contact events to SQLite when legacy conn handlers
 * are skipped (driver + PacketRouter path).
 *
 * Failure point: DB IPC — logged; Zustand store remains authoritative for UI.
 * Fallback: skip DB write; reconnect refreshContacts repairs rows.
 */
import { useNodeStore } from '../../stores/nodeStore';
import { usePositionHistoryStore } from '../../stores/positionHistoryStore';
import { errLikeToLogString } from '../errLikeToLogString';
import {
  CONTACT_TYPE_LABELS,
  mergeHwModelOnContactUpdate,
  meshcoreContactTypeFromHwModel,
  meshcoreMinimalNodeFromAdvertEvent,
  pubkeyToNodeId,
} from '../meshcoreUtils';
import { mergeMeshcoreLastHeardFromAdvert } from '../nodeStatus';
import type { NodeInfoEvent } from '../protocols/Protocol';
import type { IdentityId } from '../types';
import { registerMeshcorePubKey } from './meshcorePubKeyRegistry';

const MESHCORE_COORD_SCALE = 1e6;

export interface PersistMeshcoreNodeInfoOpts {
  /** MeshCore contact type from advert (138) when known. */
  contactType?: number;
  latitudeDeg?: number | null;
  longitudeDeg?: number | null;
}

function publicKeyHex(publicKey: Uint8Array): string {
  return Array.from(publicKey)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * After PacketRouter `upsertNode`, mirror legacy event 128/138 SQLite + pubkey registry side effects.
 */
export function persistMeshcoreNodeInfoAfterAdvert(
  identityId: IdentityId,
  event: NodeInfoEvent,
  opts?: PersistMeshcoreNodeInfoOpts,
): void {
  const publicKey = event.publicKey;
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== 32) return;

  const nodeId = event.nodeId > 0 ? event.nodeId : pubkeyToNodeId(publicKey);
  if (nodeId === 0) return;

  registerMeshcorePubKey(nodeId, publicKey);

  const nowSec = Math.floor(Date.now() / 1000);
  const existingRecord = useNodeStore.getState().nodes[identityId]?.[nodeId];
  const existingLastHeard = existingRecord?.lastHeardAt;
  const rawAdvertSec =
    event.lastHeardAt != null && Number.isFinite(event.lastHeardAt) && event.lastHeardAt > 0
      ? Math.floor(event.lastHeardAt)
      : undefined;
  const lastAdvert = mergeMeshcoreLastHeardFromAdvert(
    rawAdvertSec,
    existingLastHeard ?? nowSec,
    nowSec,
  );

  const latDeg = opts?.latitudeDeg ?? existingRecord?.latitude ?? null;
  const lonDeg = opts?.longitudeDeg ?? existingRecord?.longitude ?? null;

  if (
    latDeg != null &&
    lonDeg != null &&
    Number.isFinite(latDeg) &&
    Number.isFinite(lonDeg) &&
    latDeg !== 0 &&
    lonDeg !== 0
  ) {
    usePositionHistoryStore.getState().recordPosition(nodeId, latDeg, lonDeg);
  }

  const built = meshcoreMinimalNodeFromAdvertEvent(publicKey, {
    nowSec,
    advLat: latDeg != null && latDeg !== 0 ? Math.round(latDeg * MESHCORE_COORD_SCALE) : undefined,
    advLon: lonDeg != null && lonDeg !== 0 ? Math.round(lonDeg * MESHCORE_COORD_SCALE) : undefined,
    lastAdvert: rawAdvertSec,
    contactType: opts?.contactType,
    advName: event.longName,
  });

  const isNew = !existingRecord;
  if (isNew && built) {
    void window.electronAPI.db
      .saveMeshcoreContact({
        node_id: nodeId,
        public_key: publicKeyHex(publicKey),
        adv_name:
          typeof event.longName === 'string' && event.longName.trim()
            ? event.longName.trim()
            : null,
        contact_type: built.contactType,
        last_advert: lastAdvert,
        adv_lat: built.persistAdvLatDeg,
        adv_lon: built.persistAdvLonDeg,
        nickname: null,
        on_radio: 1,
      })
      .catch((e: unknown) => {
        console.warn(
          '[meshcoreLiveContactPersist] saveMeshcoreContact (new) ' + errLikeToLogString(e),
        );
      });
    return;
  }

  const advNameTrim =
    typeof event.longName === 'string' && event.longName.trim() ? event.longName.trim() : undefined;
  const existingHw = existingRecord?.hwModel;
  let persistAdvName: string | undefined;
  if (advNameTrim && !existingRecord?.longName?.trim()) {
    persistAdvName = advNameTrim;
  }
  if (opts?.contactType != null && Number.isFinite(opts.contactType)) {
    const newHw = CONTACT_TYPE_LABELS[Math.floor(opts.contactType)] ?? 'Unknown';
    const merged = mergeHwModelOnContactUpdate(existingHw, newHw);
    if (merged !== existingHw) {
      const mergedType = meshcoreContactTypeFromHwModel(merged);
      if (mergedType !== undefined) {
        void window.electronAPI.db
          .updateMeshcoreContactType(nodeId, mergedType)
          .catch((e: unknown) => {
            console.warn(
              '[meshcoreLiveContactPersist] updateMeshcoreContactType ' + errLikeToLogString(e),
            );
          });
      }
    }
  }

  void window.electronAPI.db
    .updateMeshcoreContactAdvert(nodeId, lastAdvert, latDeg, lonDeg, persistAdvName)
    .catch((e: unknown) => {
      console.warn(
        '[meshcoreLiveContactPersist] updateMeshcoreContactAdvert ' + errLikeToLogString(e),
      );
    });
}

/** Path-updated (129): insert minimal contact when node was unknown. */
export function persistMeshcorePathUpdatedNewContact(
  nodeId: number,
  publicKey: Uint8Array,
  lastAdvertSec: number,
): void {
  if (nodeId === 0 || publicKey.length !== 32) return;
  registerMeshcorePubKey(nodeId, publicKey);
  void window.electronAPI.db
    .saveMeshcoreContact({
      node_id: nodeId,
      public_key: publicKeyHex(publicKey),
      adv_name: null,
      contact_type: 0,
      last_advert: lastAdvertSec,
      adv_lat: null,
      adv_lon: null,
      nickname: null,
      on_radio: 1,
    })
    .catch((e: unknown) => {
      console.warn(
        '[meshcoreLiveContactPersist] saveMeshcoreContact (path 129) ' + errLikeToLogString(e),
      );
    });
}
