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
