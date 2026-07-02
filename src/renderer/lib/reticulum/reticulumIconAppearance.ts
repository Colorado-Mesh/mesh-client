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
      return 'text-amber-400';
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

/** True when stored appearance matches the implicit default (circle + green). */
export function isDefaultReticulumProfileIcon(
  iconName?: string | null,
  iconColor?: string | null,
): boolean {
  const name = iconName?.trim().toLowerCase() || 'circle';
  const color = iconColor?.trim().toLowerCase() || 'green';
  return name === 'circle' && color === 'green';
}

export function hasCustomReticulumProfileIcon(
  iconName?: string | null,
  iconColor?: string | null,
): boolean {
  return !isDefaultReticulumProfileIcon(iconName, iconColor);
}

/** Map Material symbol names (MeshChat / LXMF wire) to supported Lucide badges. */
export function resolveReticulumProfileIconName(
  iconName?: string | null,
): ReticulumProfileIconName {
  if (isReticulumProfileIconName(iconName)) return iconName;
  const wire = iconName?.trim().toLowerCase();
  if (!wire || wire === 'circle') return 'circle';
  if (wire.includes('star') || wire.includes('grade')) return 'star';
  if (wire.includes('heart') || wire.includes('favorite')) return 'heart';
  if (wire.includes('shield') || wire.includes('security')) return 'shield';
  if (wire.includes('person') || wire.includes('account') || wire === 'user') return 'user';
  return 'user';
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
