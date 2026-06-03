const SECONDS_PER_DAY = 86400;

/** Unix-second cutoff for `meshcore_contacts.last_advert` (stored as epoch seconds, not ms). */
export function meshcoreContactsAgeCutoffSec(days: number, nowMs: number = Date.now()): number {
  if (typeof days !== 'number' || days < 1 || !Number.isFinite(days)) return 0;
  return Math.floor(nowMs / 1000) - Math.floor(days) * SECONDS_PER_DAY;
}
