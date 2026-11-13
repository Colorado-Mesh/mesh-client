import { Lock, LockOpen, TriangleAlert } from 'lucide-react-motion';

import {
  type ChannelSecurityInput,
  channelSecurityLevel,
} from '@/renderer/lib/channelSecurityBadges';
import { useIconTrigger } from '@/renderer/lib/icons/iconMotionContext';

export interface ChannelSecurityBadgesProps {
  channel: ChannelSecurityInput;
  /** Accessible name / tooltip (caller supplies i18n). */
  label: string;
  /** Icon pixel size (chat pills use 12; Radio rows use 14). */
  size?: 12 | 14;
}

/** Official Meshtastic-style composite channel security lock for chat pills and Radio rows. */
export function ChannelSecurityBadges({ channel, label, size = 12 }: ChannelSecurityBadgesProps) {
  const iconTrigger = useIconTrigger();
  const level = channelSecurityLevel(channel);
  const iconClass = size === 14 ? 'h-3.5 w-3.5' : 'h-3 w-3';
  const iconProps = {
    'aria-hidden': true as const,
    trigger: iconTrigger,
    size,
  };

  if (level === 'encrypted') {
    return (
      <span
        className="inline-flex shrink-0 items-center text-green-400"
        aria-label={label}
        title={label}
        data-testid="channel-security-badges"
        data-security-level={level}
      >
        <Lock {...iconProps} className={iconClass} />
      </span>
    );
  }

  const tone = level === 'open' ? 'text-orange-400' : 'text-red-400';
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 ${tone}`}
      aria-label={label}
      title={label}
      data-testid="channel-security-badges"
      data-security-level={level}
    >
      <LockOpen {...iconProps} className={iconClass} />
      {level === 'open-location-uplink' ? (
        <TriangleAlert {...iconProps} className={`${iconClass} text-red-400`} />
      ) : null}
    </span>
  );
}
