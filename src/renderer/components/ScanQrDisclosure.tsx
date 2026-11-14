import { QrCode } from 'lucide-react-motion';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import QrIngestControl from '@/renderer/components/QrIngestControl';
import { Button } from '@/renderer/components/ui/Button';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { ICON_SM_PLUS } from '@/renderer/lib/icons/iconClass';
import { Z_POPOVER_MENU } from '@/renderer/lib/modalZIndex';

export interface ScanQrDisclosureProps {
  /** Raw decoded text. The caller classifies and applies it. */
  onDecoded: (text: string) => void | Promise<void>;
  disabled?: boolean;
  /** Visible label; defaults to `t('qrIngest.scanQr')`. */
  label?: string;
  /** Accessible name for the trigger; defaults to `t('qrIngest.scanQrAria')`. */
  triggerAriaLabel?: string;
  /**
   * `link` — compact muted text with inline expand (Chat / launcher).
   * `toolbar` — secondary Button + portaled popover (Contacts toolbar).
   */
  triggerStyle?: 'link' | 'toolbar';
  /** Optional helper line under the decode buttons (link style only by default). */
  hint?: string;
  /** Shown when `disabled` (e.g. connect-to-scan for radio-backed channel apply). */
  disabledHint?: string;
  /** Settings-search anchor placed on the wrapper (registry entry required). */
  anchorId?: string;
  /** Collapse after a decode is dispatched; default true. */
  closeOnDecoded?: boolean;
  className?: string;
}

interface PopoverPosition {
  top: number;
  left: number;
}

const POPOVER_GAP = 4;
const VIEWPORT_MARGIN = 8;
const TOOLBAR_POPOVER_WIDTH_PX = 280;

function computePopoverPosition(anchor: HTMLElement, panel: HTMLElement): PopoverPosition {
  const a = anchor.getBoundingClientRect();
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  let left = a.left;
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - width - VIEWPORT_MARGIN));
  const below = a.bottom + POPOVER_GAP;
  const fitsBelow = below + height <= window.innerHeight - VIEWPORT_MARGIN;
  const top = fitsBelow ? below : Math.max(VIEWPORT_MARGIN, a.top - POPOVER_GAP - height);
  return { top, left };
}

/**
 * Compact QR scan disclosure (generalizes ChatPaperScanControl).
 * MeshCore contact QR share already exists on node detail; this is the scan side.
 */
export default function ScanQrDisclosure({
  onDecoded,
  disabled = false,
  label,
  triggerAriaLabel,
  triggerStyle = 'link',
  hint,
  disabledHint,
  anchorId,
  closeOnDecoded = true,
  className = '',
}: ScanQrDisclosureProps) {
  const { t } = useTranslation();
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const visibleLabel = label ?? t('qrIngest.scanQr');
  const aria = triggerAriaLabel ?? t('qrIngest.scanQrAria');
  const isToolbar = triggerStyle === 'toolbar';

  const close = () => {
    setExpanded(false);
  };

  const handleDecoded = (text: string) => {
    void (async () => {
      try {
        await Promise.resolve(onDecoded(text));
        if (closeOnDecoded) close();
      } catch (err: unknown) {
        console.error('[ScanQrDisclosure] onDecoded failed: ' + errLikeToLogString(err));
      }
    })();
  };

  const toggle = () => {
    setExpanded((v) => !v);
  };

  useLayoutEffect(() => {
    if (!expanded || !isToolbar) return;
    const anchor = triggerRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    setPosition(computePopoverPosition(anchor, panel));
  }, [expanded, isToolbar]);

  useEffect(() => {
    if (!expanded || !isToolbar) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        triggerRef.current?.focus();
      }
    };
    const onDismiss = () => {
      close();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onDismiss);
    window.addEventListener('scroll', onDismiss, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onDismiss);
      window.removeEventListener('scroll', onDismiss, true);
    };
  }, [expanded, isToolbar]);

  const panelBody = (
    <>
      {hint ? <p className="text-muted text-label mb-1">{hint}</p> : null}
      {disabled && disabledHint ? (
        <p className="text-muted text-label mb-1">{disabledHint}</p>
      ) : null}
      <QrIngestControl disabled={disabled} focusOnMount onDecoded={handleDecoded} />
    </>
  );

  const anchorProps = anchorId ? { 'data-setting-anchor': anchorId } : {};

  if (isToolbar) {
    return (
      <div className={`relative inline-flex ${className}`.trim()} {...anchorProps}>
        <Button
          ref={triggerRef}
          size="sm"
          aria-label={aria}
          aria-expanded={expanded}
          aria-haspopup="dialog"
          aria-controls={expanded ? panelId : undefined}
          disabled={disabled}
          onClick={toggle}
          icon={<QrCode aria-hidden className={ICON_SM_PLUS} size={14} />}
        >
          {visibleLabel}
        </Button>
        {expanded
          ? createPortal(
              <div
                ref={panelRef}
                id={panelId}
                role="dialog"
                aria-label={visibleLabel}
                style={{
                  zIndex: Z_POPOVER_MENU,
                  width: `${TOOLBAR_POPOVER_WIDTH_PX / 16}rem`,
                  maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
                  top: position?.top ?? -9999,
                  left: position?.left ?? -9999,
                }}
                className="border-secondary-dark bg-deep-black shadow-level-2 rounded-card fixed border p-3"
              >
                {panelBody}
              </div>,
              document.body,
            )
          : null}
      </div>
    );
  }

  return (
    <div className={className} {...anchorProps}>
      <button
        ref={triggerRef}
        type="button"
        className="text-muted text-label hover:text-ink-200 inline-flex items-center gap-1 disabled:opacity-40"
        aria-label={aria}
        aria-expanded={expanded}
        aria-controls={panelId}
        disabled={disabled}
        onClick={toggle}
      >
        <QrCode className="h-3 w-3" aria-hidden />
        {visibleLabel}
      </button>
      {expanded ? (
        <div
          id={panelId}
          role="region"
          aria-label={visibleLabel}
          className="border-ink-700/80 bg-ink-900/40 mt-1 rounded border p-2"
        >
          {panelBody}
        </div>
      ) : null}
    </div>
  );
}
