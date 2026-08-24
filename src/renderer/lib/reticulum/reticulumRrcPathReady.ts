import {
  fetchReticulumPeerPaths,
  refreshReticulumPeerRouteFromPaths,
  RETICULUM_PATH_RETRY_MS,
  RETICULUM_PATH_SETTLE_MS,
  setReticulumPeerMediumPin,
} from '@/renderer/lib/reticulum/reticulumPathMedium';
import {
  bestReticulumRrcPathSlot,
  type ReticulumPathSlot,
  RRC_MAX_CONNECT_HOPS,
} from '@/renderer/lib/reticulum/reticulumPathSlots';
import { probeReticulumRrcTransportReady } from '@/renderer/lib/reticulum/reticulumRrcTransportReady';
import {
  probeReticulumPeer,
  requestReticulumPeerPath,
} from '@/renderer/lib/reticulum/reticulumSidecarReads';
import {
  refreshReticulumPeersFromSidecar,
  useReticulumPeerStore,
} from '@/renderer/stores/reticulumPeerStore';
import { MS_PER_SECOND } from '@/shared/timeConstants';

export type ReticulumRrcPathNotReadyReason = 'no_path' | 'probe_failed' | 'probe_cooldown';

export interface ReticulumRrcPathProbe {
  ready: boolean;
  reason?: ReticulumRrcPathNotReadyReason;
  hops?: number | null;
  iface?: string | null;
  source?: 'passive' | 'path_request' | 'probe';
  passiveHops?: number | null;
  passiveIface?: string | null;
}

/** Minimum spacing between live /probe calls for the same hub during auto-connect. */
const RRC_PATH_PROBE_COOLDOWN_MS = 10 * MS_PER_SECOND;

/** Spacing between stale-route DropPath+RequestPath recovery attempts. */
const RRC_STALE_PATH_RECOVERY_COOLDOWN_MS = 15 * MS_PER_SECOND;

const pathRequestSentForHub = new Set<string>();
const lastProbeAtByHub = new Map<string, number>();
const stalePathRecoveryAtByHub = new Map<string, number>();
const probeSuccessByHub = new Map<string, ReticulumRrcPathProbe>();

function finiteHops(raw: number | null | undefined): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
  return Math.floor(raw);
}

function resolvedRrcConnectHops(
  probeHops: number | null | undefined,
  slotHops: number | null | undefined,
  passiveHops: number | null | undefined,
): number | null {
  const hops = finiteHops(probeHops) ?? finiteHops(slotHops) ?? finiteHops(passiveHops);
  if (hops == null || hops > RRC_MAX_CONNECT_HOPS) return null;
  return hops;
}

function normHub(hub: string): string {
  return hub.trim().toLowerCase();
}

function passivePathSnapshot(hub: string): { hops: number | null; iface: string | null } {
  const peer = useReticulumPeerStore.getState().getPeer(hub);
  return {
    hops: peer?.hops ?? null,
    iface: peer?.interface ?? null,
  };
}

/** Pure helper — path-table hops alone do not prove live reachability for RRC. */
export function evaluateReticulumRrcPathReady(
  hops: number | null | undefined,
  iface?: string | null,
): ReticulumRrcPathProbe {
  if (hops != null && hops >= 0) {
    return {
      ready: false,
      reason: 'no_path',
      passiveHops: hops,
      passiveIface: iface ?? null,
    };
  }
  return { ready: false, reason: 'no_path', hops: null, passiveHops: null };
}

async function recoverStaleRrcHubPath(hub: string): Promise<boolean> {
  const last = stalePathRecoveryAtByHub.get(hub) ?? 0;
  const now = Date.now();
  if (now - last < RRC_STALE_PATH_RECOVERY_COOLDOWN_MS) return false;
  stalePathRecoveryAtByHub.set(hub, now);

  await setReticulumPeerMediumPin(hub, null);
  await requestReticulumPeerPath(hub, { force: true });
  await refreshReticulumPeerRouteFromPaths(hub, {
    settleMs: RETICULUM_PATH_SETTLE_MS,
    retryMs: RETICULUM_PATH_RETRY_MS,
  });
  try {
    await refreshReticulumPeersFromSidecar({ forceRefresh: true });
  } catch {
    // catch-no-log-ok rate-limit or sidecar blip — fast poll will retry
  }
  return true;
}

