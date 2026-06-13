import { useTranslation } from 'react-i18next';

import { SpinnerIcon } from '@/renderer/lib/icons/spinnerIcon';
import { IconUpToDate, IconWarning } from '@/renderer/lib/icons/statusIcons';

import type { FirmwareCheckResult } from '../lib/firmwareCheck';

interface Props {
  phase: FirmwareCheckResult['phase'];
  latestVersion?: string;
  onOpenReleases: () => void;
}

export default function FirmwareStatusIndicator({ phase, latestVersion, onOpenReleases }: Props) {
  const { t } = useTranslation();
  if (phase === 'idle' || phase === 'error') return null;

  if (phase === 'checking') {
    return (
      <span role="status" aria-label={t('firmwareStatus.checking')}>
        <SpinnerIcon />
      </span>
    );
  }

  if (phase === 'up-to-date') {
    return (
      <span role="img" aria-label={t('firmwareStatus.upToDate')}>
        <IconUpToDate className="text-brand-green h-3 w-3 shrink-0" />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpenReleases}
      className="font-inherit inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[11px] text-amber-400 transition-colors hover:text-amber-300"
      aria-label={
        latestVersion
          ? t('firmwareStatus.updateAvailableVersion', { version: latestVersion })
          : t('firmwareStatus.updateAvailable')
      }
    >
      <IconWarning className="h-3 w-3 shrink-0 text-amber-500" />
      {latestVersion && <span className="tabular-nums">v{latestVersion}</span>}
    </button>
  );
}
