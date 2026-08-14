import { useTranslation } from 'react-i18next';

import { HelpTooltip } from './HelpTooltip';

export interface ReticulumTxBufferingHeaderIndicatorProps {
  buffering: boolean;
  interfaceName?: string | null;
}

/** Amber spinner when Reticulum host TX is buffering outbound to a local RNode. */
export function ReticulumTxBufferingHeaderIndicator({
  buffering,
  interfaceName,
}: ReticulumTxBufferingHeaderIndicatorProps) {
  const { t } = useTranslation();
  if (!buffering) return null;

  const statusText = interfaceName?.trim()
    ? t('app.reticulumTxBufferingNamed', { name: interfaceName })
    : t('app.reticulumTxBuffering');

  return (
    <HelpTooltip text={statusText} className="shrink-0">
      <span
        role="status"
        aria-live="polite"
        aria-busy
        aria-label={statusText}
        className="inline-flex items-center"
      >
        <span
          className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-amber-400 border-t-transparent"
          aria-hidden
        />
      </span>
    </HelpTooltip>
  );
}
