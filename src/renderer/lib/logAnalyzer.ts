import { formatIsoDate } from '../../shared/formatIsoDate';
import { formatDisplayTime } from './formatDisplayTime';
import type { MeshProtocol } from './types';

export interface LogEntry {
  ts: number;
  level: string;
  source: string;
  message: string;
}

export type LogSeverity = 'error' | 'warning' | 'info';

export interface PatternCategory {
  id: string;
  patterns: RegExp[];
  severity: LogSeverity;
  protocols?: MeshProtocol[];
  /** When true, only warn/error level entries can match (reduces false positives on debug noise). */
  requireWarnOrError?: boolean;
  /**
   * Merge key for the analyze modal when multiple category rows share one recommendation.
   * Defaults to `id` (one row per category).
   */
  recommendationGroup?: string;
}

type CategorySeverity = 'error' | 'warning' | 'info';

export interface CategoryFinding {
  id: string;
  /** Same as `PatternCategory.recommendationGroup` or category `id` when unset. */
  recommendationGroup: string;
  count: number;
  severity: CategorySeverity;
  lastTs: number;
  /** Truncated message from the most recent matching line. */
  lastMessage: string;
  /** Matching evidence, newest first. Entries retain their original timestamps and sources. */
  entries: LogEntry[];
}

export interface AnalysisResult {
  totalEntries: number;
  errorCount: number;
  warningCount: number;
  oldestTs: number;
  newestTs: number;
  categories: CategoryFinding[];
}

const LAST_MESSAGE_MAX = 100;

/** Grouped recommendation for the modal (deduped by `recommendationGroup`). */
export interface DedupedRecommendation {
  recommendationGroup: string;
  severity: 'error' | 'warning' | 'info';
  categoryIds: string[];
}

function truncateLastMessage(message: string): string {
  const oneLine = message.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= LAST_MESSAGE_MAX) return oneLine;
  return `${oneLine.slice(0, LAST_MESSAGE_MAX - 1)}…`;
}

/**
 * Categories are evaluated independently; one log line may match multiple patterns.
 * dedupeRecommendations() merges rows that share the same `recommendationGroup` in the analyze modal.
 *
 * Protocol: `LogEntry` has no protocol field. `analyzeLogs()` receives the **currently active**
 * radio protocol only to include or skip categories with `protocols?: [...]`. Most categories
 * apply regardless of protocol; a subset (e.g. MeshCore TCP, stack-specific SDK rows) is gated.
 * Exported or buffered logs may contain lines from another protocol than the one selected at
 * analysis time.
 */
