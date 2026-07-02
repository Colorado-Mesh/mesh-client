import { useTranslation } from 'react-i18next';

const ROTATION_LABEL_KEYS = {
  0: 'flasher.rotation0',
  1: 'flasher.rotation90',
  2: 'flasher.rotation180',
  3: 'flasher.rotation270',
} as const;

export interface DisplayCanvasProps {
  disabled?: boolean;
  imageDataUrl: string | null;
  onReadDisplay: () => void;
  onSetRotation: (rotation: 0 | 1 | 2 | 3) => void;
  onRecondition: () => void;
}

export function DisplayCanvas({
  disabled,
  imageDataUrl,
  onReadDisplay,
  onSetRotation,
  onRecondition,
}: DisplayCanvasProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2 rounded border border-gray-700 bg-slate-900/40 p-3">
      <h4 className="text-sm font-medium text-gray-200">{t('flasher.displayTitle')}</h4>
      <p className="text-xs text-gray-400">{t('flasher.displayHint')}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          aria-label={t('flasher.readDisplay')}
          onClick={onReadDisplay}
          className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
        >
          {t('flasher.readDisplay')}
        </button>
        {([0, 1, 2, 3] as const).map((rotation) => (
          <button
            key={rotation}
            type="button"
            disabled={disabled}
            aria-label={t(ROTATION_LABEL_KEYS[rotation])}
            onClick={() => {
              onSetRotation(rotation);
            }}
            className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
          >
            {t(ROTATION_LABEL_KEYS[rotation])}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          aria-label={t('flasher.reconditionDisplay')}
          onClick={onRecondition}
          className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
        >
          {t('flasher.reconditionDisplay')}
        </button>
      </div>
      {imageDataUrl ? (
        <img src={imageDataUrl} alt="" className="h-28 rounded border border-gray-700" />
      ) : null}
    </div>
  );
}
