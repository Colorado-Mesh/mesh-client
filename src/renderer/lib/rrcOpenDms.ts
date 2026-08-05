/**
 * Persist open RRC per-peer DMs across restart (client-local; not hub JOIN).
 */

import { isRrcWhisperPeerHash, type RrcDmPeer } from '@/renderer/lib/rrcDmRoom';

const OPEN_DMS_PREFIX = 'mesh-client:rrc:openDms:';
const MAX_OPEN_DMS = 50;

function storageKey(hubHash: string): string {
  return OPEN_DMS_PREFIX + hubHash.trim().toLowerCase();
}

function canonicalize(items: RrcDmPeer[]): RrcDmPeer[] {
  const out: RrcDmPeer[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const hash = raw.identity_hash.trim().toLowerCase();
    if (!isRrcWhisperPeerHash(hash) || seen.has(hash)) continue;
    seen.add(hash);
    out.push({
      identity_hash: hash,
      nickname: raw.nickname?.trim() ? raw.nickname.trim() : null,
    });
    if (out.length >= MAX_OPEN_DMS) break;
  }
  return out;
}

export function loadRrcOpenDms(hubHash: string): RrcDmPeer[] {
  try {
    const raw = localStorage.getItem(storageKey(hubHash));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const items: RrcDmPeer[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue;
      const o = row as Record<string, unknown>;
      if (typeof o.identity_hash !== 'string') continue;
      items.push({
        identity_hash: o.identity_hash,
        nickname: typeof o.nickname === 'string' ? o.nickname : null,
      });
    }
    return canonicalize(items);
  } catch {
    // catch-no-log-ok localStorage may be unavailable
    return [];
  }
}

export function saveRrcOpenDms(hubHash: string, dms: RrcDmPeer[]): void {
  try {
    localStorage.setItem(storageKey(hubHash), JSON.stringify(canonicalize(dms)));
  } catch {
    // catch-no-log-ok localStorage may be unavailable
  }
}

export function upsertRrcOpenDm(hubHash: string, peer: RrcDmPeer): RrcDmPeer[] {
  const hash = peer.identity_hash.trim().toLowerCase();
  if (!isRrcWhisperPeerHash(hash)) return loadRrcOpenDms(hubHash);
  const existing = loadRrcOpenDms(hubHash);
  const prior = existing.find((d) => d.identity_hash === hash);
  const nick = peer.nickname?.trim() || null;
  const next = canonicalize([
    { identity_hash: hash, nickname: nick ?? prior?.nickname ?? null },
    ...existing.filter((d) => d.identity_hash !== hash),
  ]);
  saveRrcOpenDms(hubHash, next);
  return next;
}

export function removeRrcOpenDm(hubHash: string, identityHash: string): RrcDmPeer[] {
  const hash = identityHash.trim().toLowerCase();
  const next = loadRrcOpenDms(hubHash).filter((d) => d.identity_hash !== hash);
  saveRrcOpenDms(hubHash, next);
  return next;
}

export function clearRrcOpenDms(hubHash: string): void {
  try {
    localStorage.removeItem(storageKey(hubHash));
  } catch {
    // catch-no-log-ok
  }
}
