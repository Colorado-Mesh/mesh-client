import type { TFunction } from 'i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  registerReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';
import type { ReticulumRmapDiscoveredWireRow } from '@/shared/reticulum-types';
import { isExpectedReticulumProxyError } from '@/shared/reticulumProxyIpcError';

export interface ReticulumIdentityStatus {
  configured: boolean;
  lxmfHash: string | null;
  displayName: string | null;
  identityHash?: string | null;
}

export interface ReticulumPeerPathResult {
  ok: boolean;
  error?: string;
}

export interface ReticulumPeerProbeResult {
  ok: boolean;
  hops?: number;
  mode?: string;
  error?: string;
}

export interface ReticulumPingProbeResult {
  ok: boolean;
  rttMs?: number;
  hops?: number;
  error?: string;
}

/** True when the Reticulum sidecar process is listening. */
export async function isReticulumSidecarRunning(): Promise<boolean> {
  try {
    const status = await window.electronAPI.reticulum.getStatus();
    return status.running && status.port > 0;
  } catch {
    // catch-no-log-ok getStatus unavailable — treat as not running
    return false;
  }
}

export function isReticulumSidecarNotRunningError(err: unknown): boolean {
  return errLikeToLogString(err).toLowerCase().includes('not running');
}

export function isReticulumSidecar404Error(err: unknown): boolean {
  if (err != null && typeof err === 'object') {
    const rec = err as Record<string, unknown>;
    for (const key of ['status', 'statusCode'] as const) {
      const raw = rec[key];
      if (raw === 404 || raw === '404') return true;
    }
  }
  // Sidecar manager: `sidecar GET … failed: 404`
  return /failed:\s*404\b/i.test(errLikeToLogString(err));
}

export function isReticulumSidecarRateLimitError(err: unknown): boolean {
  return errLikeToLogString(err).toLowerCase().includes('rate limit exceeded');
}

export function isReticulumSidecarExpectedProxyError(err: unknown): boolean {
  return isExpectedReticulumProxyError(err);
}

export interface ReticulumSidecarInterfaceRow {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  status: string;
  serial_port?: string | null;
  host?: string | null;
  port?: number | null;
  frequency?: number | null;
  bandwidth?: number | null;
  txpower?: number | null;
  spreading_factor?: number | null;
  coding_rate?: number | null;
  callsign?: string | null;
  preset?: string | null;
  mode?: string | null;
  seed_addresses?: string[];
  discoverable?: boolean | null;
  latitude?: number | null;
  longitude?: number | null;
  height?: number | null;
  discovery_name?: string | null;
  announce_interval_min?: number | null;
  connectable?: boolean | null;
  reachable_on?: string | null;
  network_name?: string | null;
  passphrase?: string | null;
  extra_config?: Record<string, string> | null;
}

export interface ReticulumSerialPortOption {
  path: string;
  label?: string;
}

const RETICULUM_INTERFACES_CACHE_MS = 5_000;
let cachedReticulumInterfaces: ReticulumSidecarInterfaceRow[] = [];
let cachedEffectivePrimaryLocalSerialInterfaceId: string | null = null;
let cachedReticulumInterfacesAt = 0;
let cachedReticulumSerialPorts: ReticulumSerialPortOption[] = [];
let cachedReticulumSerialPortsAt = 0;

export function invalidateReticulumInterfacesCache(): void {
  cachedReticulumInterfacesAt = 0;
  cachedReticulumSerialPortsAt = 0;
}

export function getCachedReticulumEffectivePrimaryLocalSerialInterfaceId(): string | null {
  return cachedEffectivePrimaryLocalSerialInterfaceId;
}

export interface FetchReticulumSidecarReadOpts {
  /**
   * When true, rate-limit errors are rethrown so pollers can back off.
   * Default false: return cached rows (or []) so unguarded callers keep working.
   */
  propagateRateLimit?: boolean;
}

/** Fetch OS serial port options from the sidecar (shared cache with path-only helper). */
export async function fetchReticulumSerialPortOptions(
  opts?: FetchReticulumSidecarReadOpts,
): Promise<ReticulumSerialPortOption[]> {
  if (!(await isReticulumSidecarRunning())) {
    cachedReticulumSerialPorts = [];
    cachedReticulumSerialPortsAt = 0;
    return [];
  }
  const now = Date.now();
  if (
    cachedReticulumSerialPorts.length > 0 &&
    now - cachedReticulumSerialPortsAt < RETICULUM_INTERFACES_CACHE_MS
  ) {
    return cachedReticulumSerialPorts;
  }
  try {
    const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/serial/ports')) as {
      ports?: ReticulumSerialPortOption[];
    };
    const ports = body.ports ?? [];
    cachedReticulumSerialPorts = ports;
    cachedReticulumSerialPortsAt = now;
    return ports;
  } catch (e) {
    if (opts?.propagateRateLimit && isReticulumSidecarRateLimitError(e)) {
      throw e instanceof Error ? e : new Error(String(e));
    }
    if (!isReticulumSidecarExpectedProxyError(e)) {
      console.debug('[reticulumSidecarReads] serial ports ' + errLikeToLogString(e));
    }
    if (cachedReticulumSerialPorts.length > 0) {
      return cachedReticulumSerialPorts;
    }
    return [];
  }
}

