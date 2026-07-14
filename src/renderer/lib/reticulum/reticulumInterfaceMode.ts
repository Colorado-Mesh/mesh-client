/** Canonical rnsd interface modes (Reticulum / rsReticulum `InterfaceMode`). */
export const RETICULUM_INTERFACE_MODES = [
  'full',
  'point_to_point',
  'access_point',
  'roaming',
  'boundary',
  'gateway',
] as const;

export type ReticulumInterfaceMode = (typeof RETICULUM_INTERFACE_MODES)[number];

const MODE_SET = new Set<string>(RETICULUM_INTERFACE_MODES);

/** Recommended hub / outbound-boundary mode. */
export const RETICULUM_HUB_INTERFACE_MODE: ReticulumInterfaceMode = 'boundary';

/**
 * Normalize a config / API mode string to a canonical rnsd value.
 * Accepts shorthands `ap` → `access_point`, `gw` → `gateway`.
 * Empty / whitespace returns null; unknown values return null.
 */
export function normalizeReticulumInterfaceMode(
  raw: string | null | undefined,
): ReticulumInterfaceMode | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const canonical = lower === 'ap' ? 'access_point' : lower === 'gw' ? 'gateway' : lower;
  return MODE_SET.has(canonical) ? (canonical as ReticulumInterfaceMode) : null;
}

/** Recommended default when adding an interface with no explicit mode. */
export function defaultModeForIfaceType(ifaceType: string): ReticulumInterfaceMode | null {
  switch (ifaceType) {
    case 'tcp':
    case 'i2p':
    case 'udp':
      return 'boundary';
    case 'rnode':
    case 'rnode_multi':
      return 'access_point';
    default:
      return null;
  }
}

/** i18n key for a mode option label (`connectionPanel.reticulumInterfaces.modeOption.*`). */
export function reticulumInterfaceModeLabelKey(mode: ReticulumInterfaceMode): string {
  return `connectionPanel.reticulumInterfaces.modeOption.${mode}`;
}
