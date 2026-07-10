import { reticulumIfaceTypeLabel } from '@/renderer/lib/reticulum/reticulumInterfaceLabels';

export interface DeriveReticulumInterfaceNameInput {
  ifaceType: string;
  rnodeDeviceName?: string | null;
  serialPort?: string;
  serialPorts?: readonly { path: string; label?: string }[];
}

/** Sanitize a user- or device-derived name for Reticulum config `[[section]]` headers. */
export function sanitizeReticulumInterfaceName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  return trimmed.replace(/[[\]#;]/g, '').slice(0, 64);
}

export function isReticulumRnodeCallsignType(ifaceType: string): boolean {
  return ifaceType === 'rnode' || ifaceType === 'rnode_multi';
}

/** Derive a display/config name from the RNode device label or interface type. */
export function deriveReticulumInterfaceName(input: DeriveReticulumInterfaceNameInput): string {
  const isRnodeLike =
    input.ifaceType === 'rnode' || input.ifaceType === 'rnode_multi' || input.ifaceType === 'kiss';

  if (isRnodeLike) {
    const fromDevice = input.rnodeDeviceName?.trim();
    if (fromDevice) {
      const sanitized = sanitizeReticulumInterfaceName(fromDevice);
      if (sanitized) return sanitized;
    }
    const port = input.serialPort?.trim();
    if (port) {
      const match = input.serialPorts?.find((p) => p.path === port);
      const label = match?.label?.trim() || port;
      const sanitized = sanitizeReticulumInterfaceName(label);
      if (sanitized) return sanitized;
    }
    return sanitizeReticulumInterfaceName(reticulumIfaceTypeLabel(input.ifaceType));
  }

  return sanitizeReticulumInterfaceName(reticulumIfaceTypeLabel(input.ifaceType));
}
