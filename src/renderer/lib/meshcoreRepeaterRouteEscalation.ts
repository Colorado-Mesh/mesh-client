import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import { MESHCORE_REPEATER_ROUTE_ESCALATION_COOLDOWN_MS } from './timeConstants';

export type MeshcoreRepeaterRouteKind = 'direct' | 'flood' | 'unknown';

/**
 * What a missed reply does, chosen per repeater (issue 1566).
 * - `auto`: clear the companion route and resend once as a flood (the default).
 * - `direct`: keep the route and resend once on it; never clear it, never flood.
 * - `zeroHop`: write a zero-hop route before every send, then behave as `direct`.
 */
export type MeshcoreRepeaterRouteMode = 'auto' | 'direct' | 'zeroHop';

/** One send of a repeater request. */
export interface MeshcoreRepeaterRequestAttempt {
  /** The companion route was cleared and this send floods. */
  escalated: boolean;
  /** A resend on the same route after a timeout (Direct only and Zero-hop modes). */
  sameRouteRetry: boolean;
}

/** Identity + live connection snapshot for one admin/radio request (captured at call start). */
export interface MeshcoreRepeaterEscalationContext {
  identity: string | null | undefined;
  connection: unknown;
}

export interface MeshcoreRepeaterRouteEscalationDeps {
  /** Clear the companion contact path so the next send floods. */
  resetContactPath: (nodeId: number) => Promise<boolean>;
  /** Current route classification before the failed attempt. */
  resolveRouteKind: (nodeId: number) => MeshcoreRepeaterRouteKind;
  /**
   * The same classification, ignoring a learned path the radio dropped when its contact was
   * re-added. Direct only reads it to avoid a resend that would flood. Missing means
   * `resolveRouteKind`.
   */
  resolveCurrentRouteKind?: (nodeId: number) => MeshcoreRepeaterRouteKind;
  /** MeshCore identity scope for per-identity cooldown (defaults to global when omitted). */
  escalationScope?: () => string | null | undefined;
  /** Snapshot the active identity and connection when the request starts. */
  captureEscalationContext?: () => MeshcoreRepeaterEscalationContext;
  /**
   * Returns false when the request should not continue (typically no live connection).
   * Identity alone may change after configure. After a successful `resetContactPath`, Auto
   * mode always floods without re-checking this — the reset already spoke to the radio, and
   * `connRef` can be rewritten mid-await on slow runners while the closed-over handle stays up.
   */
  isEscalationContextCurrent?: (ctx: MeshcoreRepeaterEscalationContext) => boolean;
  /** Per-repeater choice of what a timeout does; read once per call. Missing means `auto`. */
  routeMode?: (nodeId: number) => MeshcoreRepeaterRouteMode;
  /**
   * Point the companion contact at the node with a zero-hop route. Called before every send in
   * `zeroHop` mode; a rejection stops the request before anything is sent.
   */
  ensureZeroHopRoute?: (nodeId: number) => Promise<void>;
  nowMs?: () => number;
  cooldownMs?: number;
}

/** meshcore.js reports the contact `outPathLen` byte raw; firmware OUT_PATH_UNKNOWN is 0xFF. */
export const MESHCORE_OUT_PATH_UNKNOWN_BYTE = 0xff;

/**
 * Record that the radio now holds no route to `nodeId` (a path reset, or a contact re-added with
 * OUT_PATH_UNKNOWN). Without it a cached zero-hop route lets the next Zero-hop request skip its
 * write and flood. The learned path the app keeps for Ping and hop display is left alone.
 */
export function noteRadioContactRouteUnknown(
  radioPathLens: Map<number, number>,
  nodeId: number,
): void {
  radioPathLens.set(nodeId >>> 0, MESHCORE_OUT_PATH_UNKNOWN_BYTE);
}

/**
 * A contact was re-added to the radio with no route. Caches the 0xFF length (as
 * `noteRadioContactRouteUnknown`) and records the learned path the app still keeps, which the
 * radio no longer uses. The path itself stays for Ping and hop display.
 */
export function noteRadioContactReadded(
  radioPathLens: Map<number, number>,
  droppedPaths: Map<number, Uint8Array>,
  outPaths: Map<number, Uint8Array>,
  nodeId: number,
): void {
  const id = nodeId >>> 0;
  noteRadioContactRouteUnknown(radioPathLens, id);
  const kept = outPaths.get(id);
  if (kept) droppedPaths.set(id, kept);
  else droppedPaths.delete(id);
}

/**
 * The learned path, unless it is the one the radio dropped at its last re-add. A path learned
 * afterwards is a new array, so it counts even before the cached length is refreshed.
 */
