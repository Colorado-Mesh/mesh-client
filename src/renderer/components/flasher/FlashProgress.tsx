import { useTranslation } from 'react-i18next';

export interface FlashProgressProps {
  active: boolean;
  progress: number;
  syncing?: boolean;
  /** Overrides the default "Flashing… N%" label once syncing completes. */
  label?: string;
}

export function FlashProgress({
  active,
  progress,
  syncing = false,
  label: progressLabel,
}: FlashProgressProps) {
  const { t } = useTranslation();

  if (!active) return null;

  const label = syncing
    ? t('flasher.esp32Syncing')
    : (progressLabel ?? t('flasher.flashing', { progress }));

  return (
    <div className="space-y-1">
      <p className="text-xs text-orange-300">{label}</p>
      <div
        className="bg-ink-800 h-2 overflow-hidden rounded"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        aria-busy={syncing}
      >
        <div
          className="h-full bg-orange-600 transition-all"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>
    </div>
  );
}
