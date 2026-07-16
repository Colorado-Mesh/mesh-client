import type { RrcRoomMember } from '@/shared/rrc-types';

/** True when two hex identity strings refer to the same peer (full hash or rrcd `/who` prefix). */
export function rrcIdentityHashesMatch(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.startsWith('nick:') || y.startsWith('nick:')) return x === y;
  if (!/^[0-9a-f]+$/.test(x) || !/^[0-9a-f]+$/.test(y)) return false;
  const shorter = x.length <= y.length ? x : y;
  const longer = x.length <= y.length ? y : x;
  // rrcd `/who` prints 12-hex prefixes; chat/JOINED use full 32-hex identities.
  return shorter.length >= 8 && longer.startsWith(shorter);
}

function preferIdentityHash(a: string, b: string): string {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (x.startsWith('nick:') && !y.startsWith('nick:')) return y;
  if (y.startsWith('nick:') && !x.startsWith('nick:')) return x;
  if (/^[0-9a-f]+$/.test(x) && /^[0-9a-f]+$/.test(y)) {
    return x.length >= y.length ? x : y;
  }
  return x || y;
}

function preferNickname(
  incoming: string | null | undefined,
  existing: string | null | undefined,
): string | null {
  const inc = incoming?.trim() || null;
  const ex = existing?.trim() || null;
  // Keep a real nick when `/who` only has a bare hash (or a placeholder).
  if (inc && !/^anonymous$/i.test(inc)) return inc;
  if (ex && !/^anonymous$/i.test(ex)) return ex;
  return inc ?? ex;
}

/**
 * Build the visible roster from a `/who` (or JOINED) snapshot while preserving
 * fuller identity hashes and nicknames learned from live chat.
 *
 * When `keepUnmatchedExisting` is true (default for replace/`/who`), peers we
 * already know who are missing from a truncated hub NOTICE stay listed, with
 * hub rows still winning for matching identities.
 */
export function coalesceRrcMemberRoster(
  incoming: RrcRoomMember[],
  existing: RrcRoomMember[] | undefined,
  opts?: { keepUnmatchedExisting?: boolean },
): RrcRoomMember[] {
  const base = existing ?? [];
  const used = new Set<number>();
  const out: RrcRoomMember[] = [];

  for (const inc of incoming) {
    let matchIdx = -1;
    for (let i = 0; i < base.length; i++) {
      if (used.has(i)) continue;
      const ex = base[i];
      if (!ex) continue;
      const incNick = inc.nickname?.trim();
      const exNick = ex.nickname?.trim();
      const hashMatch = rrcIdentityHashesMatch(ex.identity_hash, inc.identity_hash);
      const nickMatch = incNick?.toLowerCase() === exNick?.toLowerCase() && Boolean(incNick);
      if (hashMatch || nickMatch) {
        matchIdx = i;
        break;
      }
    }
    if (matchIdx >= 0) {
      used.add(matchIdx);
      const ex = base[matchIdx];
      if (!ex) continue;
      out.push({
        identity_hash: preferIdentityHash(inc.identity_hash, ex.identity_hash),
        nickname: preferNickname(inc.nickname, ex.nickname),
      });
    } else {
      out.push({
        identity_hash: inc.identity_hash.trim().toLowerCase(),
        nickname: preferNickname(inc.nickname, null),
      });
    }
  }
  if (opts?.keepUnmatchedExisting !== false) {
    for (let i = 0; i < base.length; i++) {
      if (used.has(i)) continue;
      const ex = base[i];
      if (ex) out.push(ex);
    }
  }
  return out;
}

/** Deduplicate members that share a hash prefix or the same nick. */
export function dedupeRrcMembers(members: RrcRoomMember[]): RrcRoomMember[] {
  const out: RrcRoomMember[] = [];
  for (const m of members) {
    const mNick = m.nickname?.trim();
    const idx = out.findIndex((o) => {
      const oNick = o.nickname?.trim();
      return (
        rrcIdentityHashesMatch(o.identity_hash, m.identity_hash) ||
        (oNick?.toLowerCase() === mNick?.toLowerCase() && Boolean(mNick))
      );
    });
    if (idx < 0) {
      out.push(m);
      continue;
    }
    const prev = out[idx];
    if (!prev) {
      out.push(m);
      continue;
    }
    out[idx] = {
      identity_hash: preferIdentityHash(prev.identity_hash, m.identity_hash),
      nickname: preferNickname(m.nickname, prev.nickname),
    };
  }
  return out;
}
