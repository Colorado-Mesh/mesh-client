import { useTranslation } from 'react-i18next';

import { RETICULUM_SYSTEM_RNS_DOCS_URL } from '@/renderer/lib/reticulum/reticulumInstanceStatus';

export interface ReticulumSystemRnsExplainerProps {
  className?: string;
}

/**
 * Shared "why mesh-client does not use another app's Reticulum" copy. Every notice about a
 * system rnsd or shared-instance conflict renders this so the reason never drifts.
 */
export function ReticulumSystemRnsExplainer({ className }: ReticulumSystemRnsExplainerProps) {
  const { t } = useTranslation();
  return (
    <div className={className ?? 'text-muted text-label mt-1 space-y-1'}>
      <p>{t('reticulum.systemRns.whyNotSupported')}</p>
      <p>
        {t('reticulum.systemRns.reverseHint')}{' '}
        <a
          href={RETICULUM_SYSTEM_RNS_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="text-bright-green underline-offset-2 hover:underline"
          aria-label={t('reticulum.systemRns.learnMoreAria')}
        >
          {t('reticulum.systemRns.learnMore')}
        </a>
      </p>
    </div>
  );
}
