import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isValidXmodemRemoteFilename } from '@/renderer/lib/meshtastic/xmodemFilename';
import type { ConfigTargetContext } from '@/renderer/lib/types';

import { useToast } from './Toast';

interface Props {
  configTarget?: ConfigTargetContext;
  isConnected: boolean;
  onXmodemUpload?: () => Promise<void>;
  onXmodemDownload?: (filename: string) => Promise<void>;
}

/** Meshtastic local-radio XMODEM file transfer (Radio tab). */
export function RadioXmodemSection({
  configTarget,
  isConnected,
  onXmodemUpload,
  onXmodemDownload,
}: Props) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const [xmodemFilename, setXmodemFilename] = useState('config.txt');
  const [xmodemBusy, setXmodemBusy] = useState(false);

  const localOnlyDisabled = !isConnected || configTarget?.mode === 'remote';
  if (!onXmodemUpload && !onXmodemDownload) return null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-blue-300/80">{t('radioPanel.xmodemSectionHint')}</p>
      <div className="space-y-1">
        <label htmlFor="radio-xmodem-filename" className="text-muted text-sm">
          {t('radioPanel.xmodemFilenameLabel')}
        </label>
        <input
          id="radio-xmodem-filename"
          type="text"
          value={xmodemFilename}
          onChange={(e) => {
            setXmodemFilename(e.target.value);
          }}
          disabled={localOnlyDisabled || xmodemBusy}
          placeholder={t('radioPanel.xmodemFilenamePlaceholder')}
          className="bg-secondary-dark focus:border-brand-green w-full max-w-md rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 focus:outline-none disabled:opacity-50"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {onXmodemUpload && (
          <button
            type="button"
            disabled={localOnlyDisabled || xmodemBusy}
            onClick={() => {
              setXmodemBusy(true);
              void onXmodemUpload()
                .then(() => {
                  addToast(t('radioPanel.xmodemUploadSuccess', { name: 'file' }), 'success');
                })
                .catch((err: unknown) => {
                  addToast(
                    t('radioPanel.xmodemFailed', {
                      message: err instanceof Error ? err.message : String(err),
                    }),
                    'error',
                  );
                })
                .finally(() => {
                  setXmodemBusy(false);
                });
            }}
            className="rounded-lg border border-blue-800/60 bg-blue-900/30 px-4 py-2 text-sm font-medium text-blue-200 hover:bg-blue-900/50 disabled:opacity-50"
            aria-label={t('radioPanel.xmodemUpload')}
          >
            {t('radioPanel.xmodemUpload')}
          </button>
        )}
        {onXmodemDownload && (
          <button
            type="button"
            disabled={localOnlyDisabled || xmodemBusy || !xmodemFilename.trim()}
            onClick={() => {
              const name = xmodemFilename.trim();
              if (!isValidXmodemRemoteFilename(name)) {
                addToast(t('radioPanel.xmodemInvalidFilename'), 'error');
                return;
              }
              setXmodemBusy(true);
              void onXmodemDownload(name)
                .then(() => {
                  addToast(t('radioPanel.xmodemDownloadSuccess', { name }), 'success');
                })
                .catch((err: unknown) => {
                  addToast(
                    t('radioPanel.xmodemFailed', {
                      message: err instanceof Error ? err.message : String(err),
                    }),
                    'error',
                  );
                })
                .finally(() => {
                  setXmodemBusy(false);
                });
            }}
            className="rounded-lg border border-blue-800/60 bg-blue-900/30 px-4 py-2 text-sm font-medium text-blue-200 hover:bg-blue-900/50 disabled:opacity-50"
            aria-label={t('radioPanel.xmodemDownload')}
          >
            {t('radioPanel.xmodemDownload')}
          </button>
        )}
      </div>
    </div>
  );
}
