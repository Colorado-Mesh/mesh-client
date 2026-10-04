import { errLikeToLogString } from './errLikeToLogString';
import { parseStoredJson } from './parseStoredJson';

export const SERVICE_ANNOUNCEMENT_DISMISS_STORAGE_KEY = 'mesh-client:serviceAnnouncementsDismissed';

/** Cap persisted ids (newest kept); ids for removed announcements age out. */
export const SERVICE_ANNOUNCEMENT_DISMISS_MAX = 200;

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Dismissed announcement ids in dismissal order. Corrupt or unavailable storage reads as empty. */
export function readDismissedServiceAnnouncementIds(): string[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SERVICE_ANNOUNCEMENT_DISMISS_STORAGE_KEY);
  } catch (e) {
    console.debug('[serviceAnnouncementDismiss] read failed ' + errLikeToLogString(e));
    return [];
  }
  const parsed = parseStoredJson<unknown>(raw, 'serviceAnnouncementDismiss');
  if (!Array.isArray(parsed)) return [];
  const ids: string[] = [];
  for (const entry of parsed) {
    if (typeof entry === 'string' && ID_RE.test(entry) && !ids.includes(entry)) ids.push(entry);
  }
  return ids.slice(-SERVICE_ANNOUNCEMENT_DISMISS_MAX);
}

/** Persist `id` as dismissed and return the updated id list (still returned if storage fails). */
export function dismissServiceAnnouncementId(id: string): string[] {
  const next = [...readDismissedServiceAnnouncementIds().filter((x) => x !== id), id].slice(
    -SERVICE_ANNOUNCEMENT_DISMISS_MAX,
  );
  try {
    localStorage.setItem(SERVICE_ANNOUNCEMENT_DISMISS_STORAGE_KEY, JSON.stringify(next));
  } catch (e) {
    console.debug('[serviceAnnouncementDismiss] write failed ' + errLikeToLogString(e));
  }
  return next;
}
