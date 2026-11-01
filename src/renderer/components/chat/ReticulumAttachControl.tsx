import { ImagePlus, Paperclip, X } from 'lucide-react-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type PrepareAttachmentError,
  prepareReticulumFileAttachments,
  prepareReticulumPhotoAttachment,
} from '@/renderer/lib/reticulum/prepareReticulumAttachments';
import {
  cancelReticulumAttachmentTransfer,
  sendReticulumAttachments,
  type SendReticulumAttachmentsFailure,
} from '@/renderer/lib/reticulum/sendReticulumAttachments';
import type { IdentityId } from '@/renderer/lib/types';
import { useReticulumAttachmentSendStore } from '@/renderer/stores/reticulumAttachmentSendStore';
import {
  RETICULUM_ATTACHMENT_MAX_FILES,
  RETICULUM_ATTACHMENT_MAX_TOTAL_BYTES,
} from '@/shared/reticulum-attachment-types';

import { HelpTooltip } from '../HelpTooltip';
import { useToast } from '../Toast';

const BUTTON_CLASS =
  'flex h-[2.625rem] min-w-[2.625rem] shrink-0 items-center justify-center rounded-lg border border-secondary-dark bg-sidebar-active-bg px-2.5 text-xs font-semibold text-muted transition-colors hover:text-ink-200 disabled:opacity-50';

/** Raster formats the sidecar accepts for `FIELD_IMAGE` (SVG / HEIC excluded). */
const PHOTO_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

type AttachmentFailure = PrepareAttachmentError | SendReticulumAttachmentsFailure;

const FAILURE_KEYS: Record<AttachmentFailure, string> = {
  attachment_count_exceeded: 'chatPanel.attachment.errors.tooMany',
  attachment_too_large: 'chatPanel.attachment.errors.tooLarge',
  image_too_large: 'chatPanel.attachment.errors.photoTooLarge',
  attachment_empty: 'chatPanel.attachment.errors.empty',
  attachment_base64_decode: 'chatPanel.attachment.errors.sendFailed',
  image_base64_decode: 'chatPanel.attachment.errors.sendFailed',
  image_format_unsupported: 'chatPanel.attachment.errors.photoUnsupported',
  image_magic_mismatch: 'chatPanel.attachment.errors.photoUnsupported',
  photo_unsupported: 'chatPanel.attachment.errors.photoUnsupported',
  photo_decode_failed: 'chatPanel.attachment.errors.photoDecodeFailed',
  read_failed: 'chatPanel.attachment.errors.readFailed',
  no_files: 'chatPanel.attachment.errors.empty',
  cancelled: 'chatPanel.attachment.cancelled',
  runtime_unavailable: 'chatPanel.attachment.errors.runtimeUnavailable',
  missing_lxmf_delivery: 'chatPanel.reticulumChatNeedsLxmfDelivery',
  no_destination: 'chatPanel.attachment.errors.runtimeUnavailable',
  self_not_ready: 'chatPanel.attachment.errors.runtimeUnavailable',
  cache_failed: 'chatPanel.attachment.errors.cacheFailed',
  no_propagation_node: 'chatPanel.reticulumNoPropagationNode',
  too_large_for_propagation: 'chatPanel.attachment.errors.tooLargeForPropagation',
  send_failed: 'chatPanel.attachment.errors.sendFailed',
};

export interface ReticulumAttachControlProps {
  identityId: IdentityId;
  /** Active LXMF DM peer node id. */
  destination: number;
  disabled?: boolean;
}

/**
 * Composer **Attach** control for LXMF DMs: files (`FIELD_FILE_ATTACHMENTS`) and photos
 * (`FIELD_IMAGE`) with a progress / cancel strip. Distinct from rncp (Remote file transfer).
 */
