import { Circle, Heart, Shield, Star, User } from 'lucide-react-motion';

import {
  hasCustomReticulumProfileIcon,
  resolveReticulumProfileIconName,
  reticulumIconColorClass,
} from '@/renderer/lib/reticulum/reticulumIconAppearance';

export const RETICULUM_PROFILE_ICON_NAMES = ['circle', 'star', 'heart', 'shield', 'user'] as const;

export type ReticulumProfileIconName = (typeof RETICULUM_PROFILE_ICON_NAMES)[number];

export function isReticulumProfileIconName(
  value: string | null | undefined,
): value is ReticulumProfileIconName {
  return (
    typeof value === 'string' && (RETICULUM_PROFILE_ICON_NAMES as readonly string[]).includes(value)
  );
}

const ICON_MAP = {
  circle: Circle,
  star: Star,
  heart: Heart,
  shield: Shield,
  user: User,
} as const;

export { hasCustomReticulumProfileIcon };

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
}: ReticulumProfileIconProps) {
  const name = resolveReticulumProfileIconName(iconName);
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
