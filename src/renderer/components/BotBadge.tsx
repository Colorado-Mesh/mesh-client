import { Bot } from 'lucide-react-motion';
import { useTranslation } from 'react-i18next';

/** Small pill marking a sender/node whose messages matched a known bot reply template. */
export function BotBadge({ className = '' }: Readonly<{ className?: string }>) {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      aria-label={t('common.botBadgeLabel')}
      title={t('common.botBadgeTooltip')}
      className={`bg-ink-800 text-ink-200 text-label inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-px font-medium ${className}`}
      data-testid="bot-badge"
    >
      <Bot aria-hidden className="h-3 w-3" />
      {t('common.botBadge')}
    </span>
  );
}
