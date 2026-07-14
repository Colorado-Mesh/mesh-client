/** Tracks TCP connect failures and TX queue drops parsed from sidecar stdout/stderr. */

import type { ReticulumInterfaceIssueAlert } from '../shared/reticulum-types';
import { RETICULUM_INTERFACE_ISSUE_ALERT_STALE_MS } from '../shared/reticulum-types';

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

function pruneStaleTimestamps(map: Map<string, number>, nowMs: number): void {
  for (const [key, atMs] of map) {
    if (nowMs - atMs > RETICULUM_INTERFACE_ISSUE_ALERT_STALE_MS) {
      map.delete(key);
    }
  }
}

interface CountedAt {
  count: number;
  atMs: number;
}

function pruneStaleCounted(map: Map<string, CountedAt>, nowMs: number): void {
  for (const [key, entry] of map) {
    if (nowMs - entry.atMs > RETICULUM_INTERFACE_ISSUE_ALERT_STALE_MS) {
      map.delete(key);
    }
  }
}

export class ReticulumSidecarInterfaceIssueTracker {
  /** interface name → last-seen ms */
  private tcpConnectFailed = new Map<string, number>();
  /** interface name → drop count + last-seen ms */
  private txQueueDrops = new Map<string, CountedAt>();
  /** destination hash → count + last-seen ms */
  private linkDeliveryTimeouts = new Map<string, CountedAt>();
  private transportSaturatedCount = 0;
  private transportSaturatedAtMs: number | null = null;
  private slowTransportQueryCount = 0;
  private slowTransportQueryAtMs: number | null = null;
  private suppressedCount = 0;

  recordLine(line: string, nowMs = Date.now()): void {
    const plain = normalizeSidecarLogLine(line);
    if (plain.includes(TCP_CONNECT_FAILED_MARKER)) {
      const iface = parseTcpConnectFailedIface(line);
      if (iface) {
        this.tcpConnectFailed.set(iface, nowMs);
      }
      return;
    }
    if (plain.includes(TX_QUEUE_DROP_MARKER)) {
      const iface = parseTxDropIface(line);
      if (iface) {
        const drops = parseTxDropCount(line);
        this.txQueueDrops.set(iface, {
          count: drops ?? this.txQueueDrops.get(iface)?.count ?? 0,
          atMs: nowMs,
        });
      }
      return;
    }
    if (plain.includes(LINK_DELIVERY_TIMEOUT_MARKER)) {
      const dest = parseLinkDeliveryTimeoutDest(line);
      if (dest) {
        const prev = this.linkDeliveryTimeouts.get(dest);
        this.linkDeliveryTimeouts.set(dest, {
          count: (prev?.count ?? 0) + 1,
          atMs: nowMs,
        });
      }
      return;
    }
    if (plain.includes(LXMF_PATH_REQUEST_SATURATED_MARKER)) {
      this.transportSaturatedCount += 1;
      this.transportSaturatedAtMs = nowMs;
      return;
    }
    if (plain.includes(SLOW_TRANSPORT_QUERY_MARKER) && parseSlowTransportQuery(line)) {
      this.slowTransportQueryCount += 1;
      this.slowTransportQueryAtMs = nowMs;
    }
  }

  /** Rate-limit repetitive TCP connect lines logged at debug level. */
  recordSuppressedLine(count = 1): void {
    this.suppressedCount += count;
  }

  /**
   * Drop TCP/TX issues for interfaces that are disabled or removed.
   * Stack-wide transport counters are left alone.
   */
  retainInterfaces(enabledNames: ReadonlySet<string>): void {
    for (const name of [...this.tcpConnectFailed.keys()]) {
      if (!enabledNames.has(name)) {
        this.tcpConnectFailed.delete(name);
      }
    }
    for (const name of [...this.txQueueDrops.keys()]) {
      if (!enabledNames.has(name)) {
        this.txQueueDrops.delete(name);
      }
    }
  }

  clear(): void {
    this.tcpConnectFailed.clear();
    this.txQueueDrops.clear();
    this.linkDeliveryTimeouts.clear();
    this.transportSaturatedCount = 0;
    this.transportSaturatedAtMs = null;
    this.slowTransportQueryCount = 0;
    this.slowTransportQueryAtMs = null;
    this.suppressedCount = 0;
  }

  /** @deprecated Prefer {@link clear}; kept for existing test call sites. */
  resetForTests(): void {
    this.clear();
  }

  getAlert(nowMs = Date.now()): ReticulumInterfaceIssueAlert | null {
    pruneStaleTimestamps(this.tcpConnectFailed, nowMs);
    pruneStaleCounted(this.txQueueDrops, nowMs);
    pruneStaleCounted(this.linkDeliveryTimeouts, nowMs);

    if (
      this.transportSaturatedAtMs != null &&
      nowMs - this.transportSaturatedAtMs > RETICULUM_INTERFACE_ISSUE_ALERT_STALE_MS
    ) {
      this.transportSaturatedCount = 0;
      this.transportSaturatedAtMs = null;
    }
    if (
      this.slowTransportQueryAtMs != null &&
      nowMs - this.slowTransportQueryAtMs > RETICULUM_INTERFACE_ISSUE_ALERT_STALE_MS
    ) {
      this.slowTransportQueryCount = 0;
      this.slowTransportQueryAtMs = null;
    }

    const timestamps: number[] = [
      ...this.tcpConnectFailed.values(),
      ...[...this.txQueueDrops.values()].map((e) => e.atMs),
      ...[...this.linkDeliveryTimeouts.values()].map((e) => e.atMs),
    ];
    if (this.transportSaturatedAtMs != null) timestamps.push(this.transportSaturatedAtMs);
    if (this.slowTransportQueryAtMs != null) timestamps.push(this.slowTransportQueryAtMs);

    const lastAtMs = timestamps.length > 0 ? Math.max(...timestamps) : null;
    if (lastAtMs == null) {
      return null;
    }

    const tcpConnectFailed = [...this.tcpConnectFailed.keys()].sort();
    const txQueueDrops = [...this.txQueueDrops.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, entry]) => ({ name, dropCount: entry.count }));
    const linkDeliveryTimeouts = [...this.linkDeliveryTimeouts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([destinationHash, entry]) => ({ destinationHash, count: entry.count }));

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
      lastAtMs,
    };
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
