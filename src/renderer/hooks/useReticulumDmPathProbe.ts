/* eslint-disable react-hooks/set-state-in-effect -- probe lifecycle seeds status then settles from async sidecar result */
import { useCallback, useEffect, useRef, useState } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
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
  /**
   * Apply a probe result from an external manual Probe click (no second /probe).
   * Ignores results whose hash does not match the current destination.
   */
  applyProbeResult: (forHash: string, ok: boolean, hops: number | null) => void;
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
  const forceProbingRef = useRef(false);

  const reprobe = useCallback(() => {
    if (!enabled || !destinationHash) return;
    forceProbingRef.current = true;
    setProbeNonce((n) => n + 1);
  }, [enabled, destinationHash]);

  const destinationHashRef = useRef(destinationHash);
  // Keep latest destination for async settle guards (must not wait for an effect).
  // eslint-disable-next-line react-hooks/refs -- latest-dest ref for stale probe discard
  destinationHashRef.current = destinationHash;

  const applyProbeResult = useCallback((forHash: string, ok: boolean, hopsNext: number | null) => {
    // Failure point: stale manual probe after DM switch. Fallback: ignore mismatched hash.
    if (!forHash || forHash !== destinationHashRef.current) return;
    setStatus(reticulumDmPathStatusFromProbe(ok));
    setHops(hopsNext);
  }, []);

  useEffect(() => {
    if (!enabled || !destinationHash) {
      forceProbingRef.current = false;
      setStatus('idle');
      setHops(null);
      return;
    }

    let cancelled = false;
    const forceProbing = forceProbingRef.current;
    forceProbingRef.current = false;
    const seed = seedReticulumDmPathStatus(passiveHops);
    setStatus(forceProbing || seed !== 'reachable' ? 'probing' : 'reachable');
    setHops(passiveHops ?? null);

    void (async () => {
      try {
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
      } catch (e) {
        // Failure point: probe IPC reject. Fallback: treat as unreachable.
        if (cancelled) return;
        console.debug('[useReticulumDmPathProbe] probe failed ' + errLikeToLogString(e));
        setStatus('unreachable');
        setHops(null);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Seed from passive hops at probe start only; later peer-store hop updates must not re-probe.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [enabled, destinationHash, probeNonce]);

  return { status, hops, reprobe, applyProbeResult };
}
