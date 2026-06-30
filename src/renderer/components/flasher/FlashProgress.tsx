import { useTranslation } from 'react-i18next';

export interface FlashProgressProps {
  active: boolean;
  progress: number;
  syncing?: boolean;
}

export function FlashProgress({ active, progress, syncing = false }: FlashProgressProps) {
  const { t } = useTranslation();

  if (!active) return null;

  const label = syncing ? t('flasher.esp32Syncing') : t('flasher.flashing', { progress });

  return (
    <div className="space-y-1">
      <p className="text-xs text-amber-300">{label}</p>
      <div
        className="h-2 overflow-hidden rounded bg-slate-800"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        aria-busy={syncing}
      >
        <div
          className="h-full bg-amber-600 transition-all"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>
    </div>
  );
}