/** Fetch OS serial port paths from the sidecar (for local interface health checks). */
export async function fetchReticulumSerialPorts(
  opts?: FetchReticulumSidecarReadOpts,
): Promise<string[]> {
  const ports = await fetchReticulumSerialPortOptions(opts);
  return ports.map((p) => p.path);
}

/** Fetch configured sidecar interfaces (shared by runtime and Connection panel). */
export async function fetchReticulumInterfaces(
  opts?: FetchReticulumSidecarReadOpts,
): Promise<ReticulumSidecarInterfaceRow[]> {
  if (!(await isReticulumSidecarRunning())) {
    cachedReticulumInterfaces = [];
    cachedEffectivePrimaryLocalSerialInterfaceId = null;
    cachedReticulumInterfacesAt = 0;
    return [];
  }
  const now = Date.now();
  if (
    cachedReticulumInterfaces.length > 0 &&
    now - cachedReticulumInterfacesAt < RETICULUM_INTERFACES_CACHE_MS
  ) {
    return cachedReticulumInterfaces;
  }
  try {
    const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/interfaces')) as {
      interfaces?: ReticulumSidecarInterfaceRow[];
      effective_primary_local_serial_interface_id?: string | null;
    };
    const interfaces = body.interfaces ?? [];
    cachedReticulumInterfaces = interfaces;
    cachedEffectivePrimaryLocalSerialInterfaceId =
      body.effective_primary_local_serial_interface_id ?? null;
    cachedReticulumInterfacesAt = now;
    return interfaces;
  } catch (e) {
    if (opts?.propagateRateLimit && isReticulumSidecarRateLimitError(e)) {
      throw e instanceof Error ? e : new Error(String(e));
    }
    if (!isReticulumSidecarExpectedProxyError(e)) {
      console.debug('[reticulumSidecarReads] interfaces ' + errLikeToLogString(e));
    }
    if (cachedReticulumInterfaces.length > 0) {
      return cachedReticulumInterfaces;
    }
    return [];
  }
}

/** Fetch RMAP v4 discovered interfaces heard by the local stack. */
export async function fetchReticulumRmapDiscovered(): Promise<ReticulumRmapDiscoveredWireRow[]> {
  if (!(await isReticulumSidecarRunning())) {
    return [];
  }
  try {
    const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/rmap/discovered')) as {
      discovered?: ReticulumRmapDiscoveredWireRow[];
    };
    return Array.isArray(body.discovered) ? body.discovered : [];
  } catch (e) {
    if (isReticulumSidecarExpectedProxyError(e)) {
      return [];
    }
    console.debug('[reticulumSidecarReads] rmap discovered ' + errLikeToLogString(e));
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/** Fetch sidecar identity status. Panels use `reticulumIdentityStore` via `useReticulumSidecarApi`; runtime uses this helper directly. */
export async function fetchReticulumIdentityStatus(): Promise<ReticulumIdentityStatus> {
  if (!(await isReticulumSidecarRunning())) {
    return { configured: false, lxmfHash: null, displayName: null, identityHash: null };
  }
  try {
    const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/identity/status')) as {
      configured?: boolean;
      lxmf_hash?: string;
      identity_hash?: string;
      display_name?: string | null;
    };
    const lxmfHash = body.configured && body.lxmf_hash ? body.lxmf_hash : null;
    const displayName = body.display_name?.trim() ? body.display_name.trim() : null;
    const identityHash = body.identity_hash?.trim() ? body.identity_hash.trim() : null;
    if (lxmfHash) {
      registerReticulumDestinationHash(reticulumHashToNodeId(lxmfHash), lxmfHash);
    }
    return {
      configured: Boolean(body.configured),
      lxmfHash,
      displayName,
      identityHash,
    };
  } catch (e) {
    if (!isReticulumSidecarExpectedProxyError(e)) {
      console.debug('[reticulumSidecarReads] identity status ' + errLikeToLogString(e));
    }
    return { configured: false, lxmfHash: null, displayName: null, identityHash: null };
  }
}

export async function requestReticulumPeerPath(hash: string): Promise<ReticulumPeerPathResult> {
  if (!(await isReticulumSidecarRunning())) {
    return { ok: false, error: 'sidecar_not_running' };
  }
  try {
    const res = (await window.electronAPI.reticulum.proxyPost(
      `/api/v1/peers/${hash}/path`,
      {},
    )) as { ok?: boolean; error?: string };
    return { ok: Boolean(res.ok), error: res.error };
  } catch (e) {
    // catch-no-log-ok error returned to caller for toast/UI
    return { ok: false, error: errLikeToLogString(e) };
  }
}

/** Coalesce concurrent probes for the same destination (DM header + Peers + auto-probe). */
const probeInFlightByHash = new Map<string, Promise<ReticulumPeerProbeResult>>();

