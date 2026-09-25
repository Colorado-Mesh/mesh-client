export interface IncidentTrackExemptionInput {
  status: string;
  senderId: string;
  lat?: number;
  lon?: number;
}

/**
 * Sender node ids whose position history must survive retention pruning while their
 * emergency incident is still active (`open` or `acked`; `resolved` releases the hold).
 */
export function nodesExemptFromPositionPrune(
  openIncidents: readonly IncidentTrackExemptionInput[],
): Set<string> {
  const out = new Set<string>();
  for (const inc of openIncidents) {
    if (inc.status !== 'open' && inc.status !== 'acked') continue;
    const id = inc.senderId.trim();
    if (id) out.add(id);
  }
  return out;
}
