import {
  auditIssuesToDiagnosticRows,
  type ReticulumConfigAuditIssue,
} from '@/renderer/lib/reticulum/reticulumConfigAudit';
import type { ReticulumInboundLxmfDiagnosticsSnapshot } from '@/renderer/lib/reticulum/reticulumInboundLxmfDiagnostics';
import {
  collectReticulumLocalInterfaceAlerts,
  collectReticulumRemoteInterfaceAlerts,
  isReticulumInterfaceOnlineStatus,
  isReticulumLocalSerialInterface,
  isReticulumRemoteInterfaceType,
  type ReticulumLocalInterfaceInput,
} from '@/renderer/lib/reticulum/reticulumLocalInterfaceHealth';
import {
  isPropagationSyncEstablishingStuck,
  RETICULUM_PROPAGATION_SYNC_FAILING_DIAGNOSTIC_TTL_MS,
} from '@/renderer/lib/reticulum/reticulumPropagationSync';
import { type DiagnosticRow, rfRowId } from '@/renderer/lib/types';
import { PROPAGATION_SYNC_USER_CANCEL_KEY } from '@/renderer/stores/reticulumPropagationStore';
import type {
  ReticulumAutoBeaconAlert,
  ReticulumInterfaceIssueAlert,
} from '@/shared/reticulum-types';
import { MS_PER_MINUTE } from '@/shared/timeConstants';

export interface ReticulumDiagnosticsSnapshot {
  rns_ready?: boolean;
  lxmf_ready?: boolean;
  interface_count?: number;
  contact_count?: number;
  peer_count?: number;
  message_count?: number;
  interfaces?: ReticulumLocalInterfaceInput[];
  /** Sidecar announce coalesce pressure (from GET /api/v1/diagnostics). */
  announce_ws?: ReticulumAnnounceWsDiagnostics;
}

/** Sidecar `announce_ws` block — last coalesce-window pressure metrics. */
export interface ReticulumAnnounceWsDiagnostics {
  last_window_ingress?: number;
  last_window_unique?: number;
  last_window_overflow?: number;
  last_storm_at_ms?: number;
  last_flush_at_ms?: number;
}

/** How long announce-bus pressure signals stay actionable in Diagnostics. */
export const RETICULUM_ANNOUNCE_BUS_PRESSURE_TTL_MS = 5 * MS_PER_MINUTE;
/** Minimum WS frames skipped before lag alone opens the announce-bus pressure row. */
export const RETICULUM_ANNOUNCE_BUS_PRESSURE_MIN_SKIPPED = 8;

/** Propagation sync snapshot for diagnostics (derived from reticulumPropagationStore). */
export interface ReticulumPropagationDiagnosticsInput {
  syncActive: boolean;
  syncProgress: number;
  lastSyncError: string | null;
  /** Epoch ms when the current/last sync attempt started. */
  lastAttemptAt: number | null;
}

export interface ReticulumDiagnosticsBuildOptions {
  selfNodeId?: number;
  interfaces?: ReticulumLocalInterfaceInput[];
  osSerialPorts?: string[];
  auditIssues?: ReticulumConfigAuditIssue[];
  autoBeaconAlert?: ReticulumAutoBeaconAlert | null;
  interfaceIssueAlert?: ReticulumInterfaceIssueAlert | null;
  /** When true, append shared-instance conflict hint on transport saturation rows. */
  shareInstanceEnabled?: boolean;
  /** Sidecar hung watchdog — only emit when running && healthy === false. */
  sidecarRunning?: boolean;
  sidecarHealthy?: boolean;
  sidecarUnhealthySince?: number;
  propagation?: ReticulumPropagationDiagnosticsInput;
  /** Renderer-local WS lag / inbound catch-up counters. */
  inboundLxmf?: ReticulumInboundLxmfDiagnosticsSnapshot;
}

function runtimeCauseI18n(
  key: string,
  params?: Record<string, string>,
): { key: string; params?: Record<string, string> } {
  return { key: `diagnosticsPanel.reticulum.runtime.${key}`, params };
}

