import {
  isReticulumProfileIconName,
  type ReticulumProfileIconName,
} from '@/renderer/components/ReticulumProfileIcon';

export type ReticulumProfileIconColor = 'green' | 'cyan' | 'amber' | 'red' | 'purple';

export interface ReticulumIconAppearanceWire {
  icon_name?: string;
  foreground_rgb?: [number, number, number];
  background_rgb?: [number, number, number];
}

const PALETTE_RGB: Record<ReticulumProfileIconColor, [number, number, number]> = {
  green: [74, 222, 128],
  cyan: [34, 211, 238],
  amber: [251, 191, 36],
  red: [248, 113, 113],
  purple: [192, 132, 252],
};

export function reticulumIconColorClass(color: string | null | undefined): string {
  switch (color?.toLowerCase()) {
    case 'cyan':
      return 'text-cyan-400';
    case 'amber':
      return 'text-orange-400';
    case 'red':
      return 'text-red-400';
    case 'purple':
      return 'text-purple-400';
    default:
      return 'text-green-400';
  }
}

function rgbTriplet(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const rgb: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- External SDK value is validated by surrounding boundary logic.
    const part = value[i];
    if (typeof part !== 'number' || !Number.isFinite(part)) return null;
    rgb.push(Math.min(255, Math.max(0, Math.trunc(part))));
  }
  return [rgb[0], rgb[1], rgb[2]];
}

/** Map LXMF foreground RGB to the peer-list color palette. */
export function mapRgbToReticulumIconColor(
  rgb: [number, number, number],
): ReticulumProfileIconColor {
  let best: ReticulumProfileIconColor = 'green';
  let bestDist = Number.POSITIVE_INFINITY;
  for (const [name, ref] of Object.entries(PALETTE_RGB) as [
    ReticulumProfileIconColor,
    [number, number, number],
  ][]) {
    const dist = (rgb[0] - ref[0]) ** 2 + (rgb[1] - ref[1]) ** 2 + (rgb[2] - ref[2]) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }
  return best;
}

/**
 * True when stored appearance is unset (missing, legacy `circle`, or MeshChat
 * default / unknown Material icons that should not override LXMFace).
 * Color is ignored — Circle is no longer a real avatar choice.
 */
export function isDefaultReticulumProfileIcon(
  iconName?: string | null,
  // Color ignored; retained so existing call sites stay type-compatible.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- API compatibility
  iconColor?: string | null,
): boolean {
  return resolveReticulumProfileIconName(iconName) === 'circle';
}

export function hasCustomReticulumProfileIcon(
  iconName?: string | null,
  iconColor?: string | null,
): boolean {
  return !isDefaultReticulumProfileIcon(iconName, iconColor);
}

/**
 * Map Material symbol names (MeshChat / LXMF wire) to supported Lucide badges.
 * Only star / heart / shield / exact `user` (our People picker) override LXMFace.
 * MeshChat’s default person/account icons and unknown symbols resolve to unset
 * (`circle`) so the generated face stays the peer’s visual identity.
 */
const STAR_WIRE_ALIASES = new Set(['star', 'grade', 'star_rate', 'star_outline', 'star_border']);
const HEART_WIRE_ALIASES = new Set(['heart', 'favorite', 'favorite_border', 'favorite_outline']);
const SHIELD_WIRE_ALIASES = new Set(['shield', 'security', 'verified_user', 'gpp_good']);

export function resolveReticulumProfileIconName(
  iconName?: string | null,
): ReticulumProfileIconName {
  if (isReticulumProfileIconName(iconName)) return iconName;
  const wire = iconName?.trim().toLowerCase();
  if (!wire || wire === 'circle') return 'circle';
  if (STAR_WIRE_ALIASES.has(wire)) return 'star';
  if (HEART_WIRE_ALIASES.has(wire)) return 'heart';
  if (SHIELD_WIRE_ALIASES.has(wire)) return 'shield';
  // person / people / account / hiking / custom_* containing a token / anything else → LXMFace
  return 'circle';
}

export function parseReticulumIconAppearanceWire(
  wire: ReticulumIconAppearanceWire | null | undefined,
): { icon_name: string; icon_color: ReticulumProfileIconColor } | null {
  const iconName = wire?.icon_name?.trim();
  if (!iconName) return null;
  const rgb = rgbTriplet(wire?.foreground_rgb);
  if (!rgb) return null;
  return {
    icon_name: iconName.slice(0, 64),
    icon_color: mapRgbToReticulumIconColor(rgb),
  };
}

export function parseReticulumIconAppearanceFromPayload(payload: {
  icon_appearance?: ReticulumIconAppearanceWire | null;
}): { icon_name: string; icon_color: ReticulumProfileIconColor } | null {
  return parseReticulumIconAppearanceWire(payload.icon_appearance);
}
