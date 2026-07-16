/** Tracks TCP connect failures and TX queue drops parsed from sidecar stdout/stderr. */

import type { ReticulumInterfaceIssueAlert } from '../shared/reticulum-types';
import { RETICULUM_INTERFACE_ISSUE_ALERT_STALE_MS } from '../shared/reticulum-types';

const TCP_CONNECT_FAILED_MARKER = 'TCP connect failed';
const TX_QUEUE_DROP_MARKER = 'PACKET DROPPED: interface TX channel full';
const LINK_DELIVERY_TIMEOUT_MARKER = 'link delivery timed out';
const LXMF_PATH_REQUEST_SATURATED_MARKER = 'failed to queue path request for LXMF delivery';
const SLOW_TRANSPORT_QUERY_MARKER = 'transport query slow or failed';
const BLE_BOND_REMOVED_MARKER = 'Peer removed pairing information';

const TCP_CONNECT_IFACE_RE = /TCP connect failed.*?name\s*=\s*(.+?)(?:\s+error\s*=|$)/;
const TX_DROP_IFACE_RE =
  /PACKET DROPPED: interface TX channel full.*?interface_name\s*=\s*(.+?)(?:\s+queue|$)/;
const TX_DROP_COUNT_RE = /tx_drops\s*=\s*(\d+)/;
const LINK_TIMEOUT_DEST_RE =
  /link delivery timed out.*?dest\s*=\s*([0-9a-fA-F]{32}|[0-9a-fA-F]{16})/;
const SLOW_TRANSPORT_QUERY_RE = /transport query slow or failed.*?query\s*=\s*(\S+)/;
const BLE_BOND_REMOVED_IFACE_RE = /BLE RNode connect failed.*?name\s*=\s*(.+?)(?:\s+error\s*=|$)/i;

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

function parseBleBondRemovedIface(line: string): string | null {
  const plain = normalizeSidecarLogLine(line);
  if (!plain.includes(BLE_BOND_REMOVED_MARKER)) {
    return null;
  }
  const match = BLE_BOND_REMOVED_IFACE_RE.exec(plain);
  return match?.[1]?.trim() ?? null;
}

function pruneStaleMap<T>(map: Map<string, T>, nowMs: number, getAtMs: (value: T) => number): void {
  for (const [key, value] of map) {
    if (nowMs - getAtMs(value) > RETICULUM_INTERFACE_ISSUE_ALERT_STALE_MS) {
      map.delete(key);
    }
  }
}

function retainMapKeys<T>(map: Map<string, T>, enabledNames: ReadonlySet<string>): void {
  for (const name of [...map.keys()]) {
    if (!enabledNames.has(name)) {
      map.delete(name);
    }
  }
}

interface CountedAt {
  count: number;
  atMs: number;
}

export class ReticulumSidecarInterfaceIssueTracker {
  /** interface name → last-seen ms */
  private tcpConnectFailed = new Map<string, number>();
  /** interface name → drop count + last-seen ms */
  private txQueueDrops = new Map<string, CountedAt>();
  /** destination hash → count + last-seen ms */
  private linkDeliveryTimeouts = new Map<string, CountedAt>();
  /** BLE RNode display name → last-seen ms (stale OS bond / peer removed pairing). */
  private bleBondRemoved = new Map<string, number>();
  private transportSaturatedCount = 0;
  private transportSaturatedAtMs: number | null = null;
  private slowTransportQueryCount = 0;
  private slowTransportQueryAtMs: number | null = null;
  private suppressedCount = 0;
  /**
   * Last synced enabled interface names. When set, TCP/TX latches for names
   * outside the set are ignored (sticky across config-apply lag after disable).
   * Null until the first {@link retainInterfaces} call.
   */
  private enabledInterfaceScope: ReadonlySet<string> | null = null;

  private allowsInterface(name: string): boolean {
    return this.enabledInterfaceScope == null || this.enabledInterfaceScope.has(name);
  }

