/**
 * Path-medium preference / per-peer pins (sidecar HTTP contract).
 *
 * Global preference and per-dest pins are applied in rsReticulum path ranking
 * so Chat, Nomad, rncp, and probes all share the same active egress.
 */

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { classifyReticulumVia } from '@/renderer/lib/reticulum/classifyReticulumVia';
import {
  activeReticulumPathSlot,
  backupReticulumPathSlots,
  type PathMedium,
  type ReticulumPathSlot,
} from '@/renderer/lib/reticulum/reticulumPathSlots';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import { applyReticulumPeerActivePathSlot } from '@/renderer/stores/reticulumPeerStore';

export type PathMediumPreference = 'lowest' | 'network' | 'rf';
export type { PathMedium, ReticulumPathSlot };
export { activeReticulumPathSlot, backupReticulumPathSlots };
/** UI pin control: Auto follows the global preference. */
export type PeerMediumPinChoice = 'auto' | PathMedium;

export interface ReticulumPeerPathsResult {
  ok: boolean;
  destination_hash?: string;
  preference?: PathMediumPreference;
  pin?: PathMedium | null;
  effective_preference?: PathMediumPreference | null;
  live?: boolean;
  paths: ReticulumPathSlot[];
  error?: string;
}

export function parsePathMediumPreference(raw: unknown): PathMediumPreference | null {
  if (typeof raw !== 'string') return null;
  const token = raw.trim().toLowerCase();
  if (token === 'lowest' || token === 'network' || token === 'rf') return token;
  return null;
}

export function parsePathMedium(raw: unknown): PathMedium | null {
  if (typeof raw !== 'string') return null;
  const token = raw.trim().toLowerCase();
  if (token === 'rf' || token === 'network') return token;
  return null;
}

/** Map UI/interface classification onto path-medium tokens (ble counts as RF). */
export function pathMediumFromInterfaceNameOrType(nameOrType: string): PathMedium {
  const via = classifyReticulumVia(nameOrType);
  return via === 'rf' || via === 'ble' ? 'rf' : 'network';
}

function parsePathSlot(raw: unknown): ReticulumPathSlot | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const hops =
    typeof o.hops === 'number' && Number.isFinite(o.hops) ? Math.max(0, Math.floor(o.hops)) : null;
  const interfaceId =
    typeof o.interface_id === 'number' && Number.isFinite(o.interface_id)
      ? Math.floor(o.interface_id)
      : null;
  return {
    active: Boolean(o.active),
    hops,
    via_hash: typeof o.via_hash === 'string' ? o.via_hash : null,
    interface: typeof o.interface === 'string' ? o.interface : null,
    interface_id: interfaceId,
    medium: parsePathMedium(o.medium),
    timestamp: typeof o.timestamp === 'number' ? o.timestamp : null,
    expires: typeof o.expires === 'number' ? o.expires : null,
    expired: Boolean(o.expired),
  };
}

export function parsePeerPathsResponse(body: unknown): ReticulumPeerPathsResult {
  if (!body || typeof body !== 'object') {
    return { ok: false, paths: [], error: 'invalid_response' };
  }
  const o = body as Record<string, unknown>;
  if (o.ok === false) {
    return {
      ok: false,
      paths: [],
      error: typeof o.error === 'string' ? o.error : 'request_failed',
    };
  }
  const pathsRaw = Array.isArray(o.paths) ? o.paths : [];
  const paths = pathsRaw
    .map(parsePathSlot)
    .filter((slot): slot is ReticulumPathSlot => slot != null)
    .slice(0, 3);
  return {
    ok: true,
    destination_hash: typeof o.destination_hash === 'string' ? o.destination_hash : undefined,
    preference: parsePathMediumPreference(o.preference) ?? undefined,
    pin: o.pin === null ? null : (parsePathMedium(o.pin) ?? null),
    effective_preference:
      o.effective_preference == null
        ? null
        : (parsePathMediumPreference(o.effective_preference) ?? null),
    live: typeof o.live === 'boolean' ? o.live : undefined,
    paths,
  };
}

