import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  buildOfficialFirmwareDownloadUrl,
  resolveLatestOfficialFirmwareDownloadUrl,
  RNODE_FIRMWARE_CE_RELEASES_URL,
  RNODE_FIRMWARE_RELEASES_URL,
  RNODE_TRANSPORT_NODE_RELEASES_URL,
} from '@/renderer/lib/flasher/firmwareDownloadUrls';

export interface FirmwareDownloadLinksProps {
  recommendedFilename?: string | null;
}

export function FirmwareDownloadLinks({ recommendedFilename }: FirmwareDownloadLinksProps) {
  const { t } = useTranslation();
  const fallbackUrl = recommendedFilename
    ? buildOfficialFirmwareDownloadUrl(recommendedFilename)
    : null;
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!recommendedFilename) {
      return undefined;
    }
    let cancelled = false;
    void resolveLatestOfficialFirmwareDownloadUrl(recommendedFilename).then((url) => {
      if (!cancelled) {
        setResolvedUrl(url);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [recommendedFilename]);

  const latestDownloadUrl = recommendedFilename ? (resolvedUrl ?? fallbackUrl) : null;

  return (
    <div className="space-y-2 rounded border border-slate-700/60 bg-slate-900/30 p-2 text-xs text-gray-400">
      <div>
        <span>{t('flasher.downloadFirmware')}</span>
        {recommendedFilename && latestDownloadUrl ? (
          <>
            {': '}
            <a
              href={latestDownloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-green hover:underline"
            >
              {t('flasher.downloadLatestFirmware', { filename: recommendedFilename })}
            </a>
          </>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <a
          href={RNODE_FIRMWARE_RELEASES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-green hover:underline"
        >
          {t('flasher.officialFirmware')}
        </a>
        <span aria-hidden="true">•</span>
        <a
          href={RNODE_FIRMWARE_CE_RELEASES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-green hover:underline"
        >
          {t('flasher.ceFirmware')}
        </a>
        <span aria-hidden="true">•</span>
        <a
          href={RNODE_TRANSPORT_NODE_RELEASES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-green hover:underline"
        >
          {t('flasher.transportNodeFirmware')}
        </a>
      </div>
    </div>
  );
}
