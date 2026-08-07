import { formatHostForSocket, formatHostForUrl, parseConnectHostPort } from '@/shared/connectHost';
import { MS_PER_SECOND } from '@/shared/timeConstants';

import { parseMeshtasticTcpAddress } from './parseMeshtasticTcpAddress';
import { parseTcpAddress } from './parseTcpAddress';
import type { ConnectionType, MeshProtocol } from './types';

/** Poll interval for host↔radio link quality (BLE RSSI / IP RTT). */
export const HOST_LINK_QUALITY_POLL_MS = 4 * MS_PER_SECOND;

/** Max wait for a single HTTP/TCP RTT probe. */
export const HOST_LINK_RTT_PROBE_TIMEOUT_MS = 3 * MS_PER_SECOND;

export type SignalBarLevel = 0 | 1 | 2 | 3 | 4;

/** Connection panel host-link meter modes (not LoRa Telemetry). */
export type ConnectionLinkMeterKind = 'ble-rssi' | 'ip-rtt' | 'unavailable';

/**
 * Map IP round-trip time to the same 0–4 bar scale as BLE RSSI UI.
 * Lower latency → stronger bars. Null/non-finite → no data (0).
 */
export function rttToSignalLevel(rttMs: number | null | undefined): SignalBarLevel {
  if (rttMs == null || !Number.isFinite(rttMs) || rttMs < 0) return 0;
  if (rttMs <= 50) return 4;
  if (rttMs <= 100) return 3;
  if (rttMs <= 250) return 2;
  if (rttMs <= 500) return 1;
  return 0;
}

export interface ParsedHttpProbeTarget {
  urlHost: string;
  tls: boolean;
}

/** Normalize a Meshtastic HTTP address field into host/tls for the main-process probe. */
export function parseHttpProbeTarget(httpAddress: string): ParsedHttpProbeTarget | null {
  const trimmed = httpAddress.trim();
  if (!trimmed) return null;
  const tls = trimmed.startsWith('https://');
  const raw = trimmed.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!raw) return null;
  const { host, port } = parseConnectHostPort(raw, tls ? 443 : 80);
  return { urlHost: formatHostForUrl(host, port), tls };
}

export interface ParsedTcpProbeTarget {
  host: string;
  port: number;
}

/**
 * Parse a TCP probe target.
 * - `meshtastic`: default port 4403 (`parseMeshtasticTcpAddress`)
 * - `meshcore`: default port 5000 (`parseTcpAddress`)
 *
 * For Reticulum hubs / RMAP only. Do **not** use against Meshtastic/MeshCore live
 * session ports — those use {@link probeSessionMeter} (competing connect causes RST).
 */
export function parseTcpProbeTarget(
  address: string,
  protocol: 'meshtastic' | 'meshcore' = 'meshtastic',
): ParsedTcpProbeTarget | null {
  const trimmed = address.trim();
  if (!trimmed) return null;
  try {
    const { host, port } =
      protocol === 'meshcore' ? parseTcpAddress(trimmed) : parseMeshtasticTcpAddress(trimmed);
    return { host: formatHostForSocket(host), port };
  } catch {
    // catch-no-log-ok invalid address for link-quality probe
    return null;
  }
}

/**
 * True when the Connection panel transport is a live TCP session socket in main
 * (`meshtastic:tcp-*` / `meshcore:tcp-*`). MeshCore OpenHop is stored as `http`
 * (legacy enum) but is TCP on the wire.
 */
export function isLiveTcpSession(
  protocol: MeshProtocol,
  connectionType: ConnectionType | null,
): boolean {
  if (protocol === 'meshtastic' && connectionType === 'tcp') return true;
  if (protocol === 'meshcore' && connectionType === 'http') return true;
  return false;
}

/** Probe Meshtastic HTTP `/json/report` RTT via main process. */
export async function probeHttpLinkRttMs(httpAddress: string): Promise<number | null> {
  const target = parseHttpProbeTarget(httpAddress);
  if (!target) return null;
  const api = window.electronAPI.hostLink.probeHttpRtt;
  if (typeof api !== 'function') return null;
  try {
    const rtt = await api(target.urlHost, target.tls);
    return typeof rtt === 'number' && Number.isFinite(rtt) ? rtt : null;
  } catch (err) {
    console.debug(
      '[hostLinkQuality] HTTP RTT probe failed:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * Probe TCP connect RTT via main process (connect then destroy).
 * Reticulum hub / RMAP targets only — never Meshtastic/MeshCore live sessions
 * (use {@link probeSessionMeter}).
 */
export async function probeTcpLinkRttMs(
  address: string,
  protocol: 'meshtastic' | 'meshcore' = 'meshtastic',
): Promise<number | null> {
  const target = parseTcpProbeTarget(address, protocol);
  if (!target) return null;
  const api = window.electronAPI.hostLink.probeTcpRtt;
  if (typeof api !== 'function') return null;
  try {
    const rtt = await api(target.host, target.port);
    return typeof rtt === 'number' && Number.isFinite(rtt) ? rtt : null;
  } catch (err) {
    console.debug(
      '[hostLinkQuality] TCP RTT probe failed:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/** Read passive write→data EWMA from the live TCP session meter in main. */
export async function probeSessionMeter(
  protocol: 'meshtastic' | 'meshcore',
): Promise<number | null> {
  const api = window.electronAPI.hostLink.getSessionMeter;
  if (typeof api !== 'function') return null;
  try {
    const snap = await api(protocol);
    if (snap == null) return null;
    const rtt = snap.rttMs;
    return typeof rtt === 'number' && Number.isFinite(rtt) ? rtt : null;
  } catch (err) {
    console.debug(
      '[hostLinkQuality] session meter read failed:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
