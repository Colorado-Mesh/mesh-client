import { LockOpen } from 'lucide-react-motion';
import { useTranslation } from 'react-i18next';

import {
  channelSecurityBadgeKinds,
  type ChannelSecurityInput,
} from '@/renderer/lib/channelSecurityBadges';
import { useIconTrigger } from '@/renderer/lib/icons/iconMotionContext';

export interface ChannelSecurityBadgesProps {
  channel: ChannelSecurityInput;
  /** Prefix for aria-labels (channel name). */
  channelName: string;
}

const BADGE_CLASS =
  'rounded-badge text-2xs inline-flex items-center px-1 py-0.5 font-medium leading-none';

/** Accessible Meshtastic channel security chips for WrappingChannelList pills. */
export function ChannelSecurityBadges({ channel, channelName }: ChannelSecurityBadgesProps) {
  const { t } = useTranslation();
  const iconTrigger = useIconTrigger();
  const kinds = channelSecurityBadgeKinds(channel);
  if (kinds.length === 0) return null;
  return (
    <span
      className="inline-flex max-w-full flex-wrap items-center gap-0.5"
      data-testid="channel-security-badges"
    >
      {kinds.map((kind) => {
        const label = t(`channelSecurityBadges.${kind}`, { channel: channelName });
        const tone =
          kind === 'pskAes256'
            ? 'bg-green-800 text-white'
            : kind === 'pskAes128'
              ? 'bg-ink-700 text-ink-100'
              : kind === 'mqttUplink' || kind === 'preciseLocation'
                ? 'bg-orange-800 text-white'
                : 'bg-red-700 text-white';
        return (
          <span key={kind} className={`${BADGE_CLASS} ${tone}`} aria-label={label} title={label}>
            {kind === 'pskWeak' ? (
              <LockOpen aria-hidden className="h-3 w-3" trigger={iconTrigger} size={12} />
            ) : (
              t(`channelSecurityBadges.${kind}Short`)
            )}
          </span>
        );
      })}
    </span>
  );
}