export function meshcoreLearnedPathSinceRadioReset(
  outPaths: Map<number, Uint8Array>,
  droppedPaths: Map<number, Uint8Array>,
  nodeId: number,
): Uint8Array | undefined {
  const id = nodeId >>> 0;
  const path = outPaths.get(id);
  return path !== undefined && droppedPaths.get(id) === path ? undefined : path;
}

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

const lastEscalationByNode = new Map<string, number>();

function escalationCooldownKey(nodeId: number, scope: string | null | undefined): string {
  const normalizedId = nodeId >>> 0;
  const scopeKey = scope?.trim() ?? '';
  return scopeKey ? `${scopeKey}:${normalizedId}` : String(normalizedId);
}

export function clearMeshcoreRepeaterRouteEscalationForScope(scope: string): void {
  const prefix = `${scope.trim()}:`;
  for (const key of [...lastEscalationByNode.keys()]) {
    if (key.startsWith(prefix)) lastEscalationByNode.delete(key);
  }
}

export function clearMeshcoreRepeaterRouteEscalationStateForTests(): void {
  lastEscalationByNode.clear();
}

/**
 * A zero-hop route write that failed before a send. Nothing was sent, so this is never a request
 * timeout: no login and no resend may follow it, even when the write itself timed out. Keeps the
 * write's message so the row shows the same error.
 */
export class MeshcoreRepeaterRoutePrepError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'MeshcoreRepeaterRoutePrepError';
  }
}

/** Run the Zero-hop route write; any failure becomes a {@link MeshcoreRepeaterRoutePrepError}. */
async function prepareZeroHopRoute(
  deps: MeshcoreRepeaterRouteEscalationDeps,
  nodeId: number,
): Promise<void> {
  if (!deps.ensureZeroHopRoute) return;
  try {
    await deps.ensureZeroHopRoute(nodeId);
  } catch (e: unknown) {
    throw new MeshcoreRepeaterRoutePrepError(e);
  }
}

/**
 * For callers that log in inside `withMeshcoreRepeaterRouteEscalation` and then send: in
 * Zero-hop mode, write the route again after the login, because a login can re-add an evicted
 * contact with no route and the send would flood. No-op in other modes; the write is skipped
 * when the radio already holds a zero-hop route. A failed write rejects with
 * `MeshcoreRepeaterRoutePrepError`, which is not retried as a timeout.
 */
export async function prepareMeshcoreZeroHopRouteAfterLogin(
  deps: MeshcoreRepeaterRouteEscalationDeps,
  nodeId: number,
): Promise<void> {
  const normalizedId = nodeId >>> 0;
  if ((deps.routeMode?.(normalizedId) ?? 'auto') !== 'zeroHop') return;
  await prepareZeroHopRoute(deps, normalizedId);
}

export function isMeshcoreRepeaterTimeoutError(error: unknown): boolean {
  if (error instanceof MeshcoreRepeaterRoutePrepError) return false;
  const msg = errLikeToLogString(error).toLowerCase();
  // SENT-ack failures are local companion/queue stalls — flooding the RF path will not help.
  if (msg.includes('waiting for sent acknowledgment')) return false;
  return msg.includes('timeout') || msg.includes('timed out');
}

/**
 * Run `fn` once; on timeout only, reset the companion path and retry once when the prior
 * route was direct (or unknown with a clearable path). Never escalates on radio ERR,
 * when already flood, or during the per-node cooldown.
 *
 * `direct` and `zeroHop` route modes replace the reset and flood with one resend on the same
 * route (no cooldown). Failure point: in `zeroHop` mode a failed route write rejects before any
 * send, so the request never goes out on whatever route the radio held.
 */
