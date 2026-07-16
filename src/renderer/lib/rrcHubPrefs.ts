const HUB_AUTO_JOIN_KEY = 'mesh-client:rrc:hubAutoJoin';

function readRawStringList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    // catch-no-log-ok localStorage may be unavailable
    return [];
  }
}

function writeStringList(key: string, hubs: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(hubs));
  } catch {
    // catch-no-log-ok localStorage may be unavailable
  }
}

function canonicalizeHubList(hubs: string[]): string[] {
  return [
    ...new Set(
      hubs
        .map((h) => h.trim().toLowerCase().replace(/:/g, ''))
        .filter((h) => h.length === 32 && /^[0-9a-f]+$/.test(h)),
    ),
  ];
}

/** Soft cap — must match sidecar MAX_HUB_SESSIONS. */
export const MAX_RRC_HUB_SESSIONS = 8;

export function loadRrcHubAutoJoin(): string[] {
  const hubs = canonicalizeHubList(readRawStringList(HUB_AUTO_JOIN_KEY));
  try {
    const raw = localStorage.getItem(HUB_AUTO_JOIN_KEY);
    if (raw !== JSON.stringify(hubs)) {
      writeStringList(HUB_AUTO_JOIN_KEY, hubs);
    }
  } catch {
    // catch-no-log-ok
  }
  return hubs;
}

export function saveRrcHubAutoJoin(hubs: string[]): void {
  writeStringList(HUB_AUTO_JOIN_KEY, canonicalizeHubList(hubs));
}

export function isRrcHubAutoJoin(hubHash: string): boolean {
  const key = hubHash.trim().toLowerCase().replace(/:/g, '');
  return loadRrcHubAutoJoin().includes(key);
}

export function toggleRrcHubAutoJoin(hubHash: string): string[] {
  const key = hubHash.trim().toLowerCase().replace(/:/g, '');
  if (key.length !== 32) return loadRrcHubAutoJoin();
  const prev = loadRrcHubAutoJoin();
  const next = prev.includes(key) ? prev.filter((h) => h !== key) : [...prev, key];
  saveRrcHubAutoJoin(next);
  return next;
}

/** MeshCore-rooms-style hub list marker. */
export type RrcHubSidebarMarkerKind = 'connected' | 'connecting' | 'autoJoinNotConnected' | 'idle';

export interface RrcHubSidebarMarker {
  kind: RrcHubSidebarMarkerKind;
  glyph: string;
  colorClass: string;
}

export function resolveRrcHubSidebarMarker(opts: {
  status: string | null | undefined;
  autoJoin: boolean;
}): RrcHubSidebarMarker {
  const status = (opts.status ?? '').toLowerCase();
  if (status === 'active' || status === 'reconnecting') {
    return { kind: 'connected', glyph: '●', colorClass: 'text-brand-green' };
  }
  if (status === 'connecting' || status === 'awaiting_welcome') {
    return { kind: 'connecting', glyph: '◌', colorClass: 'text-amber-300' };
  }
  if (opts.autoJoin) {
    return { kind: 'autoJoinNotConnected', glyph: '◐', colorClass: 'text-sky-400' };
  }
  return { kind: 'idle', glyph: '○', colorClass: 'text-gray-500' };
}