export async function probeReticulumPeer(hash: string): Promise<ReticulumPeerProbeResult> {
  const key = hash.trim().toLowerCase();
  const existing = probeInFlightByHash.get(key);
  if (existing) return existing;

  const run = (async (): Promise<ReticulumPeerProbeResult> => {
    if (!(await isReticulumSidecarRunning())) {
      return { ok: false, error: 'sidecar_not_running' };
    }
    try {
      const res = (await window.electronAPI.reticulum.proxyPost(
        `/api/v1/peers/${hash}/probe`,
        {},
      )) as { ok?: boolean; hops?: number; mode?: string; error?: string };
      return {
        ok: Boolean(res.ok),
        hops: res.hops,
        mode: res.mode,
        error: res.error,
      };
    } catch (e) {
      // catch-no-log-ok error returned to caller for toast/UI
      return { ok: false, error: errLikeToLogString(e) };
    }
  })();

  probeInFlightByHash.set(key, run);
  try {
    return await run;
  } finally {
    probeInFlightByHash.delete(key);
  }
}

/** Compose sidecar ping (RTT) + path probe (hops) for diagnostics loops. */
export async function pingReticulumDestination(hash: string): Promise<ReticulumPingProbeResult> {
  if (!(await isReticulumSidecarRunning())) {
    return { ok: false, error: 'sidecar_not_running' };
  }
  try {
    const [pingRes, probeRes] = await Promise.all([
      window.electronAPI.reticulum.proxyPost('/api/v1/ping', {
        destination_hash: hash,
      }) as Promise<{ ok?: boolean; rtt_ms?: number; error?: string }>,
      probeReticulumPeer(hash),
    ]);
    const ok = Boolean(pingRes.ok) || probeRes.ok;
    return {
      ok,
      rttMs: pingRes.rtt_ms,
      hops: probeRes.hops,
      error: pingRes.error ?? probeRes.error,
    };
  } catch (e) {
    // catch-no-log-ok probe result carries error string for diagnostics UI
    return { ok: false, error: errLikeToLogString(e) };
  }
}

export function formatReticulumPeerPathToast(
  t: TFunction,
  result: ReticulumPeerPathResult,
): { message: string; variant: 'success' | 'error' } {
  if (result.ok) {
    return { message: t('peerDetailModal.pathOk'), variant: 'success' };
  }
  return {
    message: t('peerDetailModal.pathFailed', { error: result.error ?? t('common.error') }),
    variant: 'error',
  };
}

export function formatReticulumPeerProbeToast(
  t: TFunction,
  result: ReticulumPeerProbeResult,
): { message: string; variant: 'success' | 'error' } {
  if (result.ok && result.hops != null) {
    return {
      message: t('peerDetailModal.probeHops', { hops: result.hops }),
      variant: 'success',
    };
  }
  if (result.ok && result.mode) {
    return {
      message: t('peerDetailModal.probeLocal', { mode: result.mode }),
      variant: 'success',
    };
  }
  if (result.ok) {
    return { message: t('peerDetailModal.probeOk'), variant: 'success' };
  }
  return {
    message: t('peerDetailModal.probeFailed', { error: result.error ?? t('common.error') }),
    variant: 'error',
  };
}

export interface ReticulumSidecarIdentityRow {
  id: string;
  display_name?: string | null;
  identity_hash?: string | null;
  lxmf_hash?: string | null;
  active?: boolean;
  configured?: boolean;
}

export async function listReticulumIdentities(): Promise<ReticulumSidecarIdentityRow[]> {
  if (!(await isReticulumSidecarRunning())) return [];
  const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/identities')) as {
    identities?: ReticulumSidecarIdentityRow[];
  };
  return body.identities ?? [];
}

export async function switchReticulumIdentity(identityId: string): Promise<boolean> {
  if (!(await isReticulumSidecarRunning())) return false;
  const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/identities/switch', {
    identity_id: identityId,
  })) as { ok?: boolean; error?: string };
  if (res.ok === false) {
    throw new Error(res.error ?? 'identity switch failed');
  }
  return Boolean(res.ok);
}

export async function createReticulumIdentitySlot(
  displayName?: string | null,
): Promise<{ id: string }> {
  if (!(await isReticulumSidecarRunning())) {
    throw new Error('sidecar_not_running');
  }
  const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/identities', {
    display_name: displayName?.trim() || undefined,
  })) as { ok?: boolean; id?: string; error?: string };
  if (res.ok === false || !res.id) {
    throw new Error(res.error ?? 'identity create failed');
  }
  return { id: res.id };
}

export async function deleteReticulumIdentitySlot(identityId: string): Promise<void> {
  if (!(await isReticulumSidecarRunning())) {
    throw new Error('sidecar_not_running');
  }
  const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/identities/delete', {
    identity_id: identityId,
  })) as { ok?: boolean; error?: string };
  if (res.ok === false) {
    throw new Error(res.error ?? 'identity delete failed');
  }
}
