import type { MeshtasticLinkStats } from '../transportTcpIpc';

interface LinkStatsSource {
  getLinkStats: () => MeshtasticLinkStats;
}

function hasLinkStats(transport: unknown): transport is LinkStatsSource {
  return (
    typeof transport === 'object' &&
    transport !== null &&
    typeof (transport as Partial<LinkStatsSource>).getLinkStats === 'function'
  );
}

function formatAgo(at: number | null, now: number): string {
  return at === null ? 'never' : `${String(now - at)}ms`;
}

/**
 * Watchdog log suffix: raw bytes vs decoded frames tell "radio went silent" apart from
 * "bytes arrive but the framer emits nothing". Empty for transports without counters.
 */
export function formatMeshtasticLinkStats(transport: unknown, now = Date.now()): string {
  if (!hasLinkStats(transport)) return '';
  const s = transport.getLinkStats();
  return (
    ` rawBytes=${String(s.rawBytes)} lastRawAgo=${formatAgo(s.lastRawAt, now)}` +
    ` frames=${String(s.frames)} lastFrameAgo=${formatAgo(s.lastFrameAt, now)}`
  );
}
