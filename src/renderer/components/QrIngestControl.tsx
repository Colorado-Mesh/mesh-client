import { type ClipboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  decodeQrFromBlob,
  decodeQrFromFile,
  decodeQrFromImageData,
} from '@/renderer/lib/decodeQrFromImageSource';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

export interface QrIngestControlProps {
  /** Decoded QR text — parent owns parse/apply. */
  onDecoded: (text: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Paste image / choose image file / optional camera scan → jsQR decode.
 * Camera absence or permission denial is a localized soft failure.
 */
export default function QrIngestControl({
  onDecoded,
  disabled = false,
  className = '',
}: QrIngestControlProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [starting, setStarting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const onDecodedRef = useRef(onDecoded);
  const startGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    onDecodedRef.current = onDecoded;
  }, [onDecoded]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const stopTracks = useCallback((stream: MediaStream | null) => {
    if (!stream) return;
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const stream = streamRef.current;
    streamRef.current = null;
    stopTracks(stream);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setScanning(false);
    setStarting(false);
  }, [stopTracks]);

  useEffect(() => {
    return () => {
      startGenerationRef.current += 1;
      stopCamera();
    };
  }, [stopCamera]);

  const emitDecoded = useCallback(
    (text: string) => {
      stopCamera();
      setStatus(null);
      onDecodedRef.current(text);
    },
    [stopCamera],
  );

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file || disabled) return;
      try {
        const text = await decodeQrFromFile(file);
        if (!text) {
          setStatus(t('qrIngest.noQrFound'));
          return;
        }
        emitDecoded(text);
      } catch (err) {
        console.warn('[QrIngestControl] file decode failed: ' + errLikeToLogString(err));
        setStatus(t('qrIngest.decodeFailed'));
      }
    },
    [disabled, emitDecoded, t],
  );

  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      if (disabled) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (!item.type.startsWith('image/')) continue;
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        void (async () => {
          try {
            const text = await decodeQrFromBlob(file);
            if (!text) {
              setStatus(t('qrIngest.noQrFound'));
              return;
            }
            emitDecoded(text);
          } catch (err) {
            console.warn('[QrIngestControl] paste decode failed: ' + errLikeToLogString(err));
            setStatus(t('qrIngest.decodeFailed'));
          }
        })();
        return;
      }
    },
    [disabled, emitDecoded, t],
  );

  const startCamera = useCallback(async () => {
    if (disabled || scanning || starting) return;
    setStatus(null);
    setStarting(true);
    const generation = ++startGenerationRef.current;
    try {
      const access = await window.electronAPI?.media?.ensureCameraAccess?.();
      if (generation !== startGenerationRef.current || !mountedRef.current) {
        return;
      }
      if (access && !access.granted) {
        setStatus(t('qrIngest.cameraDenied'));
        setStarting(false);
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus(t('qrIngest.cameraUnavailable'));
        setStarting(false);
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      if (generation !== startGenerationRef.current || !mountedRef.current) {
        // Stale start after unmount/cancel — release tracks immediately.
        stopTracks(stream);
        return;
      }
      // Replace any leftover stream without orphaning tracks.
      stopTracks(streamRef.current);
      streamRef.current = stream;
      setScanning(true);
      setStarting(false);
      const video = videoRef.current;
      if (!video) {
        stopCamera();
        setStatus(t('qrIngest.cameraUnavailable'));
        return;
      }
      video.srcObject = stream;
      await video.play();
      if (generation !== startGenerationRef.current || !mountedRef.current) {
        stopCamera();
        return;
      }

      const canvas = document.createElement('canvas');
      let lastScanAt = 0;
      const SCAN_MIN_INTERVAL_MS = 200;
      const tick = () => {
        if (generation !== startGenerationRef.current) return;
        const v = videoRef.current;
        if (!v || v.readyState < 2) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        const now = performance.now();
        if (now - lastScanAt < SCAN_MIN_INTERVAL_MS) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        lastScanAt = now;
        // Cap decode resolution to limit CPU/memory on high-res cameras.
        const maxDim = 960;
        const srcW = v.videoWidth;
        const srcH = v.videoHeight;
        if (srcW < 2 || srcH < 2) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
        canvas.width = Math.max(2, Math.floor(srcW * scale));
        canvas.height = Math.max(2, Math.floor(srcH * scale));
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const text = decodeQrFromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
        if (text) {
          emitDecoded(text);
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      if (generation !== startGenerationRef.current || !mountedRef.current) {
        return;
      }
      console.warn('[QrIngestControl] camera start failed: ' + errLikeToLogString(err));
      stopCamera();
      setStatus(t('qrIngest.cameraUnavailable'));
    }
  }, [disabled, emitDecoded, scanning, starting, stopCamera, stopTracks, t]);

  return (
    <div className={`space-y-2 ${className}`} onPaste={handlePaste}>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-slate-800 disabled:opacity-40"
          aria-label={t('qrIngest.chooseImageAria')}
          onClick={() => fileInputRef.current?.click()}
        >
          {t('qrIngest.chooseImage')}
        </button>
        <button
          type="button"
          disabled={disabled || scanning || starting}
          className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-slate-800 disabled:opacity-40"
          aria-label={t('qrIngest.scanCameraAria')}
          onClick={() => {
            void startCamera();
          }}
        >
          {t('qrIngest.scanCamera')}
        </button>
        {scanning ? (
          <button
            type="button"
            className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-slate-800"
            aria-label={t('qrIngest.stopCameraAria')}
            onClick={stopCamera}
          >
            {t('qrIngest.stopCamera')}
          </button>
        ) : null}
      </div>
      <p className="text-muted text-[11px]">{t('qrIngest.pasteImageHint')}</p>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          void handleFile(file);
        }}
      />
      {scanning ? (
        <video
          ref={videoRef}
          className="max-h-48 w-full rounded border border-gray-700 bg-black object-contain"
          muted
          playsInline
          aria-label={t('qrIngest.cameraPreviewAria')}
        />
      ) : (
        <video ref={videoRef} className="hidden" muted playsInline tabIndex={-1} aria-hidden />
      )}
      {status ? (
        <p className="text-xs text-amber-400" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}
