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
  label: string;
  patterns: RegExp[];
  recommendation: string;
  severity: LogSeverity;
  protocols?: MeshProtocol[];
  /** When true, only warn/error level entries can match (reduces false positives on debug noise). */
  requireWarnOrError?: boolean;
}

type CategorySeverity = 'error' | 'warning' | 'info';

export interface CategoryFinding {
  id: string;
  label: string;
  count: number;
  severity: CategorySeverity;
  recommendation: string;
  lastTs: number;
  /** Truncated message from the most recent matching line. */
  lastMessage: string;
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

/** Grouped recommendation for the modal (deduped by recommendation text). */
export interface DedupedRecommendation {
  recommendation: string;
  severity: 'error' | 'warning' | 'info';
  /** Category labels that share this recommendation (for context when duplicated). */
  appliesToLabels: string[];
}

function truncateLastMessage(message: string): string {
  const oneLine = message.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= LAST_MESSAGE_MAX) return oneLine;
  return `${oneLine.slice(0, LAST_MESSAGE_MAX - 1)}…`;
}

/**
 * Categories are evaluated independently; one log line may match multiple patterns.
 * dedupeRecommendations() merges identical recommendation text in the analyze modal only.
 *
 * Protocol: `LogEntry` has no protocol field. `analyzeLogs()` receives the **currently active**
 * radio protocol only to include or skip categories with `protocols?: [...]`. Most categories
 * apply regardless of protocol; a subset (e.g. MeshCore TCP, stack-specific SDK rows) is gated.
 * Exported or buffered logs may contain lines from another protocol than the one selected at
 * analysis time.
 */