const PATTERN_CATEGORIES: PatternCategory[] = [
  {
    id: 'renderer-unresponsive',
    patterns: [/\[main\] renderer (?:unresponsive|webContents unresponsive|heartbeat stalled)/i],
    severity: 'warning',
    requireWarnOrError: true,
  },
  {
    id: 'database-persistence',
    patterns: [/\[dbPersistRetry\] degraded persistence:/i],
    severity: 'error',
    requireWarnOrError: true,
  },
  {
    id: 'meshtastic-tcp',
    patterns: [/\[IPC\] meshtastic:tcp-(?:connect|write)\s+error/i],
    severity: 'error',
    protocols: ['meshtastic'],
    requireWarnOrError: true,
  },
  {
    id: 'reticulum-sidecar',
    patterns: [
      /\[reticulumSidecarWatchdog\] (?:hung poll failure|restarting hung sidecar|hung restart failed)/i,
      /\[ReticulumIPC\] (?:start|stop) failed:/i,
      /\[ReticulumSidecar\] (?:voice )?ws (?:error|bridge unavailable):/i,
      /\[useReticulumRuntime\] (?:stack restart|stack_restart_requested) failed/i,
    ],
    severity: 'warning',
    protocols: ['reticulum'],
    requireWarnOrError: true,
  },
  {
    id: 'reticulum-delivery',
    patterns: [
      /\[ReticulumSidecar\].*LXMF path request budget exhausted; marking outbound failed/i,
      /\[ReticulumSidecar\].*LXMF outbound delivery failed/i,
      /\[reticulumPropagationStore\] sync\s/i,
      /\[ReticulumSidecar\].*opportunistic LXMF decrypt failed/i,
    ],
    severity: 'warning',
    protocols: ['reticulum'],
    requireWarnOrError: true,
  },
  {
    id: 'reticulum-backpressure',
    patterns: [
      /\[ReticulumSidecar\].*LXMF outbound backchannel saturated/i,
      /\[ReticulumSidecar\].*LXMF inbound raw channel full/i,
      /\[ReticulumSidecar\].*websocket (?:event )?subscriber lagged; (?:some events|frames) dropped/i,
      /\[ReticulumSidecar\].*(?:voice )?ws message exceeded.*byte cap, dropping/i,
      /\[ReticulumSidecar\].*failed to queue path request for LXMF delivery \(transport channel full\)/i,
    ],
    severity: 'warning',
    protocols: ['reticulum'],
    requireWarnOrError: true,
  },
  {
    id: 'firmware-flash',
    patterns: [/\[nrf52DfuFlasher\] sendFirmware stalled/i, /\[esp32Flasher\] writeFlash stalled/i],
    severity: 'warning',
    requireWarnOrError: true,
  },
  {
    id: 'ble-connection',
    patterns: [
      /connectAsync timed out/i,
      /gatt server is disconnected/i,
      /le-connection-abort/i,
      /gatt operation failed/i,
      /BLE.*\s+disconnected?\b/i,
      /BLE.*fail/i,
      /BLE.*timeout/i,
      /Bluetooth.*unavailable/i,
      /Bluetooth.*fail/i,
      /peripheral.*\s+disconnected?\b/i,
    ],
    severity: 'error',
  },
  {
    id: 'mqtt',
    patterns: [
      /\[(?:Meshtastic |MeshCore )?MQTT\].*Network error/i,
      /\[(?:Meshtastic |MeshCore )?MQTT\].*Connection timeout/i,
      /\[(?:Meshtastic |MeshCore )?MQTT\].*will reconnect/i,
      /\[(?:Meshtastic |MeshCore )?MQTT\].*Reconnecting in/i,
      /\[(?:Meshtastic |MeshCore )?MQTT\].*Fatal connection error/i,
      /Subscribe failed/i,
      /MQTT disconnected/i,
      /MQTT.*fail/i,
      /MQTT.*error/i,
      /(?:\[MQTT\]|MQTT|mqtt|broker|:1883|:8883|ECONNREFUSED).*connection refused/i,
      /connection refused.*(?:\[MQTT\]|MQTT|mqtt|broker|:1883|:8883|ECONNREFUSED)/i,
    ],
    severity: 'warning',
  },
  {
    id: 'mqtt-retries-exhausted',
    patterns: [/Connection lost after \d+ reconnect attempt/i],
    severity: 'warning',
  },
  {
    id: 'watchdog',
    patterns: [/watchdog.*stale/i, /watchdog.*dead/i, /watchdog triggered/i],
    severity: 'warning',
  },
  {
    id: 'handshake',
    patterns: [
      /peripheral disconnected during handshake/i,
      /connect aborted by main/i,
      /handshake.*fail/i,
      /handshake.*timeout/i,
    ],
    severity: 'error',
  },
  {
    id: 'ble-connect-race',
    patterns: [
      /disconnect raced ahead of handshake/i,
      /IpcSidecarGattConnection.*timeout.*onConnected/i,
    ],
    severity: 'warning',
    protocols: ['meshcore'],
  },
  {
    id: 'auth-decrypt',
    protocols: ['meshtastic', 'meshcore'],
    patterns: [
      /auth failed/i,
      /decrypt attempt failed/i,
      /decrypt.*failed/i,
      /wrong key/i,
      /decryption failed/i,
    ],
    severity: 'error',
  },
  {
    id: 'native-module',
    patterns: [/native module failed to load/i],
    severity: 'error',
  },
  {
    id: 'internal-error',
    patterns: [
      /\[main\] Uncaught exception:/i,
      /\[main\] Unhandled rejection:/i,
      /\[main\] Renderer process gone:/i,
      /\[main\] Failed to load:/i,
    ],
    severity: 'error',
  },
  {
    id: 'database-error',
    patterns: [
      /\[db\] Database init failed/i,
      /\[db\] Database schema v\d+ is newer than/i,
      /\[db\] Merge failed/i,
      /\[db\] runSchemaUpgrade failed/i,
      /\[db\] migration v\d+ failed/i,
      /\[db\] mergeDatabase failed/i,
      /\[db\] createBaseTables failed/i,
    ],
    severity: 'error',
  },
  {
    id: 'database-chmod',
    patterns: [/\[db\] chmod failed/i],
    severity: 'warning',
  },
  {
    id: 'database-writable',
    patterns: [/Database directory is not writable/i],
    severity: 'error',
  },
  {
    id: 'tak-server',
    patterns: [/\[TakServer\]/i],
    severity: 'warning',
    requireWarnOrError: true,
  },
  {
    id: 'updater',
    patterns: [/\[updater\]/i],
    severity: 'warning',
    requireWarnOrError: true,
  },
  {
    id: 'meshcore-tcp',
    patterns: [/\[IPC\][^\n]*meshcore:tcp-(?:connect|write)\s+error/i],
    severity: 'error',
    protocols: ['meshcore'],
  },
  {
    id: 'ble-meshcore-notify-watchdog',
    patterns: [/\[BLE:meshcore\] notify watchdog/i],
    severity: 'warning',
    protocols: ['meshcore'],
  },
  {
    id: 'bluetooth-pairing',
    patterns: [
      /bluetooth-pairing:\s*PIN prompt timed out/i,
      /bluetooth-pair failed/i,
      /bluetooth-unpair failed/i,
    ],
    severity: 'warning',
  },
  {
    id: 'store-forward',
    patterns: [/Store & Forward history request failed/i],
    severity: 'error',
    protocols: ['meshtastic'],
    requireWarnOrError: true,
  },
  {
    id: 'serial-reconnect',
    patterns: [
      /port is already open/i,
      /Cannot cancel a locked stream/i,
      /reconnectSerial createFromPort failed/i,
      /TransportWebSerial\.createFromPort failed/i,
    ],
    severity: 'warning',
    protocols: ['meshtastic'],
    recommendationGroup: 'serial-reconnect',
    requireWarnOrError: true,
  },
  {
    id: 'sdk-meshtastic',
    patterns: [
      /\[useMeshtasticRuntime\]/i,
      /\[iMeshDevice\]/i,
      /\[TransportSidecarGatt\]/i,
      /\[GATT\]/i,
      /\[GATT:(?:meshtastic|all)\]/i,
      /\[IpcSidecarGattConnection:meshtastic\]/i,
    ],
    severity: 'warning',
    protocols: ['meshtastic'],
    requireWarnOrError: true,
  },
  {
    id: 'sdk-meshcore',
    patterns: [
      /\[useMeshcoreRuntime\]/i,
      /\[MeshcoreMqttAdapter\]/i,
      /\[BLE:meshcore\]/i,
      /\[GATT:meshcore\]/i,
      /\[IpcSidecarGattConnection:meshcore\]/i,
    ],
    severity: 'warning',
    protocols: ['meshcore'],
    requireWarnOrError: true,
  },
  {
    id: 'reticulum-nomad-hosting',
    patterns: [
      /\[nomad-serving\]/i,
      /\[NomadHosting\]/i,
      /nomad.*content source (?:unavailable|missing)/i,
      /failed to restore Nomad serving/i,
      /nomad serving watcher/i,
    ],
    severity: 'warning',
    protocols: ['reticulum'],
    requireWarnOrError: true,
  },
];