export async function withMeshcoreRepeaterRouteEscalation<T>(
  nodeId: number,
  deps: MeshcoreRepeaterRouteEscalationDeps,
  fn: (attempt: MeshcoreRepeaterRequestAttempt) => Promise<T>,
): Promise<T> {
  const normalizedId = nodeId >>> 0;
  const mode = deps.routeMode?.(normalizedId) ?? 'auto';
  const now = deps.nowMs ?? Date.now;
  const cooldownMs = deps.cooldownMs ?? MESHCORE_REPEATER_ROUTE_ESCALATION_COOLDOWN_MS;
  const requestContext = deps.captureEscalationContext?.();
  const identityForCooldown = requestContext?.identity ?? deps.escalationScope?.() ?? undefined;

  const abortIfStale = (): void => {
    if (
      requestContext &&
      deps.isEscalationContextCurrent &&
      !deps.isEscalationContextCurrent(requestContext)
    ) {
      throw new Error('meshcore escalation context stale');
    }
  };

  const ensureZeroHop = async (): Promise<void> => {
    if (mode === 'zeroHop') await prepareZeroHopRoute(deps, normalizedId);
  };

  await ensureZeroHop();
  try {
    return await fn({ escalated: false, sameRouteRetry: false });
  } catch (firstErr) {
    if (!isMeshcoreRepeaterTimeoutError(firstErr)) {
      throw firstErr;
    }
    try {
      abortIfStale();
    } catch {
      throw firstErr;
    }
    if (mode !== 'auto') {
      // A Direct only route the radio already floods gets no help from a resend here; the
      // login fallback still asks again after a login, as it does in Auto.
      if (
        mode === 'direct' &&
        (deps.resolveCurrentRouteKind ?? deps.resolveRouteKind)(normalizedId) === 'flood'
      ) {
        throw firstErr;
      }
      console.warn(
        `mcL1506 [meshcoreRepeaterRouteEscalation] timeout node=${normalizedId} mode=${mode}; resending on the same route`,
      );
      await ensureZeroHop();
      try {
        abortIfStale();
      } catch {
        throw firstErr;
      }
      return fn({ escalated: false, sameRouteRetry: true });
    }
    const routeKind = deps.resolveRouteKind(normalizedId);
    if (routeKind === 'flood') {
      throw firstErr;
    }
    const cooldownKey = escalationCooldownKey(normalizedId, identityForCooldown);
    const last = lastEscalationByNode.get(cooldownKey);
    if (last != null && now() - last < cooldownMs) {
      console.warn(
        `mcL0918 [meshcoreRepeaterRouteEscalation] cooldown active node=${normalizedId}; not flooding`,
      );
      throw firstErr;
    }
    console.warn(
      `mcL0919 [meshcoreRepeaterRouteEscalation] timeout node=${normalizedId} route=${routeKind}; resetting path for flood retry`,
    );
    let resetOk: boolean;
    try {
      resetOk = await deps.resetContactPath(normalizedId);
    } catch (resetErr) {
      console.warn(
        `mcL0920 [meshcoreRepeaterRouteEscalation] resetContactPath failed node=${normalizedId} ` +
          errLikeToLogString(resetErr),
      );
      throw firstErr;
    }
    if (!resetOk) {
      console.warn(
        `mcL0921 [meshcoreRepeaterRouteEscalation] resetContactPath returned false node=${normalizedId}; not retrying`,
      );
      throw firstErr;
    }
    // Do not abortIfStale after a successful reset: the radio already accepted CMD_RESET_PATH.
    // On macOS E2E, configure can rewrite connRef during the reset await; treating that as
    // stale left the contact at 0xFF with no status:flood resend.
    lastEscalationByNode.set(cooldownKey, now());
    return fn({ escalated: true, sameRouteRetry: false });
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
 * the retry logs in first (the flood resend in Auto, the same-route resend in Direct only and
 * Zero-hop). Failure point: a login that gets no reply rejects with its own timeout and the
 * request is not sent again. At most one login per call. In Zero-hop the route is written again
 * after the login, because a login can re-add an evicted contact with no route (it would flood).
 */
export async function withMeshcoreRepeaterLoginFallback<T>(
  nodeId: number,
  deps: MeshcoreRepeaterLoginFallbackDeps,
  fn: (attempt: MeshcoreRepeaterRequestAttempt & { loggedIn: boolean }) => Promise<T>,
): Promise<T> {
  const normalizedId = nodeId >>> 0;
  // One mode for the whole call, shared with the escalation below.
  const mode = deps.routeMode?.(normalizedId) ?? 'auto';
  // Held in an object so the catch below reads the value the closure wrote.
  const state = { loggedIn: false };
  const loginOnce = async (): Promise<void> => {
    state.loggedIn = true;
    await deps.login(normalizedId);
    if (mode === 'zeroHop') await prepareZeroHopRoute(deps, normalizedId);
  };
  const escalationDeps = { ...deps, routeMode: () => mode };
  try {
    return await withMeshcoreRepeaterRouteEscalation(
      normalizedId,
      escalationDeps,
      async (attempt) => {
        const isRetry = attempt.escalated || attempt.sameRouteRetry;
        if (isRetry && !state.loggedIn && deps.canLogin(normalizedId)) await loginOnce();
        return fn({ ...attempt, loggedIn: state.loggedIn });
      },
    );
  } catch (err) {
    if (state.loggedIn || !isMeshcoreRepeaterTimeoutError(err) || !deps.canLogin(normalizedId)) {
      throw err;
    }
    console.warn(
      `mcL0922 [meshcoreRepeaterRouteEscalation] timeout node=${normalizedId}; logging in before one more attempt`,
    );
    await loginOnce();
    return fn({ escalated: false, sameRouteRetry: false, loggedIn: state.loggedIn });
  }
}
