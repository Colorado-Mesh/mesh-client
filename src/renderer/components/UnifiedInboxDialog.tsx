import { Copy, Download, Inbox, Star, Trash2, X } from 'lucide-react-motion';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { GlobalMessageSearchHit } from '@/renderer/lib/globalMessageSearch';
import { ICON_MD } from '@/renderer/lib/icons/iconClass';
import { Z_NODE_DETAIL_MODAL } from '@/renderer/lib/modalZIndex';
import { PROTOCOL_THEME } from '@/renderer/lib/protocolTheme';
import type { ChatMessage } from '@/renderer/lib/types';
import {
  buildUnifiedInboxItems,
  formatInboxItemLine,
  inboxItemsToExportMessages,
  inboxItemToJumpTarget,
  loadDismissedInboxKeys,
  saveDismissedInboxKeys,
  type UnifiedInboxItem,
} from '@/renderer/lib/unifiedInbox';
import { starInboxItems } from '@/renderer/lib/unifiedInboxActions';
import { deleteMessage } from '@/renderer/stores/messageStore';
import type { MeshProtocol } from '@/shared/meshProtocol';

import { useToast } from './Toast';

export interface UnifiedInboxDialogProps {
  open: boolean;
  onClose: () => void;
  enabledProtocols: readonly MeshProtocol[];
  messagesByProtocol: Readonly<Record<MeshProtocol, readonly ChatMessage[]>>;
  ownNodeIdsByProtocol?: Partial<Record<MeshProtocol, ReadonlySet<number>>>;
  ownReticulumHashes?: ReadonlySet<string>;
  reticulumIdentityId?: string | null;
  /** Same handler as global search hits: opens the source conversation and focuses the message. */
  onSelectItem: (hit: GlobalMessageSearchHit) => void;
}

const PROTOCOL_LABEL_KEYS: Record<MeshProtocol, string> = {
  meshtastic: 'unifiedInbox.meshtastic',
  meshcore: 'unifiedInbox.meshcore',
  reticulum: 'unifiedInbox.reticulum',
};

function formatTime(ts: number): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    // catch-no-log-ok Invalid Date / locale edge; empty label is fine
    return '';
  }
}

/**
 * Cross-protocol inbox of received messages (Ctrl/Cmd+Shift+U). Rows jump to the source
 * conversation; checked rows can be copied, exported, starred or deleted locally.
 */
export function UnifiedInboxDialog({ open, ...rest }: UnifiedInboxDialogProps) {
  // Body mounts per open, so filters, selection and the dismissed set reset without effects.
  if (!open) return null;
  return <UnifiedInboxDialogBody {...rest} />;
}

