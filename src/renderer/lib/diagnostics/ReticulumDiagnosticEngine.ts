import {
  collectReticulumLocalInterfaceAlerts,
  isReticulumLocalSerialInterface,
  type ReticulumLocalInterfaceInput,
} from '@/renderer/lib/reticulum/reticulumLocalInterfaceHealth';
import { type DiagnosticRow, rfRowId } from '@/renderer/lib/types';

export interface ReticulumDiagnosticsSnapshot {
  rns_ready?: boolean;
  lxmf_ready?: boolean;
  interface_count?: number;
  contact_count?: number;
  peer_count?: number;
  message_count?: number;
  interfaces?: {
    id: string;
    name: string;
    type: string;
    enabled: boolean;
    status: string;
    serial_port?: string | null;
  }[];
}

export interface ReticulumDiagnosticsBuildOptions {
  interfaces?: ReticulumLocalInterfaceInput[];
  osSerialPorts?: string[];
}

/** Build Reticulum-native diagnostic rows (interface/path/LXMF — not LoRa RF). */
export function buildReticulumDiagnosticRows(
  snapshot: ReticulumDiagnosticsSnapshot,
  options?: ReticulumDiagnosticsBuildOptions,
): DiagnosticRow[] {
  const rows: DiagnosticRow[] = [];
  const now = Date.now();
  const homeNodeId = 0;

  if (!snapshot.rns_ready) {
    rows.push({
      kind: 'rf',
      id: rfRowId(homeNodeId, 'reticulum/rns-not-ready'),
      nodeId: homeNodeId,
      condition: 'reticulum/rns-not-ready',
      cause: 'RNS stack is not ready',
      severity: 'warning',
      detectedAt: now,
    });
  }

  if (!snapshot.lxmf_ready) {
    rows.push({
      kind: 'rf',
      id: rfRowId(homeNodeId, 'reticulum/lxmf-not-ready'),
      nodeId: homeNodeId,
      condition: 'reticulum/lxmf-not-ready',
      cause: 'LXMF router is not ready',
      severity: 'warning',
      detectedAt: now,
    });
  }

  const healthInterfaces = options?.interfaces ?? snapshot.interfaces ?? [];
  const osSerialPorts = options?.osSerialPorts ?? [];
  const localAlerts = collectReticulumLocalInterfaceAlerts(healthInterfaces, osSerialPorts);
  const localAlertIds = new Set(localAlerts.map((a) => a.iface.id));

  for (const alert of localAlerts) {
    const port = alert.iface.serial_port ?? '';
    if (alert.reason === 'stale_port') {
      rows.push({
        kind: 'rf',
        id: rfRowId(homeNodeId, `reticulum/local-stale-port/${alert.iface.id}`),
        nodeId: homeNodeId,
        condition: 'reticulum/local-stale-port',
        cause: `Local interface "${alert.iface.name}" serial port ${port} not found on this system`,
        severity: 'warning',
        detectedAt: now,
      });
    } else {
      rows.push({
        kind: 'rf',
        id: rfRowId(homeNodeId, `reticulum/local-offline/${alert.iface.id}`),
        nodeId: homeNodeId,
        condition: 'reticulum/local-offline',
        cause: `Local interface "${alert.iface.name}" is enabled but offline`,
        severity: 'warning',
        detectedAt: now,
      });
    }
  }

  for (const iface of snapshot.interfaces ?? []) {
    if (localAlertIds.has(iface.id)) {
      continue;
    }
    if (isReticulumLocalSerialInterface(iface.type)) {
      continue;
    }
    if (iface.enabled && iface.status !== 'up') {
      rows.push({
        kind: 'rf',
        id: rfRowId(homeNodeId, `reticulum/iface-down/${iface.id}`),
        nodeId: homeNodeId,
        condition: 'reticulum/interface-down',
        cause: `${iface.type} interface "${iface.name}" is enabled but ${iface.status}`,
        severity: 'warning',
        detectedAt: now,
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
      severity: 'info',
      detectedAt: now,
    });
  }

  return rows;
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