function isWarnOrErrorLevel(level: string): boolean {
  return level === 'warn' || level === 'error';
}

/** Cancelled navigations log as did-fail-load with ERR_ABORTED (-3); omit from internal-error. */
function isFailedLoadAbortNoise(message: string): boolean {
  if (!/\[main\] Failed to load:/i.test(message)) return false;
  if (/ERR_ABORTED/i.test(message)) return true;
  return /\[main\] Failed to load:\s*-3\b/.test(message);
}

function matchesCategory(entry: LogEntry, category: PatternCategory): boolean {
  if (category.requireWarnOrError && !isWarnOrErrorLevel(entry.level)) {
    return false;
  }
  return category.patterns.some((p) => {
    if (!p.test(entry.message)) return false;
    if (category.id === 'internal-error' && isFailedLoadAbortNoise(entry.message)) {
      return false;
    }
    return true;
  });
}

export function dedupeRecommendations(categories: CategoryFinding[]): DedupedRecommendation[] {
  const byRec = new Map<string, { severity: 'error' | 'warning' | 'info'; ids: string[] }>();
  const severityOrder = { error: 0, warning: 1, info: 2 };

  for (const cat of categories) {
    const group = cat.recommendationGroup;
    const existing = byRec.get(group);
    if (!existing) {
      byRec.set(group, { severity: cat.severity, ids: [cat.id] });
    } else {
      existing.ids.push(cat.id);
      if (severityOrder[cat.severity] < severityOrder[existing.severity]) {
        existing.severity = cat.severity;
      }
    }
  }

  const rows: DedupedRecommendation[] = Array.from(byRec.entries()).map(
    ([recommendationGroup, v]) => ({
      recommendationGroup,
      severity: v.severity,
      categoryIds: [...new Set(v.ids)].sort((a, b) => a.localeCompare(b)),
    }),
  );

  rows.sort((a, b) => {
    const s = severityOrder[a.severity] - severityOrder[b.severity];
    if (s !== 0) return s;
    return a.recommendationGroup.localeCompare(b.recommendationGroup);
  });

  return rows;
}

