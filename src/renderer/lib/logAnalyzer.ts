import type { MeshProtocol } from './types';

export interface LogEntry {
  ts: number;
  level: string;
  source: string;
  message: string;
}

export interface PatternCategory {
  id: string;
  label: string;
  patterns: RegExp[];
  recommendation: string;
  severity: 'error' | 'warning' | 'info';
  protocols?: MeshProtocol[];
}

export interface CategoryFinding {
  id: string;
  label: string;
  count: number;
  severity: 'error' | 'warning' | 'info';
  recommendation: string;
  lastTs: number;
}

export interface AnalysisResult {
  totalEntries: number;
  errorCount: number;
  warningCount: number;
  oldestTs: number;
  newestTs: number;
  categories: CategoryFinding[];
}

const PATTERN_CATEGORIES: PatternCategory[] = [
  {
    id: 'ble-connection',
    label: 'BLE Connection Issues',
    patterns: [
      /connectAsync timed out/i,
      /gatt server is disconnected/i,
      /le-connection-abort/i,
      /gatt operation failed/i,
      /BLE disconnected/i,
      /Bluetooth.*unavailable/i,
    ],
    recommendation:
      'BLE connection unstable. Check distance to device and Bluetooth adapter status.',
    severity: 'error',
  },
  {
    id: 'mqtt',
    label: 'MQTT Issues',
    patterns: [
      /MQTT Network error/i,
      /Fatal connection error/i,
      /Subscribe failed/i,
      /MQTT disconnected/i,
      /MQTT.*failed/i,
      /Connection refused/i,
    ],
    recommendation:
      'MQTT connection issues. Verify broker URL, credentials, and network connectivity.',
    severity: 'warning',
  },
  {
    id: 'watchdog',
    label: 'Watchdog Triggers',
    patterns: [/watchdog:.*stale for/i, /watchdog:.*dead for/i, /watchdog triggered/i],
    recommendation: 'Watchdog triggered reconnection. Device communication may be unstable.',
    severity: 'warning',
  },
  {
    id: 'handshake',
    label: 'Handshake Failures',
    patterns: [
      /peripheral disconnected during handshake/i,
      /connect aborted by main/i,
      /handshake.*failed/i,
      /handshake.*timeout/i,
    ],
    recommendation: 'Connection handshake failed. Try reconnecting manually.',
    severity: 'error',
  },
  {
    id: 'auth-decrypt',
    label: 'Auth/Decryption Failures',
    patterns: [/auth failed/i, /decrypt attempt failed/i, /wrong key/i, /decryption failed/i],
    recommendation:
      'Authentication or decryption failure. Verify channel keys match between devices.',
    severity: 'error',
  },
  {
    id: 'sdk-meshtastic',
    label: 'Meshtastic SDK Errors',
    patterns: [
      /\[iMeshDevice\].*error/i,
      /\[TransportNobleIpc\].*error/i,
      /\[NobleBleManager\].*error/i,
    ],
    recommendation: 'Meshtastic SDK error. Check device compatibility and firmware version.',
    severity: 'warning',
    protocols: ['meshtastic'],
  },
  {
    id: 'sdk-meshcore',
    label: 'MeshCore SDK Errors',
    patterns: [
      /\[useMeshCore\].*error/i,
      /\[MeshcoreMqttAdapter\].*error/i,
      /\[BLE:meshcore\].*error/i,
    ],
    recommendation: 'MeshCore SDK error. Check device connection and protocol settings.',
    severity: 'warning',
    protocols: ['meshcore'],
  },
];

function matchesCategory(entry: LogEntry, category: PatternCategory): boolean {
  if (category.protocols && entry.source) {
    const sourceMatch = category.protocols.some(
      (p) =>
        entry.source.includes(p) ||
        entry.source.includes(p.toLowerCase()) ||
        entry.source === 'sdk',
    );
    if (!sourceMatch && !category.protocols.includes(entry.source as MeshProtocol)) {
      return category.patterns.some((p) => p.test(entry.message));
    }
  }
  return category.patterns.some((p) => p.test(entry.message));
}

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

  const errorCount = entries.filter((e) => e.level === 'error' || e.level === 'warn').length;
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

    const lastTs = Math.max(...matchingEntries.map((e) => e.ts));

    categoryFindings.push({
      id: category.id,
      label: category.label,
      count: matchingEntries.length,
      severity: category.severity,
      recommendation: category.recommendation,
      lastTs,
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
