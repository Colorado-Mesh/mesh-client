import type {
  ReachCheckApi,
  ReachCheckErrorCode,
  ReachCheckResult,
  ReachCheckSession,
} from '@/shared/reachCheck';

import { MS_PER_MINUTE, MS_PER_SECOND } from '../timeConstants';
import { useReachCheckStore } from './reachCheckStore';

export const REACH_CHECK_POLL_INTERVAL_MS = 4 * MS_PER_SECOND;
/** Hard stop, whatever the server says about expiry. */
export const REACH_CHECK_POLL_MAX_MS = 15 * MS_PER_MINUTE;
/** Consecutive failed fetches before the results line reports the server unreachable. */
const MAX_CONSECUTIVE_FAILURES = 3;

export interface ReachCheckPollerDeps {
  api: Pick<ReachCheckApi, 'getSession'>;
}

/** Timers by session id. A poller looks its entry up by session id each tick, so a message id
 * rename keeps it going and a removed or cleared entry stops it. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function defaultDeps(): ReachCheckPollerDeps {
  return { api: window.electronAPI.reachCheck };
}

function stopReachCheckPolling(sessionId: string): void {
  const timer = timers.get(sessionId);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(sessionId);
}

/** Stops every poller (tests, teardown). */
export function stopAllReachCheckPolling(): void {
  for (const sessionId of [...timers.keys()]) stopReachCheckPolling(sessionId);
}

async function fetchSession(
  deps: ReachCheckPollerDeps,
  origin: string,
  sessionId: string,
): Promise<ReachCheckResult<ReachCheckSession>> {
  try {
    return await deps.api.getSession(origin, sessionId);
  } catch (e: unknown) {
    console.debug('[reachCheckPoller] getSession rejected', e instanceof Error ? e.message : e);
    return { ok: false, error: 'network' };
  }
}

/** Polls one session's results into `useReachCheckStore` until it finishes, is gone, or fails. */
export function startReachCheckPolling(
  sessionId: string,
  deps: ReachCheckPollerDeps = defaultDeps(),
): void {
  if (timers.has(sessionId)) return;
  let failures = 0;

  const finish = (
    key: string,
    patch: { state: 'finished' | 'gone' | 'error'; error?: ReachCheckErrorCode },
  ) => {
    useReachCheckStore.getState().update(key, patch);
    stopReachCheckPolling(sessionId);
  };

  const run = async (): Promise<void> => {
    timers.delete(sessionId);
    const store = useReachCheckStore.getState();
    const key = store.keyForSession(sessionId);
    if (!key) return;
    const entry = store.entries[key];
    if (Date.now() - entry.startedAt >= REACH_CHECK_POLL_MAX_MS) {
      finish(key, { state: 'finished' });
      return;
    }
    const result = await fetchSession(deps, entry.origin, sessionId);
    // The entry may have been cleared, removed or renamed while the request was in flight.
    const currentKey = useReachCheckStore.getState().keyForSession(sessionId);
    if (!currentKey) return;
    if (result.ok) {
      failures = 0;
      const session = result.value;
      useReachCheckStore.getState().update(currentKey, { session });
      if (
        session.status === 'exhausted' ||
        session.status === 'expired' ||
        Date.now() >= session.expiresAt
      ) {
        finish(currentKey, { state: 'finished' });
        return;
      }
    } else if (result.error === 'session_not_found') {
      finish(currentKey, { state: 'gone' });
      return;
    } else {
      failures += 1;
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        finish(currentKey, { state: 'error', error: result.error });
        return;
      }
    }
    schedule();
  };

  const schedule = (): void => {
    timers.set(
      sessionId,
      setTimeout(() => {
        void run();
      }, REACH_CHECK_POLL_INTERVAL_MS),
    );
  };

  schedule();
}