/**
 * Summarize log entries into finding categories. `protocol` is the active radio stack in the UI,
 * not per-entry metadata — see the protocol note on `PATTERN_CATEGORIES` above.
 */
export function analyzeLogs(entries: LogEntry[], protocol: MeshProtocol): AnalysisResult {
  if (entries.length === 0) {
    return {
      totalEntries: 0,
      errorCount: 0,
      warningCount: 0,
      oldestTs: Date.now(),
      newestTs: Date.now(),
      categories: [],
    };
  }

  const errorCount = entries.filter((e) => e.level === 'error').length;
  const warningCount = entries.filter((e) => e.level === 'warn').length;

  const timestamps = entries.map((e) => e.ts);
  const oldestTs = Math.min(...timestamps);
  const newestTs = Math.max(...timestamps);

  const categoryFindings: CategoryFinding[] = [];
  const classified = new Set<LogEntry>();

  for (const category of PATTERN_CATEGORIES) {
    if (category.protocols && !category.protocols.includes(protocol)) {
      continue;
    }

    const matchingEntries = entries.filter((e) => matchesCategory(e, category));
    matchingEntries.sort((a, b) => b.ts - a.ts);
    for (const entry of matchingEntries) classified.add(entry);
    if (matchingEntries.length === 0) continue;

    const lastEntry = matchingEntries.reduce((a, b) => (a.ts >= b.ts ? a : b), matchingEntries[0]);
    const lastTs = lastEntry.ts;
    const lastMessage = truncateLastMessage(lastEntry.message);

    categoryFindings.push({
      id: category.id,
      recommendationGroup: category.recommendationGroup ?? category.id,
      count: matchingEntries.length,
      severity: category.severity,
      lastTs,
      lastMessage,
      entries: matchingEntries,
    });
  }
  // Unrecognized warnings are evidence to review, not a guessed root cause.
  // Keep the existing cancelled-navigation exclusion out of this fallback too.
  const unclassified = entries
    .filter(
      (entry) =>
        isWarnOrErrorLevel(entry.level) &&
        !classified.has(entry) &&
        !isFailedLoadAbortNoise(entry.message),
    )
    .sort((a, b) => b.ts - a.ts);
  if (unclassified.length > 0) {
    categoryFindings.push({
      id: 'unclassified',
      recommendationGroup: 'unclassified',
      count: unclassified.length,
      severity: unclassified.some((entry) => entry.level === 'error') ? 'error' : 'warning',
      lastTs: unclassified[0].ts,
      lastMessage: truncateLastMessage(unclassified[0].message),
      entries: unclassified,
    });
  }
  categoryFindings.sort((a, b) => {
    const severityOrder = { error: 0, warning: 1, info: 2 };
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return b.count - a.count;
  });

  return {
    totalEntries: entries.length,
    errorCount,
    warningCount,
    oldestTs,
    newestTs,
    categories: categoryFindings,
  };
}

export function formatTimeRange(oldestTs: number, newestTs: number, use24Hour = false): string {
  const format = (ts: number) => formatDisplayTime(ts, { withSeconds: true, use24Hour });

  const oldestDate = new Date(oldestTs).toDateString();
  const newestDate = new Date(newestTs).toDateString();

  if (oldestDate === newestDate) {
    return `${format(oldestTs)} – ${format(newestTs)}`;
  }
  return `${formatIsoDate(oldestTs)} ${format(oldestTs)} – ${formatIsoDate(newestTs)} ${format(newestTs)}`;
}
