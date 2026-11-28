import { normalizeReachCheckOrigin } from '@/shared/reachCheck';

export type ReachCheckServerInputError = 'invalid_url' | 'not_public';

/**
 * Reads a typed server address: a checked origin to save, `''` to clear, or the reason it was
 * refused. Local `http://127.0.0.1:<port>` passes here; main still refuses it outside unpackaged
 * development builds.
 */
export function readReachCheckServerInput(
  raw: string,
): { ok: true; origin: string } | { ok: false; error: ReachCheckServerInputError } {
  if (!raw.trim()) return { ok: true, origin: '' };
  return normalizeReachCheckOrigin(raw, { allowLocal: true });
}
