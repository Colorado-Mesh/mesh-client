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
  }[];
}

/** Build Reticulum-native diagnostic rows (interface/path/LXMF — not LoRa RF). */
export function buildReticulumDiagnosticRows(
  snapshot: ReticulumDiagnosticsSnapshot,
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

  for (const iface of snapshot.interfaces ?? []) {
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
