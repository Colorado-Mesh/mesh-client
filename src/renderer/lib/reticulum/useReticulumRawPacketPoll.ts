import { useEffect, useRef } from 'react';

/** Poll interval while Sniffer/Stats is mounted (wire_packet no longer streams on WS). */
export const RETICULUM_RAW_PACKET_POLL_MS = 2_000;

export interface UseReticulumRawPacketPollOptions {
  /** When false, polling pauses (panel not mounted or stack stopped). */
  pollActive: boolean;
  hydrateRawPackets: () => Promise<void>;
  intervalMs?: number;
}

/**
 * Poll `GET /api/v1/packets` while the Reticulum Sniffer/Stats panel is active.
 * Live `wire_packet` WS frames are intentionally not emitted (they starved LXMF).
 */
export function useReticulumRawPacketPoll({
  pollActive,
  hydrateRawPackets,
  intervalMs = RETICULUM_RAW_PACKET_POLL_MS,
}: UseReticulumRawPacketPollOptions): void {
  const hydrateRef = useRef(hydrateRawPackets);

  useEffect(() => {
    hydrateRef.current = hydrateRawPackets;
  }, [hydrateRawPackets]);

  useEffect(() => {
    if (!pollActive) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        await hydrateRef.current();
      } catch {
        // catch-no-log-ok: hydrate logs its own failures
      }
      if (!cancelled) {
        timeoutId = setTimeout(() => {
          void tick();
        }, intervalMs);
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [pollActive, intervalMs]);
}