function needsStalePathRecovery(
  passiveHops: number | null,
  slots: readonly ReticulumPathSlot[],
): boolean {
  if (passiveHops != null && passiveHops > RRC_MAX_CONNECT_HOPS) return true;
  if (slots.length === 0) return false;
  return bestReticulumRrcPathSlot(slots) == null;
}

/**
 * Ensure the hub has a live reachable path before RRC link proof.
 * Path-table hops are hints only — RRC requires a successful /probe round-trip.
 */
export async function probeReticulumRrcPathReady(hubHash: string): Promise<ReticulumRrcPathProbe> {
  const hub = normHub(hubHash);
  if (!hub) return { ready: false, reason: 'no_path' };

  const cached = probeSuccessByHub.get(hub);
  if (cached) return cached;

  const passive = passivePathSnapshot(hub);

  if (!pathRequestSentForHub.has(hub)) {
    const pathResult = await requestReticulumPeerPath(hub);
    if (pathResult.ok) {
      pathRequestSentForHub.add(hub);
      try {
        await refreshReticulumPeersFromSidecar({ forceRefresh: true });
      } catch {
        // catch-no-log-ok rate-limit or sidecar blip — fast poll will retry
      }
      Object.assign(passive, passivePathSnapshot(hub));
    }
  }

  const transport = await probeReticulumRrcTransportReady();
  if (transport.ready) {
    const pathsPreview = await fetchReticulumPeerPaths(hub);
    if (needsStalePathRecovery(passive.hops, pathsPreview.paths)) {
      await recoverStaleRrcHubPath(hub);
      Object.assign(passive, passivePathSnapshot(hub));
    }
  }

  const lastProbe = lastProbeAtByHub.get(hub) ?? 0;
  const now = Date.now();
  if (now - lastProbe < RRC_PATH_PROBE_COOLDOWN_MS) {
    return {
      ready: false,
      reason: 'probe_cooldown',
      passiveHops: passive.hops,
      passiveIface: passive.iface,
    };
  }
  lastProbeAtByHub.set(hub, now);

  const probe = await probeReticulumPeer(hub);

  if (probe.ok) {
    Object.assign(passive, passivePathSnapshot(hub));
    let pathsResult = await fetchReticulumPeerPaths(hub);
    if (needsStalePathRecovery(passive.hops, pathsResult.paths)) {
      const recovered = await recoverStaleRrcHubPath(hub);
      if (recovered) {
        Object.assign(passive, passivePathSnapshot(hub));
        pathsResult = await fetchReticulumPeerPaths(hub);
      }
    }
    const bestSlot = bestReticulumRrcPathSlot(pathsResult.paths);
    const hops = resolvedRrcConnectHops(probe.hops, bestSlot?.hops, passive.hops);
    if (hops == null) {
      return {
        ready: false,
        reason: 'no_path',
        hops: null,
        passiveHops: passive.hops,
        passiveIface: passive.iface,
      };
    }
    useReticulumPeerStore.getState().updatePeer(hub, {
      hops,
      interface: bestSlot?.interface ?? passive.iface,
    });
    const ready: ReticulumRrcPathProbe = {
      ready: true,
      hops,
      iface: bestSlot?.interface ?? passive.iface,
      source: 'probe',
      passiveHops: passive.hops,
      passiveIface: passive.iface,
    };
    probeSuccessByHub.set(hub, ready);
    return ready;
  }

  return {
    ready: false,
    reason: 'probe_failed',
    hops: null,
    passiveHops: passive.hops,
    passiveIface: passive.iface,
  };
}

/** Drop cached probe success so link-proof retries re-probe. */
export function clearReticulumRrcPathProbeCache(hubHash: string): void {
  const hub = normHub(hubHash);
  if (!hub) return;
  probeSuccessByHub.delete(hub);
  lastProbeAtByHub.delete(hub);
}

/** Test helper — reset per-hub path request / probe cooldown state. */
export function resetReticulumRrcPathReadyForTests(): void {
  pathRequestSentForHub.clear();
  lastProbeAtByHub.clear();
  stalePathRecoveryAtByHub.clear();
  probeSuccessByHub.clear();
}
