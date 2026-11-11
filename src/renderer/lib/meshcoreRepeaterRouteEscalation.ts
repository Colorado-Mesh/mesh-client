import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import { MESHCORE_REPEATER_ROUTE_ESCALATION_COOLDOWN_MS } from './timeConstants';

export type MeshcoreRepeaterRouteKind = 'direct' | 'flood' | 'unknown';

export interface MeshcoreRepeaterRouteEscalationDeps {
  /** Clear the companion contact path so the next send floods. */
  resetContactPath: (nodeId: number) => Promise<boolean>;
  /** Current route classification before the failed attempt. */
  resolveRouteKind: (nodeId: number) => MeshcoreRepeaterRouteKind;
  nowMs?: () => number;
  cooldownMs?: number;
}

/** meshcore.js reports the contact `outPathLen` byte raw; firmware OUT_PATH_UNKNOWN is 0xFF. */
export const MESHCORE_OUT_PATH_UNKNOWN_BYTE = 0xff;

/**
 * Classify how the companion will send to a contact, from the app's stored hash path and
 * the last `outPathLen` byte read from the radio contact. A stored path wins because it can
 * be newer than that cached length (PathUpdated refreshes the path, not the length).
 *
 * Firmware floods only when `out_path_len` is OUT_PATH_UNKNOWN (0xFF, or negative when read
 * signed). A length of 0 is a known zero-hop route and is sent direct, so a stale zero-hop
 * route needs the flood retry as much as a multi-hop one does.
 */
export function meshcoreRepeaterRouteKind(
  storedPath: Uint8Array | undefined,
  radioContactPathLen: number | null | undefined,
): MeshcoreRepeaterRouteKind {
  if (storedPath && storedPath.length > 0) return 'direct';
  if (radioContactPathLen == null || !Number.isFinite(radioContactPathLen)) return 'unknown';
  // Only 0xFF means unknown. meshcore.js reads the byte signed, so 0xFF arrives as -1 and
  // packed 3-byte-hash lengths (0x80 and up) arrive as other negatives: those are routes.
  if (radioContactPathLen === -1 || radioContactPathLen === MESHCORE_OUT_PATH_UNKNOWN_BYTE) {
    return 'flood';
  }
  return 'direct';
}

const lastEscalationByNode = new Map<number, number>();

export function clearMeshcoreRepeaterRouteEscalationStateForTests(): void {
  lastEscalationByNode.clear();
}

export function isMeshcoreRepeaterTimeoutError(error: unknown): boolean {
  const msg = errLikeToLogString(error).toLowerCase();
  // SENT-ack failures are local companion/queue stalls — flooding the RF path will not help.
  if (msg.includes('waiting for sent acknowledgment')) return false;
  return msg.includes('timeout') || msg.includes('timed out');
}

/**
 * Run `fn` once; on timeout only, reset the companion path and retry once when the prior
 * route was direct (or unknown with a clearable path). Never escalates on radio ERR,
 * when already flood, or during the per-node cooldown.
 */
export async function withMeshcoreRepeaterRouteEscalation<T>(
  nodeId: number,
  deps: MeshcoreRepeaterRouteEscalationDeps,
  fn: (attempt: { escalated: boolean }) => Promise<T>,
): Promise<T> {
  const normalizedId = nodeId >>> 0;
  const now = deps.nowMs ?? Date.now;
  const cooldownMs = deps.cooldownMs ?? MESHCORE_REPEATER_ROUTE_ESCALATION_COOLDOWN_MS;

  try {
    return await fn({ escalated: false });
  } catch (firstErr) {
    if (!isMeshcoreRepeaterTimeoutError(firstErr)) {
      throw firstErr;
    }
    const routeKind = deps.resolveRouteKind(normalizedId);
    if (routeKind === 'flood') {
      throw firstErr;
    }
    const last = lastEscalationByNode.get(normalizedId);
    if (last != null && now() - last < cooldownMs) {
      console.warn(
        `[meshcoreRepeaterRouteEscalation] cooldown active node=${normalizedId}; not flooding`,
      );
      throw firstErr;
    }
    console.warn(
      `[meshcoreRepeaterRouteEscalation] timeout node=${normalizedId} route=${routeKind}; resetting path for flood retry`,
    );
    let resetOk: boolean;
    try {
      resetOk = await deps.resetContactPath(normalizedId);
    } catch (resetErr) {
      console.warn(
        `[meshcoreRepeaterRouteEscalation] resetContactPath failed node=${normalizedId} ` +
          errLikeToLogString(resetErr),
      );
      throw firstErr;
    }
    if (!resetOk) {
      console.warn(
        `[meshcoreRepeaterRouteEscalation] resetContactPath returned false node=${normalizedId}; not retrying`,
      );
      throw firstErr;
    }
    lastEscalationByNode.set(normalizedId, now());
    return fn({ escalated: true });
  }
}

export interface MeshcoreRepeaterLoginFallbackDeps extends MeshcoreRepeaterRouteEscalationDeps {
  /** True when a password is available to log in with. */
  canLogin: (nodeId: number) => boolean;
  /** Send one login and wait for its reply; rejects when it fails. */
  login: (nodeId: number) => Promise<void>;
}

/**
 * Route escalation plus one login when a request goes unanswered.
 *
 * Repeater firmware answers Status only for a companion in its access list, and drops
 * everything else silently. Guest entries are not saved, so a reboot forgets them. The
 * first attempt stays login-free (a known companion is answered at once); after a timeout
 * the retry logs in first. Failure point: a login that gets no reply rejects with its own
 * timeout and the request is not sent again. At most one login per call.
 */
export async function withMeshcoreRepeaterLoginFallback<T>(
  nodeId: number,
  deps: MeshcoreRepeaterLoginFallbackDeps,
  fn: (attempt: { escalated: boolean; loggedIn: boolean }) => Promise<T>,
): Promise<T> {
  const normalizedId = nodeId >>> 0;
  // Held in an object so the catch below reads the value the closure wrote.
  const state = { loggedIn: false };
  const loginOnce = async (): Promise<void> => {
    state.loggedIn = true;
    await deps.login(normalizedId);
  };
  try {
    return await withMeshcoreRepeaterRouteEscalation(normalizedId, deps, async ({ escalated }) => {
      if (escalated && !state.loggedIn && deps.canLogin(normalizedId)) await loginOnce();
      return fn({ escalated, loggedIn: state.loggedIn });
    });
  } catch (err) {
    if (state.loggedIn || !isMeshcoreRepeaterTimeoutError(err) || !deps.canLogin(normalizedId)) {
      throw err;
    }
    console.warn(
      `[meshcoreRepeaterRouteEscalation] timeout node=${normalizedId}; logging in before one more attempt`,
    );
    await loginOnce();
    return fn({ escalated: false, loggedIn: state.loggedIn });
  }
}
