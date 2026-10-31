/**
 * Lifetime-since-boot TX mix from MeshCore packet stats.
 * Channel messages and flood adverts are always flood-routed, so a high % is normal.
 * Returns null when there are no sent flood/direct samples.
 */
export function meshcoreFloodSendPercent(nSentFlood: number, nSentDirect: number): number | null {
  const total = nSentFlood + nSentDirect;
  if (total <= 0) return null;
  return Math.round((nSentFlood / total) * 100);
}
