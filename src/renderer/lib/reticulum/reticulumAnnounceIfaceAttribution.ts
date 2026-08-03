import { countEnabledDefaultHubPresets } from '@/renderer/lib/reticulum/reticulumDefaultHubPresets';
import { normalizeReticulumInterfaceMode } from '@/renderer/lib/reticulum/reticulumInterfaceMode';
import type { ReticulumLocalInterfaceInput } from '@/renderer/lib/reticulum/reticulumLocalInterfaceHealth';
import { MS_PER_MINUTE } from '@/shared/timeConstants';

/** Sliding window for peers_updated interface-name samples. */
export const RETICULUM_PEER_IFACE_CHURN_WINDOW_MS = 5 * MS_PER_MINUTE;
/** Minimum named samples before majority attribution. */
export const RETICULUM_PEER_IFACE_CHURN_MIN_SAMPLES = 20;
/** Share of samples a single interface must exceed to be "hot" (strict majority). */
export const RETICULUM_PEER_IFACE_CHURN_MAJORITY = 0.5;

interface PeerIfaceSample {
  name: string;
  at: number;
}

let peerIfaceSamples: PeerIfaceSample[] = [];

function prunePeerIfaceSamples(nowMs: number): void {
  const cutoff = nowMs - RETICULUM_PEER_IFACE_CHURN_WINDOW_MS;
  if (peerIfaceSamples.length === 0) return;
  // Samples are appended in time order — drop a prefix.
  let firstKeep = 0;
  while (firstKeep < peerIfaceSamples.length && peerIfaceSamples[firstKeep].at < cutoff) {
    firstKeep += 1;
  }
  if (firstKeep > 0) {
    peerIfaceSamples = peerIfaceSamples.slice(firstKeep);
  }
}

/** Record a peers_updated patch interface name for path-churn attribution. */
export function recordReticulumPeerInterfaceSample(
  interfaceName: string | null | undefined,
  nowMs: number = Date.now(),
): void {
  const name = typeof interfaceName === 'string' ? interfaceName.trim() : '';
  if (!name) return;
  peerIfaceSamples.push({ name, at: nowMs });
  prunePeerIfaceSamples(nowMs);
}

/** Record interface names from a peers_updated wire payload. */
export function recordReticulumPeerInterfaceSamplesFromPeersUpdated(
  payload: unknown,
  nowMs: number = Date.now(),
): void {
  if (!payload || typeof payload !== 'object') return;
  const p = payload as Record<string, unknown>;
  if (Array.isArray(p.patches)) {
    for (const row of p.patches) {
      if (!row || typeof row !== 'object') continue;
      const iface = (row as { interface?: unknown }).interface;
      recordReticulumPeerInterfaceSample(typeof iface === 'string' ? iface : null, nowMs);
    }
  }
  if (typeof p.interface === 'string') {
    recordReticulumPeerInterfaceSample(p.interface, nowMs);
  }
}

/**
 * Interface name that owns a clear majority of recent peers_updated path samples,
 * or null when the window is too small / no majority.
 */
export function getHotReticulumPeerInterface(nowMs: number = Date.now()): string | null {
  prunePeerIfaceSamples(nowMs);
  if (peerIfaceSamples.length < RETICULUM_PEER_IFACE_CHURN_MIN_SAMPLES) {
    return null;
  }
  const counts = new Map<string, number>();
  for (const sample of peerIfaceSamples) {
    counts.set(sample.name, (counts.get(sample.name) ?? 0) + 1);
  }
  let bestName: string | null = null;
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      bestName = name;
      bestCount = count;
    }
  }
  if (bestName == null) return null;
  // Require a strict majority (>50%) so 50/50 ties stay unattributed.
  if (bestCount / peerIfaceSamples.length <= RETICULUM_PEER_IFACE_CHURN_MAJORITY) {
    return null;
  }
  return bestName;
}

/** Enabled interface names with rnsd mode `boundary`. */
export function listEnabledBoundaryInterfaceNames(
  interfaces: readonly Pick<ReticulumLocalInterfaceInput, 'enabled' | 'name' | 'mode'>[],
): string[] {
  const names: string[] = [];
  for (const iface of interfaces) {
    if (!iface.enabled) continue;
    if (normalizeReticulumInterfaceMode(iface.mode) !== 'boundary') continue;
    const name = iface.name.trim();
    if (name) names.push(name);
  }
  return names;
}

/** Enabled default-backbone preset interface names (host/port catalog match). */
export function listEnabledDefaultHubInterfaceNames(
  interfaces: readonly Pick<ReticulumLocalInterfaceInput, 'enabled' | 'name' | 'host' | 'port'>[],
): string[] {
  const names: string[] = [];
  for (const iface of interfaces) {
    if (!iface.enabled) continue;
    // Single-row count reuses the same host/port preset matcher as the >3 warning.
    if (countEnabledDefaultHubPresets([iface]) !== 1) continue;
    const name = iface.name.trim();
    if (name) names.push(name);
  }
  return names;
}

/** Test helper — clear peer-interface churn samples. */
export function resetReticulumPeerInterfaceAttributionForTests(): void {
  peerIfaceSamples = [];
}
