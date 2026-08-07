/** Safe readers for LRGP `Session.metadata` (untyped JSON from the sidecar). */

export function gamesMetaStr(
  metadata: Record<string, unknown> | undefined,
  key: string,
  fallback = '',
): string {
  const v = metadata?.[key];
  return typeof v === 'string' ? v : fallback;
}

export function gamesMetaBool(metadata: Record<string, unknown> | undefined, key: string): boolean {
  return metadata?.[key] === true;
}

export function gamesMetaNum(
  metadata: Record<string, unknown> | undefined,
  key: string,
  fallback = 0,
): number {
  const v = metadata?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function gamesMetaStrArray(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string[] {
  const v = metadata?.[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** True when the local player initiated (challenged) this session. */
export function isGamesSessionInitiator(session: {
  initiator: string;
  identity_id: string;
}): boolean {
  return Boolean(
    session.initiator && session.identity_id && session.initiator === session.identity_id,
  );
}

/** Hash of who offered the pending draw (`metadata.draw_offered_by`), or empty. */
export function gamesDrawOfferedBy(metadata: Record<string, unknown> | undefined): string {
  return gamesMetaStr(metadata, 'draw_offered_by');
}

/** True when a draw is pending and the local player offered it. */
export function isGamesDrawOfferFromSelf(session: {
  identity_id: string;
  metadata?: Record<string, unknown>;
}): boolean {
  if (!gamesMetaBool(session.metadata, 'draw_offered')) return false;
  const owner = gamesDrawOfferedBy(session.metadata);
  return Boolean(owner && session.identity_id && owner === session.identity_id);
}

/**
 * True when a draw is pending and Accept/Decline should be shown.
 * Missing `draw_offered_by` (older clients) is treated as an opponent offer.
 */
export function isGamesDrawOfferFromOpponent(session: {
  identity_id: string;
  metadata?: Record<string, unknown>;
}): boolean {
  return gamesMetaBool(session.metadata, 'draw_offered') && !isGamesDrawOfferFromSelf(session);
}
