import { Heart, Shield, Star, Users } from 'lucide-react-motion';
import { useMemo } from 'react';

import { lxmface, normalizeLxmfaceSeed } from '@/renderer/lib/reticulum/lxmface';
import {
  hasCustomReticulumProfileIcon,
  resolveReticulumProfileIconName,
  reticulumIconColorClass,
} from '@/renderer/lib/reticulum/reticulumIconAppearance';

/** Stored / wire names including legacy `circle` (unset). */
export const RETICULUM_PROFILE_ICON_NAMES = ['circle', 'star', 'heart', 'shield', 'user'] as const;

/** Icons offered in the peer detail picker (excludes unset/`circle`). */
export const RETICULUM_PROFILE_ICON_PICKER_NAMES = ['star', 'heart', 'shield', 'user'] as const;

export type ReticulumProfileIconName = (typeof RETICULUM_PROFILE_ICON_NAMES)[number];

export type ReticulumProfileIconPickerName = (typeof RETICULUM_PROFILE_ICON_PICKER_NAMES)[number];

export function isReticulumProfileIconName(
  value: string | null | undefined,
): value is ReticulumProfileIconName {
  return (
    typeof value === 'string' && (RETICULUM_PROFILE_ICON_NAMES as readonly string[]).includes(value)
  );
}

const ICON_MAP = {
  star: Star,
  heart: Heart,
  shield: Shield,
  user: Users,
} as const;

export { hasCustomReticulumProfileIcon };

export interface ReticulumProfileIconUnsetProps {
  className?: string;
  size?: number;
  /** When set to a valid 32-hex destination, render LXMFace instead of the dashed placeholder. */
  destinationHash?: string | null;
}

/** LXMFace (or dashed outline) when no custom Lucide avatar is set. */
export function ReticulumProfileIconUnset({
  className = '',
  size = 16,
  destinationHash,
}: Readonly<ReticulumProfileIconUnsetProps>) {
  const seed = normalizeLxmfaceSeed(destinationHash);
  const src = useMemo(() => {
    if (!seed) return null;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(lxmface(seed, size))}`;
  }, [seed, size]);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className={`inline-block shrink-0 rounded-full ${className}`}
        draggable={false}
        aria-hidden
      />
    );
  }
  return (
    <span
      className={`inline-block shrink-0 rounded-full border border-dashed border-gray-500 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}

export interface ReticulumProfileIconProps {
  iconName?: string | null;
  iconColor?: string | null;
  className?: string;
  size?: number;
  destinationHash?: string | null;
}

export function ReticulumProfileIcon({
  iconName,
  iconColor,
  className = '',
  size = 16,
  destinationHash,
}: Readonly<ReticulumProfileIconProps>) {
  const name = resolveReticulumProfileIconName(iconName);
  if (name === 'circle') {
    return (
      <ReticulumProfileIconUnset
        className={className}
        size={size}
        destinationHash={destinationHash}
      />
    );
  }
  const Icon = ICON_MAP[name];
  return (
    <Icon
      className={`shrink-0 ${reticulumIconColorClass(iconColor)} ${className}`}
      width={size}
      height={size}
      aria-hidden
    />
  );
}

/** Custom Lucide icon when set; otherwise LXMFace from destination hash (or dashed placeholder). */
export function ReticulumProfileIconSlot({
  iconName,
  iconColor,
  className = '',
  size = 16,
  destinationHash,
}: Readonly<ReticulumProfileIconProps>) {
  if (!hasCustomReticulumProfileIcon(iconName, iconColor)) {
    return (
      <ReticulumProfileIconUnset
        className={className}
        size={size}
        destinationHash={destinationHash}
      />
    );
  }
  return (
    <ReticulumProfileIcon
      iconName={iconName}
      iconColor={iconColor}
      className={className}
      size={size}
      destinationHash={destinationHash}
    />
  );
}
