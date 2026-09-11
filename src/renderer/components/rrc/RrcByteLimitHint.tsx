import { useTranslation } from 'react-i18next';

import { computeRrcByteLimitStatus, type RrcByteLimitStatus } from '@/renderer/lib/rrcHubLimits';

/** Right-aligned UTF-8 byte counter for RRC nick / room-name fields. */
export function RrcByteLimitHint({
  text,
  limit,
  overMaxKey,
}: {
  text: string;
  limit: number | null | undefined;
  /** i18n key when over max (receives `{ limit }`). */
  overMaxKey: string;
}) {
  const { t } = useTranslation();
  const status: RrcByteLimitStatus | null = computeRrcByteLimitStatus(text, limit);
  if (!status || status.phase === 'ok') return null;

  const color =
    status.phase === 'overMax'
      ? 'text-red-400'
      : status.byteCount >= status.limit
        ? 'text-amber-400'
        : 'text-muted';

  return (
    <div className={`mt-0.5 text-right text-[10px] ${color}`} role="status">
      {status.phase === 'overMax'
        ? t(overMaxKey, { limit: status.limit })
        : t('rrc.byteLimit.approaching', { count: status.byteCount, limit: status.limit })}
    </div>
  );
}

export function isRrcByteLimitOverMax(text: string, limit: number | null | undefined): boolean {
  return computeRrcByteLimitStatus(text, limit)?.phase === 'overMax';
}