/** Quoted for i18n unused-key audit — keys emitted via causeI18n at runtime. */
export const RETICULUM_RUNTIME_CAUSE_I18N_KEYS = [
  'diagnosticsPanel.reticulum.runtime.rnsNotReady',
  'diagnosticsPanel.reticulum.runtime.lxmfNotReady',
  'diagnosticsPanel.reticulum.runtime.localStalePort',
  'diagnosticsPanel.reticulum.runtime.localOffline',
  'diagnosticsPanel.reticulum.runtime.tcpUnreachable',
  'diagnosticsPanel.reticulum.runtime.interfaceDown',
  'diagnosticsPanel.reticulum.runtime.tcpConnectFailed',
  'diagnosticsPanel.reticulum.runtime.txQueueDrops',
  'diagnosticsPanel.reticulum.runtime.bleBondRemoved',
  'diagnosticsPanel.reticulum.runtime.blePairingTimedOut',
  'diagnosticsPanel.reticulum.runtime.noPeers',
  'diagnosticsPanel.reticulum.runtime.autoBeaconTunnelOnly',
  'diagnosticsPanel.reticulum.runtime.autoBeaconPhysicalFailures',
  'diagnosticsPanel.reticulum.runtime.linkDeliveryTimeout',
  'diagnosticsPanel.reticulum.runtime.transportSaturated',
  'diagnosticsPanel.reticulum.runtime.transportSaturatedShareInstance',
  'diagnosticsPanel.reticulum.runtime.slowTransportQuery',
  'diagnosticsPanel.reticulum.runtime.sidecarUnhealthy',
  'diagnosticsPanel.reticulum.runtime.propagationSyncStuck',
  'diagnosticsPanel.reticulum.runtime.propagationSyncFailing',
  'diagnosticsPanel.reticulum.runtime.announceBusPressure',
] as const;

/** Sidecar must stay unhealthy this long before emitting an error diagnostic. */
export const RETICULUM_SIDECAR_UNHEALTHY_DIAGNOSTIC_GRACE_MS = 60_000;

