/** Tracks AutoInterface beacon TX failures parsed from sidecar stderr. */

import type { ReticulumAutoBeaconAlert } from '../shared/reticulum-types';
import { RETICULUM_INTERFACE_ISSUE_ALERT_STALE_MS } from '../shared/reticulum-types';

const BEACON_FAIL_IFACE_RE = /iface\s*=\s*([A-Za-z0-9_.-]+)/;
const TUNNEL_IFACE_PREFIXES = ['utun', 'ipsec', 'ppp'] as const;

function isTunnelIface(name: string): boolean {
  const lower = name.toLowerCase();
  return TUNNEL_IFACE_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function parseBeaconFailIface(line: string): string | null {
  const match = BEACON_FAIL_IFACE_RE.exec(line);
  return match?.[1] ?? null;
}

export class ReticulumSidecarAutoBeaconTracker {
  private tunnelIfaces = new Set<string>();
  private physicalIfaces = new Set<string>();
  private suppressedCount = 0;
  private lastAtMs = 0;

  recordFailure(line: string, suppressed: boolean, nowMs = Date.now()): void {
    if (suppressed) {
      this.suppressedCount += 1;
      return;
    }
    this.lastAtMs = nowMs;
    const iface = parseBeaconFailIface(line);
    if (!iface) {
      return;
    }
    if (isTunnelIface(iface)) {
      this.tunnelIfaces.add(iface);
    } else {
      this.physicalIfaces.add(iface);
    }
  }

  clear(): void {
    this.tunnelIfaces.clear();
    this.physicalIfaces.clear();
    this.suppressedCount = 0;
    this.lastAtMs = 0;
  }

  getAlert(nowMs = Date.now()): ReticulumAutoBeaconAlert | null {
    if (this.lastAtMs === 0 || nowMs - this.lastAtMs > RETICULUM_INTERFACE_ISSUE_ALERT_STALE_MS) {
      return null;
    }
    if (this.physicalIfaces.size > 0) {
      return {
        kind: 'physical_failures',
        ifaceNames: [...this.physicalIfaces].sort((a, b) => a.localeCompare(b)),
        suppressedCount: this.suppressedCount,
        lastAtMs: this.lastAtMs,
      };
    }
    if (this.tunnelIfaces.size > 0) {
      return {
        kind: 'tunnel_only',
        ifaceNames: [...this.tunnelIfaces].sort((a, b) => a.localeCompare(b)),
        suppressedCount: this.suppressedCount,
        lastAtMs: this.lastAtMs,
      };
    }
    return null;
  }

  /** @deprecated Prefer {@link clear}; kept for existing test call sites. */
  resetForTests(): void {
    this.clear();
  }
}

export function parseBeaconFailIfaceForTests(line: string): string | null {
  return parseBeaconFailIface(line);
}
