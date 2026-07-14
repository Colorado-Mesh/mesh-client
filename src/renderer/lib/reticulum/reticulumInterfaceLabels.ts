import type { TFunction } from 'i18next';

import {
  normalizeReticulumInterfaceMode,
  reticulumInterfaceModeLabelKey,
} from '@/renderer/lib/reticulum/reticulumInterfaceMode';

/** Display acronyms for Reticulum interface wire types — not passed through auto-translate. */
export const RETICULUM_IFACE_TYPE_LABELS: Record<string, string> = {
  tcp: 'TCP',
  udp: 'UDP',
  auto: 'Auto',
  rnode: 'RNode',
  rnode_multi: 'RNode Multi',
  kiss: 'KISS',
  pipe: 'Pipe',
  i2p: 'I2P',
  ble_peer: 'BLE Peer',
};

export function reticulumIfaceTypeLabel(type: string): string {
  return RETICULUM_IFACE_TYPE_LABELS[type] ?? type;
}

export function reticulumIfaceStatusKey(status: string): string {
  return `connectionPanel.reticulumInterfaces.status.${status}`;
}

export function formatReticulumInterfaceRowSummary(
  t: TFunction,
  iface: { name: string; type: string; status: string; mode?: string | null },
): string {
  const statusKey = reticulumIfaceStatusKey(iface.status);
  const statusLabel = t(statusKey, { defaultValue: iface.status });
  const typeLabel = reticulumIfaceTypeLabel(iface.type);
  const mode = normalizeReticulumInterfaceMode(iface.mode);
  if (mode) {
    return t('connectionPanel.reticulumInterfaces.rowSummaryWithMode', {
      name: iface.name,
      type: typeLabel,
      mode: t(reticulumInterfaceModeLabelKey(mode)),
      status: statusLabel,
    });
  }
  return t('connectionPanel.reticulumInterfaces.rowSummary', {
    name: iface.name,
    type: typeLabel,
    status: statusLabel,
  });
}