/** Build Reticulum-native diagnostic rows (interface/path/LXMF — not LoRa RF). */
export function buildReticulumDiagnosticRows(
  snapshot: ReticulumDiagnosticsSnapshot,
  options?: ReticulumDiagnosticsBuildOptions,
): DiagnosticRow[] {
  const rows: DiagnosticRow[] = [];
  const now = Date.now();
  const homeNodeId = options?.selfNodeId ?? 0;

  if (!snapshot.rns_ready) {
    rows.push({
      kind: 'rf',
      id: rfRowId(homeNodeId, 'reticulum/rns-not-ready'),
      nodeId: homeNodeId,
      condition: 'reticulum/rns-not-ready',
      cause: 'RNS stack is not ready',
      causeI18n: runtimeCauseI18n('rnsNotReady'),
      severity: 'warning',
      detectedAt: now,
      reticulumRepairKind: 'restart_stack',
    });
  }

  if (!snapshot.lxmf_ready) {
    rows.push({
      kind: 'rf',
      id: rfRowId(homeNodeId, 'reticulum/lxmf-not-ready'),
      nodeId: homeNodeId,
      condition: 'reticulum/lxmf-not-ready',
      cause: 'LXMF router is not ready',
      causeI18n: runtimeCauseI18n('lxmfNotReady'),
      severity: 'warning',
      detectedAt: now,
      reticulumRepairKind: 'restart_stack',
    });
  }

  const healthInterfaces = options?.interfaces ?? snapshot.interfaces ?? [];
  const osSerialPorts = options?.osSerialPorts ?? [];
  const localAlerts = collectReticulumLocalInterfaceAlerts(healthInterfaces, osSerialPorts);
  const localAlertIds = new Set(localAlerts.map((a) => a.iface.id));
  const remoteAlerts = collectReticulumRemoteInterfaceAlerts(healthInterfaces);
  const remoteAlertIds = new Set(remoteAlerts.map((a) => a.iface.id));

  for (const alert of localAlerts) {
    const port = alert.iface.serial_port ?? '';
    if (alert.reason === 'stale_port') {
      rows.push({
        kind: 'rf',
        id: rfRowId(homeNodeId, `reticulum/local-stale-port/${alert.iface.id}`),
        nodeId: homeNodeId,
        condition: 'reticulum/local-stale-port',
        cause: `Local interface "${alert.iface.name}" serial port ${port} not found on this system`,
        causeI18n: runtimeCauseI18n('localStalePort', {
          name: alert.iface.name,
          port,
        }),
        severity: 'warning',
        detectedAt: now,
        reticulumInterfaceId: alert.iface.id,
        reticulumRepairKind: 'edit',
      });
    } else {
      rows.push({
        kind: 'rf',
        id: rfRowId(homeNodeId, `reticulum/local-offline/${alert.iface.id}`),
        nodeId: homeNodeId,
        condition: 'reticulum/local-offline',
        cause: `Local interface "${alert.iface.name}" is enabled but offline`,
        causeI18n: runtimeCauseI18n('localOffline', { name: alert.iface.name }),
        severity: 'warning',
        detectedAt: now,
        reticulumInterfaceId: alert.iface.id,
        reticulumRepairKind: 'restart_stack',
      });
    }
  }

  for (const alert of remoteAlerts) {
    const host = alert.iface.host ?? '';
    const port = alert.iface.port != null && alert.iface.port > 0 ? String(alert.iface.port) : '';
    rows.push({
      kind: 'rf',
      id: rfRowId(homeNodeId, `reticulum/tcp-unreachable/${alert.iface.id}`),
      nodeId: homeNodeId,
      condition: 'reticulum/tcp-unreachable',
      cause: `TCP interface "${alert.iface.name}" is unreachable`,
      causeI18n: runtimeCauseI18n('tcpUnreachable', {
        name: alert.iface.name,
        host,
        port,
      }),
      severity: 'warning',
      detectedAt: now,
      reticulumInterfaceId: alert.iface.id,
      reticulumRepairKind: 'disable',
    });
  }

  for (const iface of healthInterfaces) {
    if (localAlertIds.has(iface.id) || remoteAlertIds.has(iface.id)) {
      continue;
    }
    if (isReticulumLocalSerialInterface(iface.type) || isReticulumRemoteInterfaceType(iface.type)) {
      continue;
    }
    if (iface.enabled && !isReticulumInterfaceOnlineStatus(iface.status)) {
      rows.push({
        kind: 'rf',
        id: rfRowId(homeNodeId, `reticulum/iface-down/${iface.id}`),
        nodeId: homeNodeId,
        condition: 'reticulum/interface-down',
        cause: `${iface.type} interface "${iface.name}" is enabled but ${iface.status}`,
        causeI18n: runtimeCauseI18n('interfaceDown', {
          type: iface.type,
          name: iface.name,
          status: iface.status,
        }),
        severity: 'warning',
        detectedAt: now,
        reticulumInterfaceId: iface.id,
        reticulumRepairKind: 'edit',
      });
    }
  }

  const interfaceIssueAlert = options?.interfaceIssueAlert;
  if (interfaceIssueAlert) {
    const ifaceByName = new Map(healthInterfaces.map((iface) => [iface.name, iface]));
    for (const name of interfaceIssueAlert.tcpConnectFailed) {
      if (remoteAlerts.some((alert) => alert.iface.name === name)) {
        continue;
      }
      const iface = ifaceByName.get(name);
      rows.push({
        kind: 'rf',
        id: rfRowId(homeNodeId, `reticulum/tcp-connect-failed/${name}`),
        nodeId: homeNodeId,
        condition: 'reticulum/tcp-connect-failed',
        cause: `TCP interface "${name}" connection refused or timed out`,
        causeI18n: runtimeCauseI18n('tcpConnectFailed', { name }),
        severity: 'warning',
        detectedAt: now,
        reticulumInterfaceId: iface?.id,
        reticulumRepairKind: 'disable',
      });
    }
    for (const drop of interfaceIssueAlert.txQueueDrops) {
      const iface = ifaceByName.get(drop.name);
      rows.push({
        kind: 'rf',
        id: rfRowId(homeNodeId, `reticulum/tx-queue-drops/${drop.name}`),
        nodeId: homeNodeId,
        condition: 'reticulum/tx-queue-drops',
        cause: `Interface "${drop.name}" dropped ${drop.dropCount} outbound packets (TX queue full)`,
        causeI18n: runtimeCauseI18n('txQueueDrops', {
          name: drop.name,
          count: String(drop.dropCount),
        }),
        severity: 'error',
        detectedAt: now,
        reticulumInterfaceId: iface?.id,
        reticulumRepairKind: 'disable',
      });
    }
    for (const name of interfaceIssueAlert.bleBondRemoved) {
      const iface = ifaceByName.get(name);
      rows.push({
        kind: 'rf',
        id: rfRowId(homeNodeId, `reticulum/ble-bond-removed/${name}`),
        nodeId: homeNodeId,
        condition: 'reticulum/ble-bond-removed',
        cause: `BLE RNode "${name}" bond is stale (Peer removed pairing information)`,
        causeI18n: runtimeCauseI18n('bleBondRemoved', { name }),
        severity: 'warning',
        detectedAt: now,
        reticulumInterfaceId: iface?.id,
        reticulumRepairKind: 'edit',
      });
    }
    for (const name of interfaceIssueAlert.blePairingTimedOut) {
      const iface = ifaceByName.get(name);
      rows.push({
        kind: 'rf',
        id: rfRowId(homeNodeId, `reticulum/ble-pairing-timed-out/${name}`),
        nodeId: homeNodeId,
        condition: 'reticulum/ble-pairing-timed-out',
        cause: `BLE RNode "${name}" passkey exchange timed out`,
        causeI18n: runtimeCauseI18n('blePairingTimedOut', { name }),
        severity: 'warning',
        detectedAt: now,
        reticulumInterfaceId: iface?.id,
        reticulumRepairKind: 'edit',
      });
    }
    for (const timeout of interfaceIssueAlert.linkDeliveryTimeouts) {
      rows.push({
        kind: 'rf',
        id: rfRowId(homeNodeId, `reticulum/link-delivery-timeout/${timeout.destinationHash}`),
        nodeId: homeNodeId,
        condition: 'reticulum/link-delivery-timeout',
        cause: `Direct LXMF link to ${timeout.destinationHash.slice(0, 8)}… timed out (${timeout.count}×)`,
        causeI18n: runtimeCauseI18n('linkDeliveryTimeout', {
          hash: timeout.destinationHash.slice(0, 8),
          count: String(timeout.count),
        }),
        // Peer reachability — not stack interface health (Connection omits these).
        severity: 'warning',
        detectedAt: now,
        reticulumRepairKind: 'restart_stack',
      });
    }
    if (interfaceIssueAlert.transportSaturatedCount > 0) {
      rows.push({
        kind: 'rf',
        id: rfRowId(homeNodeId, 'reticulum/transport-saturated'),
        nodeId: homeNodeId,
        condition: 'reticulum/transport-saturated',
        cause: `RNS transport saturated (${interfaceIssueAlert.transportSaturatedCount} path-request drops)`,
        causeI18n: runtimeCauseI18n(
          options.shareInstanceEnabled ? 'transportSaturatedShareInstance' : 'transportSaturated',
          {
            count: String(interfaceIssueAlert.transportSaturatedCount),
          },
        ),
        severity: 'error',
        detectedAt: now,
        reticulumRepairKind: 'restart_stack',
      });
    }
    if (interfaceIssueAlert.slowTransportQueryCount > 0) {
      rows.push({
        kind: 'rf',
        id: rfRowId(homeNodeId, 'reticulum/slow-transport-query'),
        nodeId: homeNodeId,
        condition: 'reticulum/slow-transport-query',
        cause: `RNS transport queries slow or failing (${interfaceIssueAlert.slowTransportQueryCount}×)`,
        causeI18n: runtimeCauseI18n('slowTransportQuery', {
          count: String(interfaceIssueAlert.slowTransportQueryCount),
        }),
        severity: 'warning',
        detectedAt: now,
        reticulumRepairKind: 'restart_stack',
      });
    }
  }

  if ((snapshot.peer_count ?? 0) === 0 && (snapshot.interface_count ?? 0) > 0) {
    rows.push({
      kind: 'rf',
      id: rfRowId(homeNodeId, 'reticulum/no-peers'),
      nodeId: homeNodeId,
      condition: 'reticulum/no-peers',
      cause: 'No known peers in path table yet',
      causeI18n: runtimeCauseI18n('noPeers'),
      severity: 'info',
      detectedAt: now,
    });
  }

  if (options?.auditIssues?.length) {
    rows.push(...auditIssuesToDiagnosticRows(options.auditIssues, homeNodeId));
  }

  const autoBeacon = options?.autoBeaconAlert;
  if (autoBeacon?.kind === 'physical_failures') {
    rows.push({
      kind: 'rf',
      id: rfRowId(homeNodeId, 'reticulum/auto-beacon-physical'),
      nodeId: homeNodeId,
      condition: 'reticulum/auto-beacon-physical',
      cause: `AutoInterface beacon TX failing on ${autoBeacon.ifaceNames.join(', ')}`,
      causeI18n: runtimeCauseI18n('autoBeaconPhysicalFailures', {
        ifaces: autoBeacon.ifaceNames.join(', '),
      }),
      severity: 'warning',
      detectedAt: now,
      reticulumRepairKind: 'restart_stack',
    });
  } else if (autoBeacon?.kind === 'tunnel_only') {
    rows.push({
      kind: 'rf',
      id: rfRowId(homeNodeId, 'reticulum/auto-beacon-tunnel'),
      nodeId: homeNodeId,
      condition: 'reticulum/auto-beacon-tunnel',
      cause: `AutoInterface beacon TX failing on VPN tunnel ${autoBeacon.ifaceNames.join(', ')} — update mesh-client or disable AutoInterface if log spam persists`,
      causeI18n: runtimeCauseI18n('autoBeaconTunnelOnly', {
        ifaces: autoBeacon.ifaceNames.join(', '),
      }),
      severity: 'info',
      detectedAt: now,
    });
  }

  if (options?.sidecarRunning === true && options.sidecarHealthy === false) {
    const unhealthySince = options.sidecarUnhealthySince;
    const pastGrace =
      unhealthySince != null &&
      now - unhealthySince >= RETICULUM_SIDECAR_UNHEALTHY_DIAGNOSTIC_GRACE_MS;
    if (pastGrace) {
      rows.push({
        kind: 'rf',
        id: rfRowId(homeNodeId, 'reticulum/sidecar-unhealthy'),
        nodeId: homeNodeId,
        condition: 'reticulum/sidecar-unhealthy',
        cause: 'Reticulum sidecar is running but not responding to health checks',
        causeI18n: runtimeCauseI18n('sidecarUnhealthy'),
        severity: 'error',
        detectedAt: now,
        reticulumRepairKind: 'restart_stack',
      });
    }
  }

  if (shouldEmitAnnounceBusPressure(snapshot.announce_ws, options?.inboundLxmf, now)) {
    rows.push({
      kind: 'rf',
      id: rfRowId(homeNodeId, 'reticulum/announce-bus-pressure'),
      nodeId: homeNodeId,
      condition: 'reticulum/announce-bus-pressure',
      cause:
        'High announce/path-response rate may delay inbound LXMF Chat delivery (WS catch-up active)',
      causeI18n: runtimeCauseI18n('announceBusPressure'),
      severity: 'warning',
      detectedAt: now,
    });
  }

  const propagation = options?.propagation;
  if (propagation) {
    const attemptAt = propagation.lastAttemptAt;
    const stuck = isPropagationSyncEstablishingStuck(
      {
        syncActive: propagation.syncActive,
        syncProgress: propagation.syncProgress,
        lastAttemptAt: attemptAt,
      },
      now,
    );
    if (stuck) {
      rows.push({
        kind: 'rf',
        id: rfRowId(homeNodeId, 'reticulum/propagation-sync-stuck'),
        nodeId: homeNodeId,
        condition: 'reticulum/propagation-sync-stuck',
        cause: 'Propagation node sync is stuck establishing a link',
        causeI18n: runtimeCauseI18n('propagationSyncStuck'),
        severity: 'warning',
        detectedAt: now,
      });
    } else if (
      !propagation.syncActive &&
      propagation.lastSyncError != null &&
      propagation.lastSyncError !== PROPAGATION_SYNC_USER_CANCEL_KEY &&
      attemptAt != null &&
      now - attemptAt <= RETICULUM_PROPAGATION_SYNC_FAILING_DIAGNOSTIC_TTL_MS
    ) {
      rows.push({
        kind: 'rf',
        id: rfRowId(homeNodeId, 'reticulum/propagation-sync-failing'),
        nodeId: homeNodeId,
        condition: 'reticulum/propagation-sync-failing',
        cause: 'Propagation node sync failed',
        causeI18n: runtimeCauseI18n('propagationSyncFailing'),
        severity: 'warning',
        detectedAt: now,
      });
    }
  }

  return rows;
}

