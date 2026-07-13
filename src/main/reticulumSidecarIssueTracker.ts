/** Tracks TCP connect failures and TX queue drops parsed from sidecar stdout/stderr. */

import type { ReticulumInterfaceIssueAlert } from '../shared/reticulum-types';
import { MS_PER_SECOND } from '../shared/timeConstants';

const ALERT_STALE_MS = 5 * 60 * MS_PER_SECOND;
const TCP_CONNECT_FAILED_MARKER = 'TCP connect failed';
const TX_QUEUE_DROP_MARKER = 'PACKET DROPPED: interface TX channel full';
const LINK_DELIVERY_TIMEOUT_MARKER = 'link delivery timed out';
const LXMF_PATH_REQUEST_SATURATED_MARKER = 'failed to queue path request for LXMF delivery';
const SLOW_TRANSPORT_QUERY_MARKER = 'transport query slow or failed';

const TCP_CONNECT_IFACE_RE = /TCP connect failed.*?name\s*=\s*(.+?)(?:\s+error\s*=|$)/;
const TX_DROP_IFACE_RE =
  /PACKET DROPPED: interface TX channel full.*?interface_name\s*=\s*(.+?)(?:\s+queue|$)/;
const TX_DROP_COUNT_RE = /tx_drops\s*=\s*(\d+)/;
const LINK_TIMEOUT_DEST_RE =
  /link delivery timed out.*?dest\s*=\s*([0-9a-fA-F]{32}|[0-9a-fA-F]{16})/;
const SLOW_TRANSPORT_QUERY_RE = /transport query slow or failed.*?query\s*=\s*(\S+)/;

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\[[0-9;]*m/g, ''); // eslint-disable-line no-control-regex
}

function normalizeSidecarLogLine(text: string): string {
  return stripAnsi(text).replace(/\s+/g, ' ').trim();
}

function parseTcpConnectFailedIface(line: string): string | null {
  const match = TCP_CONNECT_IFACE_RE.exec(normalizeSidecarLogLine(line));
  return match?.[1]?.trim() ?? null;
}

function parseTxDropIface(line: string): string | null {
  const match = TX_DROP_IFACE_RE.exec(normalizeSidecarLogLine(line));
  return match?.[1]?.trim() ?? null;
}

function parseTxDropCount(line: string): number | null {
  const match = TX_DROP_COUNT_RE.exec(normalizeSidecarLogLine(line));
  if (!match?.[1]) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}

function parseLinkDeliveryTimeoutDest(line: string): string | null {
  const match = LINK_TIMEOUT_DEST_RE.exec(normalizeSidecarLogLine(line));
  const raw = match?.[1]?.trim().toLowerCase();
  if (!raw) return null;
  if (raw.length === 32) return raw;
  if (raw.length === 16) return raw;
  return null;
}

function parseSlowTransportQuery(line: string): string | null {
  const match = SLOW_TRANSPORT_QUERY_RE.exec(normalizeSidecarLogLine(line));
  return match?.[1]?.trim() ?? null;
}

export class ReticulumSidecarInterfaceIssueTracker {
  private tcpConnectFailed = new Map<string, number>();
  private txQueueDrops = new Map<string, number>();
  private linkDeliveryTimeouts = new Map<string, number>();
  private transportSaturatedCount = 0;
  private slowTransportQueryCount = 0;
  private suppressedCount = 0;
  private lastAtMs: number | null = null;

  recordLine(line: string, nowMs = Date.now()): void {
    const plain = normalizeSidecarLogLine(line);
    if (plain.includes(TCP_CONNECT_FAILED_MARKER)) {
      const iface = parseTcpConnectFailedIface(line);
      if (iface) {
        this.tcpConnectFailed.set(iface, nowMs);
        this.lastAtMs = nowMs;
      }
      return;
    }
    if (plain.includes(TX_QUEUE_DROP_MARKER)) {
      const iface = parseTxDropIface(line);
      if (iface) {
        const drops = parseTxDropCount(line);
        this.txQueueDrops.set(iface, drops ?? this.txQueueDrops.get(iface) ?? 0);
        this.lastAtMs = nowMs;
      }
      return;
    }
    if (plain.includes(LINK_DELIVERY_TIMEOUT_MARKER)) {
      const dest = parseLinkDeliveryTimeoutDest(line);
      if (dest) {
        this.linkDeliveryTimeouts.set(dest, (this.linkDeliveryTimeouts.get(dest) ?? 0) + 1);
        this.lastAtMs = nowMs;
      }
      return;
    }
    if (plain.includes(LXMF_PATH_REQUEST_SATURATED_MARKER)) {
      this.transportSaturatedCount += 1;
      this.lastAtMs = nowMs;
      return;
    }
    if (plain.includes(SLOW_TRANSPORT_QUERY_MARKER) && parseSlowTransportQuery(line)) {
      this.slowTransportQueryCount += 1;
      this.lastAtMs = nowMs;
    }
  }

  /** Rate-limit repetitive TCP connect lines logged at debug level. */
  recordSuppressedLine(count = 1): void {
    this.suppressedCount += count;
  }

  getAlert(nowMs = Date.now()): ReticulumInterfaceIssueAlert | null {
    if (this.lastAtMs == null || nowMs - this.lastAtMs > ALERT_STALE_MS) {
      return null;
    }
    const tcpConnectFailed = [...this.tcpConnectFailed.keys()].sort();
    const txQueueDrops = [...this.txQueueDrops.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, dropCount]) => ({ name, dropCount }));
    const linkDeliveryTimeouts = [...this.linkDeliveryTimeouts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([destinationHash, count]) => ({ destinationHash, count }));
    if (
      tcpConnectFailed.length === 0 &&
      txQueueDrops.length === 0 &&
      linkDeliveryTimeouts.length === 0 &&
      this.transportSaturatedCount === 0 &&
      this.slowTransportQueryCount === 0
    ) {
      return null;
    }
    return {
      tcpConnectFailed,
      txQueueDrops,
      linkDeliveryTimeouts,
      transportSaturatedCount: this.transportSaturatedCount,
      slowTransportQueryCount: this.slowTransportQueryCount,
      suppressedCount: this.suppressedCount,
      lastAtMs: this.lastAtMs,
    };
  }

  resetForTests(): void {
    this.tcpConnectFailed.clear();
    this.txQueueDrops.clear();
    this.linkDeliveryTimeouts.clear();
    this.transportSaturatedCount = 0;
    this.slowTransportQueryCount = 0;
    this.suppressedCount = 0;
    this.lastAtMs = null;
  }
}

export function parseTcpConnectFailedIfaceForTests(line: string): string | null {
  return parseTcpConnectFailedIface(line);
}

export function parseTxDropIfaceForTests(line: string): string | null {
  return parseTxDropIface(line);
}

export function parseLinkDeliveryTimeoutDestForTests(line: string): string | null {
  return parseLinkDeliveryTimeoutDest(line);
}