  recordLine(line: string, nowMs = Date.now()): void {
    const plain = normalizeSidecarLogLine(line);
    if (plain.includes(TCP_CONNECT_FAILED_MARKER)) {
      const iface = parseTcpConnectFailedIface(line);
      if (iface && this.allowsInterface(iface)) {
        this.tcpConnectFailed.set(iface, nowMs);
      }
      return;
    }
    if (plain.includes(TX_QUEUE_DROP_MARKER)) {
      const iface = parseTxDropIface(line);
      if (iface && this.allowsInterface(iface)) {
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
      return;
    }
    const bleBondIface = parseBleBondRemovedIface(line);
    if (bleBondIface && this.allowsInterface(bleBondIface)) {
      this.bleBondRemoved.set(bleBondIface, nowMs);
    }
  }

  /** Rate-limit repetitive TCP connect lines logged at debug level. */
  recordSuppressedLine(count = 1): void {
    this.suppressedCount += count;
  }

  /**
   * Drop TCP/TX issues for interfaces that are disabled or removed, and remember
   * the enabled set so later log lines cannot re-latch those names.
   * Stack-wide transport counters are left alone.
   */
  retainInterfaces(enabledNames: ReadonlySet<string>): void {
    this.enabledInterfaceScope = new Set(enabledNames);
    retainMapKeys(this.tcpConnectFailed, enabledNames);
    retainMapKeys(this.txQueueDrops, enabledNames);
    retainMapKeys(this.bleBondRemoved, enabledNames);
  }

  clear(): void {
    this.tcpConnectFailed.clear();
    this.txQueueDrops.clear();
    this.linkDeliveryTimeouts.clear();
    this.bleBondRemoved.clear();
    this.transportSaturatedCount = 0;
    this.transportSaturatedAtMs = null;
    this.slowTransportQueryCount = 0;
    this.slowTransportQueryAtMs = null;
    this.suppressedCount = 0;
    this.enabledInterfaceScope = null;
  }

  /** @deprecated Prefer {@link clear}; kept for existing test call sites. */
  resetForTests(): void {
    this.clear();
  }

  private pruneStale(nowMs: number): void {
    pruneStaleMap(this.tcpConnectFailed, nowMs, (atMs) => atMs);
    pruneStaleMap(this.txQueueDrops, nowMs, (entry) => entry.atMs);
    pruneStaleMap(this.linkDeliveryTimeouts, nowMs, (entry) => entry.atMs);
    pruneStaleMap(this.bleBondRemoved, nowMs, (atMs) => atMs);

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
  }

  /** Build alert from current maps without pruning. */
  peekAlert(): ReticulumInterfaceIssueAlert | null {
    const timestamps: number[] = [
      ...this.tcpConnectFailed.values(),
      ...[...this.txQueueDrops.values()].map((e) => e.atMs),
      ...[...this.linkDeliveryTimeouts.values()].map((e) => e.atMs),
      ...this.bleBondRemoved.values(),
    ];
    if (this.transportSaturatedAtMs != null) timestamps.push(this.transportSaturatedAtMs);
    if (this.slowTransportQueryAtMs != null) timestamps.push(this.slowTransportQueryAtMs);

    const lastAtMs = timestamps.length > 0 ? Math.max(...timestamps) : null;
    if (lastAtMs == null) {
      this.suppressedCount = 0;
      return null;
    }

    const tcpConnectFailed = [...this.tcpConnectFailed.keys()].sort((a, b) => a.localeCompare(b));
    const txQueueDrops = [...this.txQueueDrops.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, entry]) => ({ name, dropCount: entry.count }));
    const linkDeliveryTimeouts = [...this.linkDeliveryTimeouts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([destinationHash, entry]) => ({ destinationHash, count: entry.count }));
    const bleBondRemoved = [...this.bleBondRemoved.keys()].sort((a, b) => a.localeCompare(b));

    if (
      tcpConnectFailed.length === 0 &&
      txQueueDrops.length === 0 &&
      linkDeliveryTimeouts.length === 0 &&
      bleBondRemoved.length === 0 &&
      this.transportSaturatedCount === 0 &&
      this.slowTransportQueryCount === 0
    ) {
      this.suppressedCount = 0;
      return null;
    }

    return {
      tcpConnectFailed,
      txQueueDrops,
      linkDeliveryTimeouts,
      bleBondRemoved,
      transportSaturatedCount: this.transportSaturatedCount,
      slowTransportQueryCount: this.slowTransportQueryCount,
      suppressedCount: this.suppressedCount,
      lastAtMs,
    };
  }

  getAlert(nowMs = Date.now()): ReticulumInterfaceIssueAlert | null {
    this.pruneStale(nowMs);
    return this.peekAlert();
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

export function parseBleBondRemovedIfaceForTests(line: string): string | null {
  return parseBleBondRemovedIface(line);
}