/** True when recent WS lag or sidecar announce coalesce pressure may affect Chat. */
export function shouldEmitAnnounceBusPressure(
  announceWs: ReticulumAnnounceWsDiagnostics | undefined,
  inboundLxmf: ReticulumInboundLxmfDiagnosticsSnapshot | undefined,
  nowMs: number = Date.now(),
): boolean {
  const ttl = RETICULUM_ANNOUNCE_BUS_PRESSURE_TTL_MS;
  if (inboundLxmf?.lastEventsLaggedAt != null) {
    const age = nowMs - inboundLxmf.lastEventsLaggedAt;
    const skipped = inboundLxmf.lastEventsLaggedSkipped ?? 0;
    if (age >= 0 && age < ttl && skipped >= RETICULUM_ANNOUNCE_BUS_PRESSURE_MIN_SKIPPED) {
      return true;
    }
  }
  if (announceWs) {
    const stormAt = announceWs.last_storm_at_ms;
    if (
      typeof stormAt === 'number' &&
      Number.isFinite(stormAt) &&
      stormAt > 0 &&
      nowMs - stormAt >= 0 &&
      nowMs - stormAt < ttl
    ) {
      return true;
    }
    const overflow = announceWs.last_window_overflow ?? 0;
    const flushAt = announceWs.last_flush_at_ms;
    if (
      overflow > 0 &&
      typeof flushAt === 'number' &&
      Number.isFinite(flushAt) &&
      flushAt > 0 &&
      nowMs - flushAt >= 0 &&
      nowMs - flushAt < ttl
    ) {
      return true;
    }
  }
  return false;
}

/** Merge Reticulum rows into an existing diagnostic row list (replace prior Reticulum rows). */
export function mergeReticulumDiagnosticRows(
  current: DiagnosticRow[],
  reticulumRows: DiagnosticRow[],
): DiagnosticRow[] {
  const withoutReticulum = current.filter(
    (row) => row.kind !== 'rf' || !row.condition.startsWith('reticulum/'),
  );
  return [...withoutReticulum, ...reticulumRows];
}

/** True when a diagnostic row belongs to Reticulum native diagnostics. */
export function isReticulumDiagnosticRow(row: DiagnosticRow): boolean {
  return row.kind === 'rf' && row.condition.startsWith('reticulum/');
}
