import { Plus, X } from 'lucide-react-motion';
import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useModalFocusTrap } from '@/renderer/hooks/useModalFocusTrap';
import { isMeshcomGroupDest } from '@/renderer/lib/meshcom/meshcomChannel';
import {
  MESHCOM_GRC_MAX_SLOTS,
  meshcomGrcChannelLabel,
  searchMeshcomGrcGroups,
} from '@/renderer/lib/meshcom/meshcomGrcGroups';
import { addMeshcomGrcLocalChannel } from '@/renderer/lib/meshcom/meshcomGrcLocalChannels';

import { INPUT_BOX_CLASS, NOTICE_CLASS } from './ui/formClasses';

export interface MeshComGrcChatManagerProps {
  /** Device listen slots when Serial/BLE settings are known. */
  listenGroupIds: readonly number[];
  /** True when `--setgrc` can be sent (Serial/BLE). */
  canApplyToDevice: boolean;
  disabled: boolean;
  onSelectChannel: (index: number) => void;
  /** Book the group on the node (optional; local pill always opens). */
  onBookOnDevice?: (ids: readonly number[]) => Promise<void>;
}

/**
 * Chat-strip “+” control to open a MeshCom GRC group (registry or custom id).
 */
export default function MeshComGrcChatManager({
  listenGroupIds,
  canApplyToDevice,
  disabled,
  onSelectChannel,
  onBookOnDevice,
}: MeshComGrcChatManagerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [customId, setCustomId] = useState('');
  const [bookOnDevice, setBookOnDevice] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const closeDialog = useCallback(() => {
    setOpen(false);
    setQuery('');
    setCustomId('');
    setFeedback(null);
  }, []);

  const closeIfIdle = useCallback(() => {
    if (!saving) closeDialog();
  }, [closeDialog, saving]);

  useModalFocusTrap(panelRef, closeIfIdle, { enabled: open });

  const openGroup = useCallback(
    async (id: number) => {
      if (!Number.isInteger(id) || id < 1 || id > 99999 || saving) return;
      setSaving(true);
      setFeedback(null);
      try {
        // Local pill always opens; device booking never silently drops slots / master.
        addMeshcomGrcLocalChannel(id);
        onSelectChannel(id);
        if (canApplyToDevice && bookOnDevice && onBookOnDevice) {
          if (listenGroupIds.includes(id)) {
            closeDialog();
            return;
          }
          if (listenGroupIds.length >= MESHCOM_GRC_MAX_SLOTS) {
            setFeedback(t('meshcom.grc.slotsFullLocalOnly'));
            return;
          }
          await onBookOnDevice([...listenGroupIds, id]);
        }
        closeDialog();
      } catch (e) {
        console.warn('mcL0446 [MeshComGrcChatManager] open failed', e);
        setFeedback(t('meshcom.grc.joinFailed'));
      } finally {
        setSaving(false);
      }
    },
    [
      bookOnDevice,
      canApplyToDevice,
      closeDialog,
      listenGroupIds,
      onBookOnDevice,
      onSelectChannel,
      saving,
      t,
    ],
  );

  const hits = searchMeshcomGrcGroups(query).slice(0, 20);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        aria-label={t('meshcom.grc.joinOpenAria')}
        onClick={() => {
          setOpen(true);
        }}
        className="border-ink-600 text-ink-200 hover:bg-ink-800 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border disabled:opacity-50"
      >
        <Plus aria-hidden size={14} />
      </button>
      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
              role="presentation"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget && !saving) closeDialog();
              }}
            >
              <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label={t('meshcom.grc.joinDialogAria')}
                className="border-ink-700 bg-deep-black rounded-modal shadow-level-3 max-h-[90vh] w-full max-w-md overflow-y-auto border p-4"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-ink-100 text-sm font-medium">{t('meshcom.grc.joinTitle')}</h2>
                  <button
                    type="button"
                    disabled={saving}
                    aria-label={t('aria.closeDialog')}
                    onClick={closeDialog}
                    className="text-muted hover:text-ink-100 rounded-control p-1"
                  >
                    <X aria-hidden size={16} />
                  </button>
                </div>
                <p className="text-muted mb-2 text-xs">{t('meshcom.grc.joinHint')}</p>
                <input
                  type="search"
                  disabled={saving}
                  aria-label={t('meshcom.grc.searchAria')}
                  placeholder={t('meshcom.grc.searchPlaceholder')}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                  }}
                  className={`${INPUT_BOX_CLASS} mb-2 w-full text-xs`}
                />
                <ul className="border-ink-700 rounded-control mb-3 max-h-48 overflow-y-auto border">
                  {hits.map((g) => (
                    <li key={g.id} className="border-ink-800 border-b last:border-b-0">
                      <button
                        type="button"
                        disabled={saving}
                        aria-label={t('meshcom.grc.addKnownAria', {
                          prefix: g.prefix,
                          id: g.id,
                        })}
                        onClick={() => {
                          void openGroup(g.id);
                        }}
                        className="hover:bg-ink-800 flex w-full items-start gap-2 px-2 py-1.5 text-left text-xs disabled:opacity-50"
                      >
                        <span className="text-bright-green shrink-0 font-mono">{g.prefix}</span>
                        <span className="text-ink-200 min-w-0 flex-1">
                          {meshcomGrcChannelLabel(g.id, (id) => t('meshcom.channelGroup', { id }))}
                          <span className="text-muted block">
                            {t(`meshcom.grc.notes.${g.noteKey}`)}
                          </span>
                          {g.reachKey ? (
                            <span className="text-muted block">
                              {t(`meshcom.grc.reach.${g.reachKey}`)}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="mb-3 flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    disabled={saving}
                    aria-label={t('meshcom.grc.customIdAria')}
                    placeholder={t('meshcom.grc.customIdPlaceholder')}
                    value={customId}
                    onChange={(e) => {
                      setCustomId(e.target.value);
                    }}
                    className={`${INPUT_BOX_CLASS} min-w-0 flex-1 font-mono text-xs`}
                  />
                  <button
                    type="button"
                    disabled={saving || !isMeshcomGroupDest(customId.trim())}
                    aria-label={t('meshcom.grc.addCustomAria')}
                    onClick={() => {
                      void openGroup(Number.parseInt(customId.trim(), 10));
                    }}
                    className="bg-brand-green text-app-bg rounded-control px-3 py-1 text-xs font-medium disabled:opacity-50"
                  >
                    {t('meshcom.grc.open')}
                  </button>
                </div>
                {canApplyToDevice && onBookOnDevice ? (
                  <label className="text-ink-200 mb-2 flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={bookOnDevice}
                      disabled={saving}
                      onChange={(e) => {
                        setBookOnDevice(e.target.checked);
                      }}
                    />
                    {t('meshcom.grc.bookOnDevice')}
                  </label>
                ) : null}
                {feedback ? <p className={NOTICE_CLASS.error}>{feedback}</p> : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
