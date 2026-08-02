/* eslint-disable react-hooks/set-state-in-effect -- clear map when inactive; async TCP RTT probes update state */
import { useEffect, useMemo, useState } from 'react';

import { formatHostForSocket } from '@/shared/connectHost';

import { HOST_LINK_QUALITY_POLL_MS } from '../lib/hostLinkQuality';

export interface ReticulumTcpLinkQualityRow {
  id: string;
  enabled: boolean;
  type: string;
  host?: string | null;
  port?: number | null;
}

interface TcpProbeTarget {
  id: string;
  host: string;
  port: number;
}

function isEnabledTcpClientRow(iface: ReticulumTcpLinkQualityRow): boolean {
  if (!iface.enabled) return false;
  if (iface.type.toLowerCase() !== 'tcp') return false;
  const host = iface.host?.trim();
  const port = iface.port;
  return Boolean(host) && typeof port === 'number' && Number.isInteger(port) && port > 0;
}

function tcpProbeTargets(interfaces: readonly ReticulumTcpLinkQualityRow[]): TcpProbeTarget[] {
  return interfaces.filter(isEnabledTcpClientRow).map((iface) => ({
    id: iface.id,
    host: formatHostForSocket(iface.host!.trim()),
    port: iface.port!,
  }));
}

/** Encode/decode probe targets so the effect can depend on a content string only. */
function encodeTcpProbeTargetKey(targets: readonly TcpProbeTarget[]): string {
  return targets
    .map((t) => `${t.id}\0${t.host}\0${t.port}`)
    .sort()
    .join('|');
}

function decodeTcpProbeTargetKey(targetKey: string): TcpProbeTarget[] {
  if (!targetKey) return [];
  return targetKey.split('|').map((part) => {
    const [id, host, portStr] = part.split('\0');
    return { id, host, port: Number(portStr) };
  });
}

/**
 * Map of interface id → last TCP connect RTT (ms) for enabled Reticulum TCP Client rows.
 */
export function useReticulumTcpLinkQualityMap(
  interfaces: readonly ReticulumTcpLinkQualityRow[],
  sidecarReady: boolean,
): ReadonlyMap<string, number | null> {
  const [rttById, setRttById] = useState<ReadonlyMap<string, number | null>>(() => new Map());

  // Content key only — do not depend on `interfaces` array identity (inline props re-render loop).
  const targetKey = useMemo(
    () => encodeTcpProbeTargetKey(tcpProbeTargets(interfaces)),
    [interfaces],
  );

  useEffect(() => {
    const targets = decodeTcpProbeTargetKey(targetKey);
    if (!sidecarReady || targets.length === 0) {
      setRttById(new Map());
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let inflight = false;

    const poll = async () => {
      if (cancelled || inflight) return;
      inflight = true;
      const probe = window.electronAPI?.hostLink?.probeTcpRtt;
      if (typeof probe !== 'function') {
        inflight = false;
        return;
      }
      try {
        const next = new Map<string, number | null>();
        await Promise.all(
          targets.map(async (t) => {
            try {
              const rtt = await probe(t.host, t.port);
              next.set(t.id, typeof rtt === 'number' && Number.isFinite(rtt) ? rtt : null);
            } catch (err) {
              console.debug(
                '[Reticulum] TCP link-quality probe failed:',
                err instanceof Error ? err.message : String(err),
              );
              next.set(t.id, null);
            }
          }),
        );
        if (!cancelled) setRttById(next);
      } finally {
        inflight = false;
      }
    };

    void poll();
    timer = setInterval(() => {
      void poll();
    }, HOST_LINK_QUALITY_POLL_MS);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [sidecarReady, targetKey]);

  return rttById;
}

export function rttForReticulumTcpRow(
  iface: ReticulumTcpLinkQualityRow,
  rttById: ReadonlyMap<string, number | null>,
): number | null {
  if (!isEnabledTcpClientRow(iface)) return null;
  const rtt = rttById.get(iface.id);
  return rtt != null && Number.isFinite(rtt) ? rtt : null;
}

export function isReticulumTcpClientLinkQualityRow(iface: ReticulumTcpLinkQualityRow): boolean {
  return isEnabledTcpClientRow(iface);
}
