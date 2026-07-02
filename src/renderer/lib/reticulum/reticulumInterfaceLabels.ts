import type { TFunction } from 'i18next';

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
  iface: { name: string; type: string; status: string },
): string {
  const statusKey = reticulumIfaceStatusKey(iface.status);
  const statusLabel = t(statusKey, { defaultValue: iface.status });
  return t('connectionPanel.reticulumInterfaces.rowSummary', {
    name: iface.name,
    type: reticulumIfaceTypeLabel(iface.type),
    status: statusLabel,
  });
}
