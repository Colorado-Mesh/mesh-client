import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface QrCodeImageProps {
  value: string;
  size?: number;
  className?: string;
  /** Accessible label for the QR image. */
  ariaLabel?: string;
}

interface QrRenderResult {
  key: string;
  dataUrl: string | null;
  error: boolean;
}

/** Render a QR code as a data-URL image (pure JS; all desktop arches). */
export default function QrCodeImage({ value, size = 180, className, ariaLabel }: QrCodeImageProps) {
  const { t } = useTranslation();
  const requestKey = `${size}:${value}`;
  const [result, setResult] = useState<QrRenderResult>({
    key: '',
    dataUrl: null,
    error: false,
  });

  useEffect(() => {
    let cancelled = false;
    if (!value) return undefined;
    void QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (!cancelled) {
          setResult({ key: requestKey, dataUrl: url, error: false });
        }
      })
      .catch((err: unknown) => {
        console.warn('[QrCodeImage] encode failed', err);
        if (!cancelled) {
          setResult({ key: requestKey, dataUrl: null, error: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey, size, value]);

  if (result.key === requestKey && result.error) {
    return (
      <p className="text-xs text-red-400" role="alert">
        {t('qrIngest.encodeFailed')}
      </p>
    );
  }
  if (result.key !== requestKey || !result.dataUrl) {
    return (
      <div className="bg-secondary-dark h-[180px] w-[180px] animate-pulse rounded" aria-hidden />
    );
  }
  return (
    <img
      src={result.dataUrl}
      width={size}
      height={size}
      alt={ariaLabel ?? t('qrIngest.qrImageAlt')}
      className={className ?? 'rounded bg-white p-1'}
    />
  );
}