export async function fetchPathMediumPreference(): Promise<{
  ok: boolean;
  preference: PathMediumPreference;
  error?: string;
}> {
  if (!(await isReticulumSidecarRunning())) {
    return { ok: false, preference: 'lowest', error: 'sidecar_not_running' };
  }
  try {
    const body = await window.electronAPI.reticulum.proxyGet(
      '/api/v1/settings/path-medium-preference',
    );
    if (!body || typeof body !== 'object') {
      return { ok: false, preference: 'lowest', error: 'invalid_response' };
    }
    const o = body as Record<string, unknown>;
    const preference = parsePathMediumPreference(o.preference) ?? 'lowest';
    return { ok: o.ok !== false, preference };
  } catch (e) {
    // catch-no-log-ok error returned to caller
    return { ok: false, preference: 'lowest', error: errLikeToLogString(e) };
  }
}

export async function setPathMediumPreference(
  preference: PathMediumPreference,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await isReticulumSidecarRunning())) {
    return { ok: false, error: 'sidecar_not_running' };
  }
  try {
    const body = (await window.electronAPI.reticulum.proxyPut(
      '/api/v1/settings/path-medium-preference',
      { preference },
    )) as { ok?: boolean; error?: string };
    return { ok: Boolean(body.ok), error: body.error };
  } catch (e) {
    // catch-no-log-ok error returned to caller
    return { ok: false, error: errLikeToLogString(e) };
  }
}

export async function fetchReticulumPeerPaths(hash: string): Promise<ReticulumPeerPathsResult> {
  const clean = hash.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(clean)) {
    return { ok: false, paths: [], error: 'invalid_hash' };
  }
  if (!(await isReticulumSidecarRunning())) {
    return { ok: false, paths: [], error: 'sidecar_not_running' };
  }
  try {
    const body = await window.electronAPI.reticulum.proxyGet(`/api/v1/peers/${clean}/paths`);
    return parsePeerPathsResponse(body);
  } catch (e) {
    // catch-no-log-ok error returned to caller
    return { ok: false, paths: [], error: errLikeToLogString(e) };
  }
}

/** Settle after fire-and-forget path request before reading slots. */
export const RETICULUM_PATH_SETTLE_MS = 800;
/** Second attempt when the first `/paths` read is still empty. */
export const RETICULUM_PATH_RETRY_MS = 1200;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Fetch ranked path slots and apply the active route onto the peer store
 * (peers + contacts + history). Optional settle/retry for post-RequestPath timing.
 * Returns the last `/paths` payload (for Medium / backup UI).
 */
export async function refreshReticulumPeerRouteFromPaths(
  hash: string,
  opts?: { settleMs?: number; retryMs?: number },
): Promise<ReticulumPeerPathsResult> {
  const settleMs = opts?.settleMs ?? 0;
  if (settleMs > 0) await sleepMs(settleMs);
  const first = await fetchReticulumPeerPaths(hash);
  if (applyReticulumPeerActivePathSlot(hash, first)) return first;
  const retryMs = opts?.retryMs ?? 0;
  if (retryMs <= 0) return first;
  await sleepMs(retryMs);
  const second = await fetchReticulumPeerPaths(hash);
  applyReticulumPeerActivePathSlot(hash, second);
  return second;
}

export async function setReticulumPeerMediumPin(
  hash: string,
  pin: PathMedium | null,
): Promise<{ ok: boolean; error?: string }> {
  const clean = hash.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(clean)) {
    return { ok: false, error: 'invalid_hash' };
  }
  if (!(await isReticulumSidecarRunning())) {
    return { ok: false, error: 'sidecar_not_running' };
  }
  try {
    const body = (await window.electronAPI.reticulum.proxyPut(`/api/v1/peers/${clean}/medium-pin`, {
      pin,
    })) as { ok?: boolean; error?: string };
    return { ok: Boolean(body.ok), error: body.error };
  } catch (e) {
    // catch-no-log-ok error returned to caller
    return { ok: false, error: errLikeToLogString(e) };
  }
}

export function peerMediumPinChoiceFromApi(
  pin: PathMedium | null | undefined,
): PeerMediumPinChoice {
  if (pin === 'rf' || pin === 'network') return pin;
  return 'auto';
}

export function peerMediumPinApiFromChoice(choice: PeerMediumPinChoice): PathMedium | null {
  if (choice === 'auto') return null;
  return choice;
}
