/**
 * One-time best-effort migration of legacy `[whispers]` SQLite rows into `@hash` DMs.
 */

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  isRrcWhisperPeerHash,
  RRC_LEGACY_WHISPERS_ROOM,
  type RrcDmPeer,
  rrcDmRoomKey,
  splitLegacyWhispersMessages,
} from '@/renderer/lib/rrcDmRoom';
import { isRrcKind, normalizeRrcHubHash } from '@/renderer/lib/rrcMessageStorageCommon';
import { upsertRrcOpenDm } from '@/renderer/lib/rrcOpenDms';
import { RRC_ROOM_HISTORY_LOAD_COUNT } from '@/renderer/lib/sessionMemoryCaps';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';
import type { RrcChatMessage } from '@/shared/rrc-types';

const MIGRATED_PREFIX = 'mesh-client:rrc:whispersMigrated:';

function migratedKey(hubHash: string): string {
  return MIGRATED_PREFIX + hubHash.trim().toLowerCase();
}

function hasMigrated(hubHash: string): boolean {
  try {
    return localStorage.getItem(migratedKey(hubHash)) === '1';
  } catch {
    // catch-no-log-ok private mode / blocked storage — treat as not migrated so we retry
    return false;
  }
}

function markMigrated(hubHash: string): void {
  try {
    localStorage.setItem(migratedKey(hubHash), '1');
  } catch {
    // catch-no-log-ok private mode / quota — next session may re-run; INSERT OR IGNORE is safe
  }
}

/** Test helper. */
export function resetRrcLegacyWhispersMigrateForTests(hubHash?: string): void {
  try {
    if (hubHash) localStorage.removeItem(migratedKey(hubHash));
    else {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(MIGRATED_PREFIX)) keys.push(k);
      }
      for (const k of keys) localStorage.removeItem(k);
    }
  } catch {
    // catch-no-log-ok test cleanup best-effort when Storage is unavailable
  }
}

/**
 * Load legacy `[whispers]` history, split into per-peer DMs, open those DMs, and
 * mark migration done for the hub. Safe to call repeatedly (no-ops after mark).
 * Completion is persisted only after the read and all re-persist writes succeed.
 */
export async function migrateLegacyWhispersForHub(hubHash: string): Promise<void> {
  const hub = normalizeRrcHubHash(hubHash);
  if (!hub || hasMigrated(hub)) return;

  let rows: Awaited<ReturnType<typeof window.electronAPI.db.listRrcMessages>>;
  try {
    rows = await window.electronAPI.db.listRrcMessages(
      hub,
      RRC_LEGACY_WHISPERS_ROOM,
      RRC_ROOM_HISTORY_LOAD_COUNT,
    );
  } catch (e) {
    console.warn('[rrcLegacyWhispersMigrate] list failed ' + errLikeToLogString(e));
    // Leave unmarked so a later run can retry when SQLite is healthy again.
    return;
  }

  const local = useRrcSessionStore.getState().localIdentityHash;
  const mapped: RrcChatMessage[] = [];
  for (const row of rows) {
    if (typeof row.message_id !== 'string' || typeof row.body !== 'string') continue;
    if (!isRrcKind(row.kind)) continue;
    mapped.push({
      id: row.message_id,
      room: RRC_LEGACY_WHISPERS_ROOM,
      kind: row.kind,
      body: row.body,
      sender_hash: row.sender_hash ?? null,
      nickname: row.nickname ?? null,
      timestamp: Number.isFinite(row.timestamp) ? row.timestamp : 0,
    });
  }

  const byRoom = splitLegacyWhispersMessages(mapped, local);
  const store = useRrcSessionStore.getState();
  let writeFailed = false;

  for (const [room, msgs] of byRoom) {
    const peerHash = room.slice(1);
    if (!isRrcWhisperPeerHash(peerHash)) continue;
    let nick: string | null = null;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.sender_hash?.toLowerCase() === peerHash && m.nickname?.trim()) {
        nick = m.nickname.trim();
        break;
      }
    }
    const peer: RrcDmPeer = { identity_hash: peerHash, nickname: nick };
    store.openDm(peer, hub, { focus: false });
    upsertRrcOpenDm(hub, peer);
    store.mergeHistoryMessages(hub, room, msgs);

    // Re-persist under the new room key (INSERT OR IGNORE by message_id).
    for (const msg of msgs) {
      try {
        await window.electronAPI.db.insertRrcMessage({
          message_id: msg.id,
          hub_hash: hub,
          room: rrcDmRoomKey(peerHash),
          sender_hash: msg.sender_hash ?? null,
          nickname: msg.nickname ?? null,
          kind: msg.kind,
          body: msg.body,
          timestamp: msg.timestamp,
        });
      } catch (e) {
        writeFailed = true;
        console.warn('[rrcLegacyWhispersMigrate] insert failed ' + errLikeToLogString(e));
      }
    }
  }

  if (!writeFailed) {
    markMigrated(hub);
  }
}
