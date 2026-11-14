import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** Focus the paste target on mount (e.g. when a scan popover opens). */
  focusOnMount?: boolean;
}

/** Which mounted ingest control should receive the next document paste (hover fallback). */
let activePasteRoot: HTMLElement | null = null;

/** All mounted paste roots — used so focus wins over hover across controls. */
const mountedPasteRoots = new Set<HTMLElement>();

function clipboardItems(
  items: DataTransferItemList | DataTransferItem[],
): readonly DataTransferItem[] {
  return Array.from(items);
}

function clipboardHasImage(items: DataTransferItemList | DataTransferItem[]): boolean {
  return clipboardItems(items).some((item) => item.type.startsWith('image/'));
}

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Collapsed / explicitly hidden scanners must not own paste.
 * Prefer structural checks over getClientRects — jsdom often reports empty rects
 * for otherwise-visible nodes.
 */
function isPasteRootVisible(root: HTMLElement): boolean {
  if (!root.isConnected) return false;
  let el: Element | null = root;
  while (el) {
    if (el instanceof HTMLElement) {
      if (el.hidden) return false;
      if (el.style.display === 'none' || el.style.visibility === 'hidden') return false;
    }
    if (el instanceof HTMLDetailsElement && !el.open) {
      const summary = el.querySelector(':scope > summary');
      // Content inside a closed <details> (outside the summary) is inactive.
      if (summary && !summary.contains(root)) return false;
    }
    el = el.parentElement;
  }
  return true;
}

function findFocusedPasteRoot(active: Element | null): HTMLElement | null {
  if (!(active instanceof Node)) return null;
  for (const root of mountedPasteRoots) {
    if (root.contains(active) && isPasteRootVisible(root)) return root;
  }
  return null;
}

/** Test helper — reset module paste ownership between cases. */
export function resetQrIngestPasteOwnershipForTests(): void {
  activePasteRoot = null;
  mountedPasteRoots.clear();
}

/**
 * Paste image / choose image file / optional camera scan → jsQR decode.
 * Also accepts pasted deep-link text when focused / marked active.
 * Camera absence or permission denial is a localized soft failure.
 */
export default function QrIngestControl({
  onDecoded,
  disabled = false,
  className = '',
  focusOnMount = false,
}: QrIngestControlProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [starting, setStarting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
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
    const root = rootRef.current;
    if (root) mountedPasteRoots.add(root);
    return () => {
      mountedRef.current = false;
      if (root) mountedPasteRoots.delete(root);
      if (activePasteRoot === root) activePasteRoot = null;
    };
  }, []);

  const markActiveForPaste = useCallback(() => {
    if (disabled) return;
    const root = rootRef.current;
    if (!root || !isPasteRootVisible(root)) return;
    activePasteRoot = root;
  }, [disabled]);

  useEffect(() => {
    if (!focusOnMount || disabled) return;
    const root = rootRef.current;
    if (!root || !isPasteRootVisible(root)) return;
    activePasteRoot = root;
    root.focus({ preventScroll: true });
  }, [focusOnMount, disabled]);

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
    if (!disabled) return;
    startGenerationRef.current += 1;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    stopTracks(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    const root = rootRef.current;
    if (activePasteRoot === root) activePasteRoot = null;
    void Promise.resolve().then(() => {
      if (!mountedRef.current) return;
      // Yield so setState is not synchronous in the effect body (react-hooks/set-state-in-effect).
      setScanning(false);
      setStarting(false);
    });
  }, [disabled, stopTracks]);

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

  const ingestClipboard = useCallback(
    (clipboardData: DataTransfer | null | undefined) => {
      if (disabled || !clipboardData) return false;
      const items = clipboardData.items;
      if (items && clipboardHasImage(items)) {
        for (const item of clipboardItems(items)) {
          if (!item.type.startsWith('image/')) continue;
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
          return true;
        }
      }
      const rawText = clipboardData.getData('text/plain').trim();
      if (rawText) {
        emitDecoded(rawText);
        return true;
      }
      return false;
    },
    [disabled, emitDecoded, t],
  );

  const shouldHandleDocumentPaste = useCallback((): boolean => {
    if (disabled) return false;
    const root = rootRef.current;
    if (!root || !isPasteRootVisible(root)) return false;
    const active = document.activeElement;
    // Focused scan control always wins over hover-armed fallback.
    const focusedOwner = findFocusedPasteRoot(active);
    if (focusedOwner) return focusedOwner === root;
    // Hover/click-armed paste must not steal from other inputs/textareas.
    if (isEditableTarget(active)) return false;
    return activePasteRoot === root;
  }, [disabled]);

  // Div onPaste only fires when a descendant is focused; document paste covers the
  // common case (Cmd/Ctrl+V after opening scan, or after clicking the paste zone).
  useEffect(() => {
    if (disabled) return;
    const onDocumentPaste = (e: ClipboardEvent) => {
      if (!shouldHandleDocumentPaste()) return;
      if (ingestClipboard(e.clipboardData)) {
        e.preventDefault();
      }
    };
    document.addEventListener('paste', onDocumentPaste);
    return () => {
      document.removeEventListener('paste', onDocumentPaste);
    };
  }, [disabled, ingestClipboard, shouldHandleDocumentPaste]);

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
        const root = rootRef.current;
        if (!root || !isPasteRootVisible(root)) {
          stopCamera();
          return;
        }
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
    <div
      ref={rootRef}
      tabIndex={disabled ? -1 : 0}
      role="group"
      aria-label={t('qrIngest.pasteTargetAria')}
      className={`focus-visible:ring-brand-green/60 rounded-control space-y-2 outline-none focus-visible:ring-1 ${className}`}
      onPointerDown={markActiveForPaste}
      onPointerEnter={markActiveForPaste}
      onFocus={markActiveForPaste}
    >
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          className="border-ink-600 text-ink-300 hover:bg-ink-800 rounded border px-2 py-1 text-xs disabled:opacity-40"
          aria-label={t('qrIngest.chooseImageAria')}
          onClick={() => fileInputRef.current?.click()}
        >
          {t('qrIngest.chooseImage')}
        </button>
        <button
          type="button"
          disabled={disabled || scanning || starting}
          className="border-ink-600 text-ink-300 hover:bg-ink-800 rounded border px-2 py-1 text-xs disabled:opacity-40"
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
            className="border-ink-600 text-ink-300 hover:bg-ink-800 rounded border px-2 py-1 text-xs"
            aria-label={t('qrIngest.stopCameraAria')}
            onClick={stopCamera}
          >
            {t('qrIngest.stopCamera')}
          </button>
        ) : null}
      </div>
      <p className="text-muted text-label">{t('qrIngest.pasteImageHint')}</p>
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
          className="border-ink-700 max-h-48 w-full rounded border bg-black object-contain"
          muted
          playsInline
          aria-label={t('qrIngest.cameraPreviewAria')}
        />
      ) : (
        <video ref={videoRef} className="hidden" muted playsInline tabIndex={-1} aria-hidden />
      )}
      {status ? (
        <p className="text-xs text-orange-400" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}
