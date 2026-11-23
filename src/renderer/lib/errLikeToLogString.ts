import { sanitizeLogMessage } from '@/main/sanitize-log-message';

/**
 * Flatten catch parameters for renderer logs so disk-forwarded lines never show "[object Object]"
 * for typical Error instances; plain objects are JSON-stringified when possible.
 */
export function errLikeToLogString(e: unknown): string {
  if (e instanceof Error) {
    return sanitizeLogMessage(e.message);
  }
  if (typeof e === 'object' && e !== null) {
    try {
      return sanitizeLogMessage(JSON.stringify(e));
    } catch (e: unknown) {
      console.debug('[renderer/lib/errLikeToLogString] catch:', e);

      return sanitizeLogMessage('[unserializable]');
    }
  }
  if (e == null) {
    return sanitizeLogMessage(String(e));
  }
  if (
    typeof e === 'string' ||
    typeof e === 'number' ||
    typeof e === 'boolean' ||
    typeof e === 'bigint'
  ) {
    return sanitizeLogMessage(String(e));
  }
  if (typeof e === 'symbol') {
    return sanitizeLogMessage(e.description ?? 'Symbol()');
  }
  if (typeof e === 'function') {
    return sanitizeLogMessage('[function]');
  }
  return sanitizeLogMessage('[unknown]');
}
