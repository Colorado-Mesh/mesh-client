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
