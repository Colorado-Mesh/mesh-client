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
    <div className="border-ink-700 bg-ink-900/40 space-y-2 rounded border p-3">
      <h4 className="text-ink-200 text-sm font-medium">{t('flasher.displayTitle')}</h4>
      <p className="text-ink-400 text-xs">{t('flasher.displayHint')}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          aria-label={t('flasher.readDisplay')}
          onClick={onReadDisplay}
          className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded border px-2 py-1 text-xs disabled:opacity-40"
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
            className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded border px-2 py-1 text-xs disabled:opacity-40"
          >
            {t(ROTATION_LABEL_KEYS[rotation])}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          aria-label={t('flasher.reconditionDisplay')}
          onClick={onRecondition}
          className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded border px-2 py-1 text-xs disabled:opacity-40"
        >
          {t('flasher.reconditionDisplay')}
        </button>
      </div>
      {imageDataUrl ? (
        <img src={imageDataUrl} alt="" className="border-ink-700 h-28 rounded border" />
      ) : null}
    </div>
  );
}
