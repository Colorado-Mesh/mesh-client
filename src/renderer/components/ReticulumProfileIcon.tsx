import { Heart, Shield, Star, Users } from 'lucide-react-motion';

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
}

/** Empty outline placeholder when no custom avatar is set (suggests click-to-set). */
export function ReticulumProfileIconUnset({
  className = '',
  size = 16,
}: Readonly<ReticulumProfileIconUnsetProps>) {
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
}

export function ReticulumProfileIcon({
  iconName,
  iconColor,
  className = '',
  size = 16,
}: Readonly<ReticulumProfileIconProps>) {
  const name = resolveReticulumProfileIconName(iconName);
  if (name === 'circle') {
    return <ReticulumProfileIconUnset className={className} size={size} />;
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

/** Custom icon when set; otherwise empty outline placeholder. */
export function ReticulumProfileIconSlot({
  iconName,
  iconColor,
  className = '',
  size = 16,
}: Readonly<ReticulumProfileIconProps>) {
  if (!hasCustomReticulumProfileIcon(iconName, iconColor)) {
    return <ReticulumProfileIconUnset className={className} size={size} />;
  }
  return (
    <ReticulumProfileIcon
      iconName={iconName}
      iconColor={iconColor}
      className={className}
      size={size}
    />
  );
}