function UnifiedInboxDialogBody({
  onClose,
  enabledProtocols,
  messagesByProtocol,
  ownNodeIdsByProtocol,
  ownReticulumHashes,
  reticulumIdentityId,
  onSelectItem,
}: Omit<UnifiedInboxDialogProps, 'open'>) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [protocolFilter, setProtocolFilter] = useState<MeshProtocol | 'all'>('all');
  const [textQuery, setTextQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => loadDismissedInboxKeys());
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const items = useMemo(
    () =>
      buildUnifiedInboxItems({
        messagesByProtocol,
        enabledProtocols,
        ownNodeIdsByProtocol,
        dismissed,
        protocolFilter,
        textQuery,
      }),
    [
      messagesByProtocol,
      enabledProtocols,
      ownNodeIdsByProtocol,
      dismissed,
      protocolFilter,
      textQuery,
    ],
  );

  // Drop selections that scrolled out of the list (filter change, dismissal).
  const selectedItems = useMemo(() => items.filter((i) => selected.has(i.key)), [items, selected]);
  const selectedCount = selectedItems.length;

  const protocolLabel = useCallback((p: MeshProtocol) => t(PROTOCOL_LABEL_KEYS[p]), [t]);

  const conversationLabel = useCallback(
    (item: UnifiedInboxItem) =>
      item.isDirectMessage
        ? t('unifiedInbox.directMessage')
        : t('unifiedInbox.channel', { index: item.message.channel }),
    [t],
  );

  const toggle = (key: string) => {
    setConfirmingDelete(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allSelected = items.length > 0 && selectedCount === items.length;

  const handleCopy = () => {
    const text = selectedItems
      .map((item) =>
        formatInboxItemLine(
          item,
          {
            protocolLabel: protocolLabel(item.protocol),
            conversationLabel: conversationLabel(item),
          },
          formatTime,
        ),
      )
      .join('\n');
    void (async () => {
      try {
        await navigator.clipboard.writeText(text);
        addToast(t('unifiedInbox.copied', { count: selectedCount }), 'success');
      } catch (e: unknown) {
        console.warn('[UnifiedInbox] copy failed ' + errLikeToLogString(e));
        addToast(t('unifiedInbox.copyFailed'), 'error');
      }
    })();
  };

  const handleExport = () => {
    void (async () => {
      try {
        const result = await window.electronAPI.chat.export(
          inboxItemsToExportMessages(selectedItems, protocolLabel),
        );
        // Cancelling the save dialog also reports success:false without a path.
        if (!result.success && result.path != null) {
          addToast(t('unifiedInbox.exportFailed'), 'error');
        }
      } catch (e: unknown) {
        console.warn('[UnifiedInbox] export failed ' + errLikeToLogString(e));
        addToast(t('unifiedInbox.exportFailed'), 'error');
      }
    })();
  };

  const handleStar = () => {
    const added = starInboxItems(selectedItems);
    addToast(
      added > 0 ? t('unifiedInbox.starred', { count: added }) : t('unifiedInbox.alreadyStarred'),
      added > 0 ? 'success' : 'info',
    );
  };

  const handleDeleteLocal = () => {
    const toRemove = selectedItems;
    const next = new Set(dismissed);
    for (const item of toRemove) next.add(item.key);
    if (!saveDismissedInboxKeys(next)) {
      addToast(t('unifiedInbox.deleteFailed'), 'error');
      setConfirmingDelete(false);
      return;
    }
    setDismissed(next);
    setSelected(new Set());
    setConfirmingDelete(false);

    // Reticulum rows also have a per-message SQLite delete; Meshtastic/MeshCore do not, so those
    // are only hidden from the inbox (the chat history itself is untouched).
    for (const item of toRemove) {
      if (item.protocol !== 'reticulum' || !reticulumIdentityId) continue;
      const hash = item.message.reticulum_message_hash;
      if (hash) {
        void window.electronAPI.db
          .deleteReticulumMessage(reticulumIdentityId, hash)
          .catch((e: unknown) => {
            console.warn('[UnifiedInbox] reticulum delete failed ' + errLikeToLogString(e));
          });
      }
      if (item.message.storeId) deleteMessage(reticulumIdentityId, item.message.storeId);
    }
    addToast(t('unifiedInbox.deleted', { count: toRemove.length }), 'success');
  };

  const openItem = (item: UnifiedInboxItem) => {
    const ownNodeIds = new Set<number>();
    for (const ids of Object.values(ownNodeIdsByProtocol ?? {})) {
      if (!ids) continue;
      for (const id of ids) ownNodeIds.add(id >>> 0);
    }
    onSelectItem(
      inboxItemToJumpTarget(item, {
        ownNodeIds: ownNodeIds.size > 0 ? ownNodeIds : undefined,
        ownReticulumHashes,
      }),
    );
    onClose();
  };

  const actionClass =
    'text-label text-ink-200 hover:bg-ink-800 disabled:opacity-50 rounded-control flex items-center gap-1.5 px-2 py-1 disabled:cursor-not-allowed disabled:hover:bg-transparent';

  return (
    <div
      className="fixed inset-0 flex items-start justify-center bg-black/50 px-3 pt-[10vh]"
      style={{ zIndex: Z_NODE_DETAIL_MODAL }}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-unified-inbox
        className="border-ink-700 bg-ink-900 shadow-level-3 rounded-modal flex max-h-[75vh] w-full max-w-2xl flex-col overflow-hidden border"
      >
        <div className="border-ink-700 flex items-center gap-2 border-b px-3 py-2">
          <Inbox className={`${ICON_MD} text-ink-400 shrink-0`} aria-hidden />
          <h2 id={titleId} className="text-body text-ink-100 flex-1 font-medium">
            {t('unifiedInbox.title')}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="text-ink-400 hover:text-ink-100 hover:bg-ink-800 rounded-control p-1.5"
            aria-label={t('aria.closeDialog')}
          >
            <X className={ICON_MD} aria-hidden />
          </button>
        </div>

        <div className="border-ink-800 flex flex-wrap gap-2 border-b px-3 py-2">
          <label className="text-label text-ink-400 flex items-center gap-1.5">
            <span>{t('unifiedInbox.protocol')}</span>
            <select
              className="border-ink-700 bg-ink-950 text-ink-100 rounded-control border px-2 py-1"
              value={protocolFilter}
              onChange={(e) => {
                setProtocolFilter(e.target.value as MeshProtocol | 'all');
              }}
              aria-label={t('unifiedInbox.protocol')}
            >
              <option value="all">{t('unifiedInbox.protocolAll')}</option>
              {enabledProtocols.map((p) => (
                <option key={p} value={p}>
                  {protocolLabel(p)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-label text-ink-400 flex min-w-[10rem] flex-1 items-center gap-1.5">
            <span className="shrink-0">{t('unifiedInbox.filter')}</span>
            <input
              type="search"
              value={textQuery}
              onChange={(e) => {
                setTextQuery(e.target.value);
              }}
              placeholder={t('unifiedInbox.filterPlaceholder')}
              aria-label={t('unifiedInbox.filter')}
              className="border-ink-700 bg-ink-950 text-ink-100 placeholder:text-muted rounded-control min-w-0 flex-1 border px-2 py-1"
            />
          </label>
        </div>

        <div className="border-ink-800 flex flex-wrap items-center gap-1 border-b px-3 py-1.5">
          <label className="text-label text-ink-300 me-2 flex items-center gap-1.5">
            <input
              type="checkbox"
              className="accent-brand-green"
              checked={allSelected}
              disabled={items.length === 0}
              onChange={() => {
                setConfirmingDelete(false);
                setSelected(allSelected ? new Set() : new Set(items.map((i) => i.key)));
              }}
              aria-label={t('unifiedInbox.selectAll')}
            />
            <span aria-live="polite">
              {t('unifiedInbox.selectedCount', { count: selectedCount })}
            </span>
          </label>
          <button
            type="button"
            className={actionClass}
            disabled={selectedCount === 0}
            onClick={handleCopy}
            aria-label={t('unifiedInbox.copy')}
          >
            <Copy className={ICON_MD} aria-hidden />
            <span>{t('unifiedInbox.copy')}</span>
          </button>
          <button
            type="button"
            className={actionClass}
            disabled={selectedCount === 0}
            onClick={handleExport}
            aria-label={t('unifiedInbox.export')}
          >
            <Download className={ICON_MD} aria-hidden />
            <span>{t('unifiedInbox.export')}</span>
          </button>
          <button
            type="button"
            className={actionClass}
            disabled={selectedCount === 0}
            onClick={handleStar}
            aria-label={t('unifiedInbox.star')}
          >
            <Star className={ICON_MD} aria-hidden />
            <span>{t('unifiedInbox.star')}</span>
          </button>
          <button
            type="button"
            className={actionClass}
            disabled={selectedCount === 0}
            onClick={() => {
              setConfirmingDelete(true);
            }}
            aria-label={t('unifiedInbox.deleteLocal')}
          >
            <Trash2 className={ICON_MD} aria-hidden />
            <span>{t('unifiedInbox.deleteLocal')}</span>
          </button>
        </div>

        {confirmingDelete && selectedCount > 0 ? (
          <div
            role="alert"
            className="border-ink-800 flex flex-wrap items-center gap-2 border-b bg-red-950/40 px-3 py-2"
          >
            <p className="text-label text-ink-100 flex-1">
              {t('unifiedInbox.deleteConfirm', { count: selectedCount })}
            </p>
            <button
              type="button"
              className="text-label text-ink-200 hover:bg-ink-800 rounded-control px-2 py-1"
              onClick={() => {
                setConfirmingDelete(false);
              }}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="text-label rounded-control bg-red-700 px-2 py-1 text-white hover:bg-red-600"
              onClick={handleDeleteLocal}
            >
              {t('unifiedInbox.deleteConfirmAction')}
            </button>
          </div>
        ) : null}

        <ul
          className="min-h-0 flex-1 overflow-y-auto px-1 py-1"
          aria-label={t('unifiedInbox.results')}
        >
          {items.length === 0 ? (
            <li className="text-label text-ink-400 px-3 py-4">{t('unifiedInbox.empty')}</li>
          ) : (
            items.map((item) => {
              const checked = selected.has(item.key);
              return (
                <li
                  key={item.key}
                  className={`hover:bg-sidebar-active-bg flex items-start gap-2 rounded-md px-2 py-1.5 ${
                    checked ? 'bg-sidebar-active-bg' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    className="accent-brand-green mt-1.5 shrink-0"
                    checked={checked}
                    onChange={() => {
                      toggle(item.key);
                    }}
                    aria-label={t('unifiedInbox.selectMessage', {
                      sender: item.message.sender_name,
                    })}
                  />
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 flex-col gap-0.5 text-start"
                    onClick={() => {
                      openItem(item);
                    }}
                    aria-label={t('unifiedInbox.openConversation', {
                      sender: item.message.sender_name,
                    })}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={`text-label font-medium ${PROTOCOL_THEME[item.protocol].nameTextClass}`}
                      >
                        {protocolLabel(item.protocol)}
                      </span>
                      <span className="text-2xs text-muted shrink-0">
                        {formatTime(item.message.timestamp)}
                      </span>
                    </span>
                    <span className="text-label text-ink-300 truncate">
                      {item.message.sender_name}
                      <span className="text-muted"> · {conversationLabel(item)}</span>
                    </span>
                    <span dir="auto" className="text-body text-ink-100 line-clamp-2">
                      {item.message.payload}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
