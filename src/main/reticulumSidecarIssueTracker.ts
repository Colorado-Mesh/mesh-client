/** Tracks TCP connect failures and TX queue drops parsed from sidecar stdout/stderr. */

import type { ReticulumInterfaceIssueAlert } from '../shared/reticulum-types';
import { MS_PER_SECOND } from '../shared/timeConstants';

const ALERT_STALE_MS = 5 * 60 * MS_PER_SECOND;
const TCP_CONNECT_FAILED_MARKER = 'TCP connect failed';
const TX_QUEUE_DROP_MARKER = 'PACKET DROPPED: interface TX channel full';

const TCP_CONNECT_IFACE_RE = /TCP connect failed.*?name\s*=\s*(.+?)(?:\s+error\s*=|$)/;
const TX_DROP_IFACE_RE =
  /PACKET DROPPED: interface TX channel full.*?interface_name\s*=\s*(.+?)(?:\s+queue|$)/;
const TX_DROP_COUNT_RE = /tx_drops\s*=\s*(\d+)/;

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

export class ReticulumSidecarInterfaceIssueTracker {
  private tcpConnectFailed = new Map<string, number>();
  private txQueueDrops = new Map<string, number>();
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
    if (tcpConnectFailed.length === 0 && txQueueDrops.length === 0) {
      return null;
    }
    return {
      tcpConnectFailed,
      txQueueDrops,
      suppressedCount: this.suppressedCount,
      lastAtMs: this.lastAtMs,
    };
  }

  resetForTests(): void {
    this.tcpConnectFailed.clear();
    this.txQueueDrops.clear();
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