export function ReticulumAttachControl({
  identityId,
  destination,
  disabled = false,
}: Readonly<ReticulumAttachControlProps>) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const transfers = useReticulumAttachmentSendStore((s) => s.transfers);
  const active = transfers.filter(
    (tr) => tr.identityId === identityId && tr.destination >>> 0 === destination >>> 0,
  );

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const toastFailure = useCallback(
    (reason: AttachmentFailure) => {
      const key = FAILURE_KEYS[reason];
      addToast(
        t(key, {
          limitKib: Math.round(RETICULUM_ATTACHMENT_MAX_TOTAL_BYTES / 1024),
          count: RETICULUM_ATTACHMENT_MAX_FILES,
        }),
        reason === 'too_large_for_propagation' ? 'info' : 'error',
      );
    },
    [addToast, t],
  );

  const handlePicked = useCallback(
    async (files: File[], kind: 'files' | 'photo') => {
      if (files.length === 0) return;
      setPreparing(true);
      try {
        const prepared =
          kind === 'photo'
            ? await prepareReticulumPhotoAttachment(files[0])
            : await prepareReticulumFileAttachments(files);
        if (!prepared.ok) {
          toastFailure(prepared.error);
          return;
        }
        await sendReticulumAttachments({
          identityId,
          destination,
          prepared: prepared.prepared,
          onFailure: toastFailure,
        });
      } finally {
        setPreparing(false);
      }
    },
    [destination, identityId, toastFailure],
  );

  const onInputChange = (kind: 'files' | 'photo') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    // Reset so picking the same file again re-fires change.
    e.target.value = '';
    void handlePicked(picked, kind);
  };

  return (
    <div ref={rootRef} className="relative inline-flex shrink-0" data-testid="reticulum-attach">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        data-testid="reticulum-attach-file-input"
        aria-label={t('chatPanel.attachment.fileInputAria')}
        onChange={onInputChange('files')}
      />
      <input
        ref={photoInputRef}
        type="file"
        accept={PHOTO_ACCEPT}
        hidden
        data-testid="reticulum-attach-photo-input"
        aria-label={t('chatPanel.attachment.photoInputAria')}
        onChange={onInputChange('photo')}
      />
      <HelpTooltip
        text={t('chatPanel.attachment.tooltip', {
          limitKib: Math.round(RETICULUM_ATTACHMENT_MAX_TOTAL_BYTES / 1024),
          count: RETICULUM_ATTACHMENT_MAX_FILES,
        })}
        className="shrink-0"
        nonFocusableWrapper
      >
        <button
          type="button"
          aria-label={t('chatPanel.attachment.attachAria')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          disabled={disabled || preparing}
          className={BUTTON_CLASS}
          onClick={() => {
            setMenuOpen((open) => !open);
          }}
        >
          <Paperclip aria-hidden className="h-4 w-4" size={16} />
        </button>
      </HelpTooltip>
      {menuOpen ? (
        <div
          role="menu"
          aria-label={t('chatPanel.attachment.menuAria')}
          className="border-secondary-dark bg-ink-900 shadow-level-3 absolute bottom-full left-0 z-20 mb-2 flex w-48 flex-col rounded-lg border p-1"
        >
          <button
            type="button"
            role="menuitem"
            className="text-ink-200 hover:bg-ink-800 flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
            onClick={() => {
              setMenuOpen(false);
              fileInputRef.current?.click();
            }}
          >
            <Paperclip aria-hidden className="h-4 w-4" size={16} />
            {t('chatPanel.attachment.attachFile')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="text-ink-200 hover:bg-ink-800 flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
            onClick={() => {
              setMenuOpen(false);
              photoInputRef.current?.click();
            }}
          >
            <ImagePlus aria-hidden className="h-4 w-4" size={16} />
            {t('chatPanel.attachment.attachPhoto')}
          </button>
        </div>
      ) : null}
      {active.length > 0 ? (
        <ul
          aria-label={t('chatPanel.attachment.transfersAria')}
          className="border-secondary-dark bg-ink-900 shadow-level-3 absolute bottom-full left-0 z-10 mb-2 flex w-72 flex-col gap-1 rounded-lg border p-2"
        >
          {active.map((tr) => {
            const pct = tr.progress == null ? null : Math.round(tr.progress * 100);
            return (
              <li key={tr.id} className="flex flex-col gap-1 text-xs" data-testid="attach-transfer">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-ink-200 truncate">
                    {t('chatPanel.attachment.sending', { name: tr.fileName })}
                  </span>
                  <button
                    type="button"
                    aria-label={t('chatPanel.attachment.cancelAria', { name: tr.fileName })}
                    disabled={tr.cancelling}
                    className="text-muted hover:text-ink-100 shrink-0 disabled:opacity-50"
                    onClick={() => {
                      void cancelReticulumAttachmentTransfer(tr.id);
                    }}
                  >
                    <X aria-hidden className="h-3.5 w-3.5" size={14} />
                  </button>
                </div>
                <div
                  role="progressbar"
                  aria-label={t('chatPanel.attachment.progressAria', { name: tr.fileName })}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  {...(pct == null ? {} : { 'aria-valuenow': pct })}
                  className="bg-ink-800 h-1.5 w-full overflow-hidden rounded-full"
                >
                  <div
                    className={`bg-brand-green h-full ${pct == null ? 'w-1/3 animate-pulse' : ''}`}
                    style={pct == null ? undefined : { width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