const PATTERN_CATEGORIES: PatternCategory[] = [
  {
    id: 'ble-connection',
    label: 'BLE Connection Issues',
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
    recommendation:
      'BLE connection unstable. Check distance to device and Bluetooth adapter status.',
    severity: 'error',
  },
  {
    id: 'mqtt',
    label: 'MQTT Issues',
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
    recommendation:
      'MQTT connection issues. Verify broker URL, credentials, and network connectivity.',
    severity: 'warning',
  },
  {
    id: 'mqtt-retries-exhausted',
    label: 'MQTT Reconnect Limit',
    patterns: [/Connection lost after \d+ reconnect attempt/i],
    recommendation:
      'MQTT gave up after max reconnects. Confirm the broker is reachable, credentials and port are correct, and firewalls allow outbound traffic.',
    severity: 'warning',
  },
  {
    id: 'watchdog',
    label: 'Watchdog Triggers',
    patterns: [/watchdog.*stale/i, /watchdog.*dead/i, /watchdog triggered/i],
    recommendation: 'Watchdog triggered reconnection. Device communication may be unstable.',
    severity: 'warning',
  },
  {
    id: 'handshake',
    label: 'Handshake Failures',
    patterns: [
      /peripheral disconnected during handshake/i,
      /connect aborted by main/i,
      /handshake.*fail/i,
      /handshake.*timeout/i,
    ],
    recommendation: 'Connection handshake failed. Try reconnecting manually.',
    severity: 'error',
  },
  {
    id: 'ble-connect-race',
    label: 'BLE Connect Race/Timeout',
    patterns: [/disconnect raced ahead of handshake/i, /IpcNobleConnection.*timeout.*onConnected/i],
    recommendation:
      'BLE handshake timed out or raced with disconnect. Check BLE connection stability and distance to device.',
    severity: 'warning',
    protocols: ['meshcore'],
  },
  {
    id: 'auth-decrypt',
    label: 'Auth/Decryption Failures',
    patterns: [
      /auth failed/i,
      /decrypt attempt failed/i,
      /decrypt.*failed/i,
      /wrong key/i,
      /decryption failed/i,
    ],
    recommendation:
      'Authentication or decryption failure. Verify channel keys match between devices.',
    severity: 'error',
  },
  {
    id: 'native-module',
    label: 'Native Module Load Failure',
    patterns: [/native module failed to load/i],
    recommendation:
      'A native add-on failed to load — often wrong Electron ABI after an upgrade. Run pnpm install in the project folder (or pnpm run rebuild), quit all app instances, and retry.',
    severity: 'error',
  },
  {
    id: 'internal-error',
    label: 'Internal App Errors',
    patterns: [
      /\[main\] Uncaught exception:/i,
      /\[main\] Unhandled rejection:/i,
      /\[main\] Renderer process gone:/i,
      /\[main\] Failed to load:/i,
    ],
    recommendation:
      'An unexpected internal error occurred. Please report this bug with the log file.',
    severity: 'error',
  },
  {
    id: 'database-error',
    label: 'Database Failures',
    patterns: [
      /\[db\] Database init failed/i,
      /\[db\] Merge failed/i,
      /\[db\] runSchemaUpgrade failed/i,
      /\[db\] migration v\d+ failed/i,
      /\[db\] mergeDatabase failed/i,
      /\[db\] createBaseTables failed/i,
    ],
    recommendation:
      'Database error. This may indicate a corrupt database file or permission issue.',
    severity: 'error',
  },
  {
    id: 'database-chmod',
    label: 'Database chmod (non-fatal)',
    patterns: [/\[db\] chmod failed/i],
    recommendation:
      'Database file permission tweak failed (often benign on Windows). If you see real DB errors elsewhere, check antivirus and folder permissions for the mesh-client userData directory.',
    severity: 'warning',
  },
  {
    id: 'database-writable',
    label: 'Database Not Writable',
    patterns: [/Database directory is not writable/i],
    recommendation:
      'The app cannot write its database folder. Fix permissions on the mesh-client userData directory (see troubleshooting: Database directory is not writable).',
    severity: 'error',
  },
  {
    id: 'tak-server',
    label: 'TAK Server Issues',
    patterns: [/\[TakServer\]/i],
    recommendation: 'TAK server error. Check certificate status and port availability.',
    severity: 'warning',
    requireWarnOrError: true,
  },
  {
    id: 'updater',
    label: 'App Updater Errors',
    patterns: [/\[updater\]/i],
    recommendation:
      'App updater error. Check your internet connection or try a manual update from GitHub.',
    severity: 'warning',
    requireWarnOrError: true,
  },
  {
    id: 'meshcore-tcp',
    label: 'MeshCore IP Bridge Errors',
    patterns: [/\[IPC\][^\n]*meshcore:tcp-(?:connect|write)\s+error/i],
    recommendation: 'MeshCore TCP bridge error. Verify the remote host and port are reachable.',
    severity: 'error',
    protocols: ['meshcore'],
  },
  {
    id: 'ble-meshcore-notify-watchdog',
    label: 'BLE Notify Watchdog (MeshCore)',
    patterns: [/\[BLE:meshcore\] notify watchdog/i],
    recommendation:
      'No GATT notify data within the watchdog window (common on Windows). Retry connect; ensure the radio is paired in OS Bluetooth settings before connecting.',
    severity: 'warning',
  },
  {
    id: 'bluetooth-pairing',
    label: 'Bluetooth Pairing Issues',
    patterns: [
      /bluetooth-pairing:\s*PIN prompt timed out/i,
      /bluetooth-pair failed/i,
      /bluetooth-unpair failed/i,
    ],
    recommendation:
      'Bluetooth pairing or unpair failed, or the PIN prompt timed out. Open the app when pairing, enter the PIN promptly, check the MAC address and Bluetooth permissions, or remove and re-pair from OS Bluetooth settings.',
    severity: 'warning',
  },
  {
    id: 'sdk-meshtastic',
    label: 'Meshtastic SDK Warnings/Errors',
    patterns: [
      /\[iMeshDevice\]/i,
      /\[TransportNobleIpc\]/i,
      /\[NobleBleManager\]/i,
      /\[IpcNobleConnection:meshtastic\]/i,
    ],
    recommendation:
      'Meshtastic stack reported a warning or error. If it repeats, check firmware, transport (BLE/serial), and reconnect.',
    severity: 'warning',
    protocols: ['meshtastic'],
    requireWarnOrError: true,
  },
  {
    id: 'sdk-meshcore',
    label: 'MeshCore SDK Warnings/Errors',
    patterns: [
      /\[useMeshCore\]/i,
      /\[MeshcoreMqttAdapter\]/i,
      /\[BLE:meshcore\]/i,
      /\[IpcNobleConnection:meshcore\]/i,
    ],
    recommendation:
      'MeshCore stack reported a warning or error. If it repeats, check BLE pairing, MQTT settings, and reconnect.',
    severity: 'warning',
    protocols: ['meshcore'],
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
  const byRec = new Map<string, { severity: 'error' | 'warning' | 'info'; labels: string[] }>();
  const severityOrder = { error: 0, warning: 1, info: 2 };

  for (const cat of categories) {
    const existing = byRec.get(cat.recommendation);
    if (!existing) {
      byRec.set(cat.recommendation, { severity: cat.severity, labels: [cat.label] });
    } else {
      existing.labels.push(cat.label);
      if (severityOrder[cat.severity] < severityOrder[existing.severity]) {
        existing.severity = cat.severity;
      }
    }
  }

  const rows: DedupedRecommendation[] = Array.from(byRec.entries()).map(([recommendation, v]) => ({
    recommendation,
    severity: v.severity,
    appliesToLabels: [...new Set(v.labels)].sort((a, b) => a.localeCompare(b)),
  }));

  rows.sort((a, b) => {
    const s = severityOrder[a.severity] - severityOrder[b.severity];
    if (s !== 0) return s;
    return a.recommendation.localeCompare(b.recommendation);
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

  for (const category of PATTERN_CATEGORIES) {
    if (category.protocols && !category.protocols.includes(protocol)) {
      continue;
    }

    const matchingEntries = entries.filter((e) => matchesCategory(e, category));
    if (matchingEntries.length === 0) continue;

    const lastEntry = matchingEntries.reduce((a, b) => (a.ts >= b.ts ? a : b), matchingEntries[0]);
    const lastTs = lastEntry.ts;
    const lastMessage = truncateLastMessage(lastEntry.message);

    categoryFindings.push({
      id: category.id,
      label: category.label,
      count: matchingEntries.length,
      severity: category.severity,
      recommendation: category.recommendation,
      lastTs,
      lastMessage,
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

export function formatTimeRange(oldestTs: number, newestTs: number): string {
  const format = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const oldestDate = new Date(oldestTs).toDateString();
  const newestDate = new Date(newestTs).toDateString();

  if (oldestDate === newestDate) {
    return `${format(oldestTs)} – ${format(newestTs)}`;
  }
  return `${new Date(oldestTs).toLocaleDateString()} ${format(oldestTs)} – ${new Date(newestTs).toLocaleDateString()} ${format(newestTs)}`;
}

export function formatTimeAgo(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHr < 24) return `${diffHr} hr ago`;
  return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
}
