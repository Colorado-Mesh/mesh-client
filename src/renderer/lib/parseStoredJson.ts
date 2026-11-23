import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
/**
 * Parse persisted JSON (e.g. localStorage); warn on parse failure.
 * See AGENTS.md §3 (Security & Error Handling) for logging expectations.
 */
// Generic is only for call-site inference (return is still `as T`); keep the ergonomic API.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T is for caller inference only
export function parseStoredJson<T>(raw: string | null, context: string): T | null {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') {
    console.warn(`mcL0988 [parseStoredJson] ${context} failed expected string, got ${typeof raw}`);
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn(`mcL0989 [parseStoredJson] ${context} failed` + ' ' + errLikeToLogString(e));
    return null;
  }
}
