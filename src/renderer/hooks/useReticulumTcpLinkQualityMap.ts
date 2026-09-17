/* eslint-disable react-hooks/set-state-in-effect -- clear map when inactive; async TCP RTT probes update state */
import { useEffect, useMemo, useState } from 'react';

import { formatHostForSocket } from '@/shared/connectHost';

import { HOST_LINK_QUALITY_POLL_MS } from '../lib/hostLinkQuality';
import { RETICULUM_TCP_RECOVERY_STARTUP_GRACE_MS } from '../lib/reticulum/reticulumTcpInterfaceRecovery';

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

/** Sticky cache key: id + host + port so endpoint edits do not reuse a prior RTT. */
function stickyTargetKey(t: Pick<TcpProbeTarget, 'id' | 'host' | 'port'>): string {
  return `${t.id}\0${t.host}\0${t.port}`;
}

/** Shared across ReticulumStackPanel + ReticulumInterfacesPanel hook instances. */
const stickyRttByTargetKey = new Map<string, number | null>();
/** In-flight probes keyed like sticky — concurrent hooks reuse the same Promise. */
const inflightProbeByTargetKey = new Map<string, Promise<number | null>>();

/** Test-only: clear sticky seeds and in-flight probes between cases. */
export function resetReticulumTcpLinkQualityStickyCacheForTests(): void {
  stickyRttByTargetKey.clear();
  inflightProbeByTargetKey.clear();
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
    .map((t) => stickyTargetKey(t))
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

function isFiniteRtt(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function stickyGet(t: TcpProbeTarget): number | null | undefined {
  const key = stickyTargetKey(t);
  return stickyRttByTargetKey.has(key) ? (stickyRttByTargetKey.get(key) ?? null) : undefined;
}

function mapFromSticky(targets: readonly TcpProbeTarget[]): Map<string, number | null> {
  const next = new Map<string, number | null>();
  for (const t of targets) {
    const cached = stickyGet(t);
    if (cached !== undefined) {
      next.set(t.id, cached);
    }
  }
  return next;
}

function allTargetsHaveFiniteRtt(targets: readonly TcpProbeTarget[]): boolean {
  return targets.every((t) => isFiniteRtt(stickyGet(t)));
}

function targetsNeedingSeed(targets: readonly TcpProbeTarget[]): TcpProbeTarget[] {
  return targets.filter((t) => !isFiniteRtt(stickyGet(t)));
}

/**
 * Probe one target, sharing an in-flight Promise across hook instances.
 * A later null/failure does not overwrite an existing finite sticky RTT.
 */
async function probeTcpTargetShared(
  t: TcpProbeTarget,
  probe: (host: string, port: number) => Promise<number | null>,
): Promise<number | null> {
  const key = stickyTargetKey(t);
  const existing = inflightProbeByTargetKey.get(key);
  if (existing) {
    return existing;
  }

  // Register the Promise synchronously so concurrent callers share it before any await.
  let settle!: (value: number | null) => void;
  const pending = new Promise<number | null>((resolve) => {
    settle = resolve;
  });
  inflightProbeByTargetKey.set(key, pending);

  void (async () => {
    try {
      let normalized: number | null = null;
      try {
        const rtt = await probe(t.host, t.port);
        normalized = typeof rtt === 'number' && Number.isFinite(rtt) ? rtt : null;
      } catch (err) {
        console.debug(
          '[Reticulum] TCP link-quality probe failed:',
          err instanceof Error ? err.message : String(err),
        );
        normalized = null;
      }
      const prev = stickyRttByTargetKey.get(key);
      if (isFiniteRtt(normalized)) {
        stickyRttByTargetKey.set(key, normalized);
      } else if (!isFiniteRtt(prev)) {
        stickyRttByTargetKey.set(key, null);
      }
      settle(stickyRttByTargetKey.get(key) ?? null);
    } finally {
      inflightProbeByTargetKey.delete(key);
    }
  })();

  return pending;
}

/**
 * Map of interface id → last TCP connect RTT (ms) for enabled Reticulum TCP Client rows.
 *
 * Probes run while the sidecar is **not** ready. Once ready, raw host:port connects can
 * collide with the RNS session — so we only **burst-seed** targets that still lack a
 * finite RTT (shared sticky cache across hook instances), then hold. Continuous
 * post-ready probing stays disabled.
 */
export function useReticulumTcpLinkQualityMap(
  interfaces: readonly ReticulumTcpLinkQualityRow[],
  sidecarReady: boolean,
): ReadonlyMap<string, number | null> {
  // Content key only — do not depend on `interfaces` array identity (inline props re-render loop).
  const targetKey = useMemo(
    () => encodeTcpProbeTargetKey(tcpProbeTargets(interfaces)),
    [interfaces],
  );

  const [rttById, setRttById] = useState<ReadonlyMap<string, number | null>>(() =>
    mapFromSticky(decodeTcpProbeTargetKey(targetKey)),
  );

  useEffect(() => {
    const targets = decodeTcpProbeTargetKey(targetKey);
    if (targets.length === 0) {
      setRttById(new Map());
      return;
    }

    setRttById(mapFromSticky(targets));

    const needsSeed = !allTargetsHaveFiniteRtt(targets);
    if (sidecarReady && !needsSeed) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let inflight = false;
    const burstStartedAt = Date.now();

    const applyStickyToState = () => {
      if (!cancelled) setRttById(mapFromSticky(targets));
    };

    const poll = async (onlyMissing: boolean) => {
      if (cancelled || inflight) return;
      const batch = onlyMissing ? targetsNeedingSeed(targets) : targets;
      if (batch.length === 0) return;

      inflight = true;
      const probe = window.electronAPI?.hostLink?.probeTcpRtt;
      if (typeof probe !== 'function') {
        inflight = false;
        return;
      }
      try {
        await Promise.all(batch.map((t) => probeTcpTargetShared(t, probe)));
        applyStickyToState();
      } finally {
        inflight = false;
      }
    };

    if (!sidecarReady) {
      void poll(false);
      timer = setInterval(() => {
        void poll(false);
      }, HOST_LINK_QUALITY_POLL_MS);
    } else {
      // Ready but missing finite seeds — burst until seeded or grace expires.
      const tick = async () => {
        if (cancelled) return;
        if (allTargetsHaveFiniteRtt(targets)) {
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
          return;
        }
        if (Date.now() - burstStartedAt >= RETICULUM_TCP_RECOVERY_STARTUP_GRACE_MS) {
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
          return;
        }
        await poll(true);
        if (cancelled) return;
        if (allTargetsHaveFiniteRtt(targets) && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
      void tick();
      timer = setInterval(() => {
        void tick();
      }, HOST_LINK_QUALITY_POLL_MS);
    }

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
