/**
 * Canonical rnsd interface modes (Reticulum / rsReticulum `InterfaceMode`).
 * Keep in sync with `INTERFACE_MODES` / `normalize_interface_mode` /
 * `default_mode_for_iface_type` in `reticulum-sidecar/src/stack/config.rs`.
 */
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

/** Live stats Debug names (`format!("{:?}", InterfaceMode)`) → canonical. */
function liveStatsModeAlias(raw: string): ReticulumInterfaceMode | null {
  switch (raw) {
    case 'Full':
      return 'full';
    case 'AccessPoint':
      return 'access_point';
    case 'PointToPoint':
      return 'point_to_point';
    case 'Roaming':
      return 'roaming';
    case 'Boundary':
      return 'boundary';
    case 'Gateway':
      return 'gateway';
    default:
      return null;
  }
}

/** Recommended hub / outbound-boundary mode. */
export const RETICULUM_HUB_INTERFACE_MODE: ReticulumInterfaceMode = 'boundary';

/**
 * Normalize a config / API mode string to a canonical rnsd value.
 * Accepts shorthands `ap` → `access_point`, `gw` → `gateway`, and live-stats
 * Debug names (`AccessPoint`, `Full`, …).
 * Empty / whitespace returns null; unknown values return null.
 */
export function normalizeReticulumInterfaceMode(
  raw: string | null | undefined,
): ReticulumInterfaceMode | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const fromLive = liveStatsModeAlias(trimmed);
  if (fromLive != null) {
    return fromLive;
  }
  const lower = trimmed.toLowerCase();
  const canonical = lower === 'ap' ? 'access_point' : lower === 'gw' ? 'gateway' : lower;
  return MODE_SET.has(canonical) ? (canonical as ReticulumInterfaceMode) : null;
}

/**
 * True when configured `mode` and live `runtime_mode` both normalize and differ.
 * Missing `runtime_mode` (offline / unknown) → false (no effective-mode badge).
 */
export function reticulumInterfaceModesDiverge(
  configuredMode: string | null | undefined,
  runtimeMode: string | null | undefined,
): boolean {
  const runtime = normalizeReticulumInterfaceMode(runtimeMode);
  if (runtime == null) return false;
  const configured = normalizeReticulumInterfaceMode(configuredMode);
  if (configured == null) return false;
  return configured !== runtime;
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
