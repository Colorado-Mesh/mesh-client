/* eslint-disable react-hooks/set-state-in-effect -- probe lifecycle seeds status then settles from async sidecar result */
import { useCallback, useEffect, useState } from 'react';

import {
  type ReticulumDmPathStatus,
  reticulumDmPathStatusFromProbe,
  seedReticulumDmPathStatus,
} from '@/renderer/lib/reticulum/reticulumDmPathReachability';
import { probeReticulumPeer } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import {
  refreshReticulumPeersFromSidecar,
  useReticulumPeerStore,
} from '@/renderer/stores/reticulumPeerStore';

export interface UseReticulumDmPathProbeArgs {
  /** When false, resets to idle and does not probe. */
  enabled: boolean;
  destinationHash: string | null;
  /** Path-table / contact hops for optimistic seed before probe settles. */
  passiveHops?: number | null;
}

export interface UseReticulumDmPathProbeResult {
  status: ReticulumDmPathStatus;
  hops: number | null;
  /** Re-run probe for the current destination (no-op when disabled / no hash). */
  reprobe: () => void;
}

/**
 * Probe Reticulum path reachability when the active DM destination changes.
 * Ignores stale results after switch-away or disable.
 */
export function useReticulumDmPathProbe({
  enabled,
  destinationHash,
  passiveHops = null,
}: UseReticulumDmPathProbeArgs): UseReticulumDmPathProbeResult {
  const [status, setStatus] = useState<ReticulumDmPathStatus>('idle');
  const [hops, setHops] = useState<number | null>(null);
  const [probeNonce, setProbeNonce] = useState(0);

  const reprobe = useCallback(() => {
    if (!enabled || !destinationHash) return;
    setProbeNonce((n) => n + 1);
  }, [enabled, destinationHash]);

  useEffect(() => {
    if (!enabled || !destinationHash) {
      setStatus('idle');
      setHops(null);
      return;
    }

    let cancelled = false;
    const seed = seedReticulumDmPathStatus(passiveHops);
    setStatus(seed === 'reachable' ? 'reachable' : 'probing');
    setHops(passiveHops ?? null);

    void (async () => {
      const result = await probeReticulumPeer(destinationHash);
      if (cancelled) return;
      setStatus(reticulumDmPathStatusFromProbe(result.ok));
      const nextHops = result.hops ?? null;
      setHops(nextHops);
      if (result.ok) {
        if (nextHops != null) {
          useReticulumPeerStore.getState().updatePeer(destinationHash, { hops: nextHops });
        }
        void refreshReticulumPeersFromSidecar();
      }
    })();

    return () => {
      cancelled = true;
    };
    // Seed from passive hops at probe start only; later peer-store hop updates must not re-probe.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [enabled, destinationHash, probeNonce]);

  return { status, hops, reprobe };
}
