import { Inbox, Search, X } from 'lucide-react-motion';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  GLOBAL_MESSAGE_SEARCH_LIMIT,
  type GlobalMessageSearchDirection,
  type GlobalMessageSearchHit,
  type GlobalMessageSearchProtocolFilter,
  runGlobalMessageSearch,
} from '@/renderer/lib/globalMessageSearch';
import { ICON_MD } from '@/renderer/lib/icons/iconClass';
import { Z_NODE_DETAIL_MODAL } from '@/renderer/lib/modalZIndex';
import { PROTOCOL_THEME } from '@/renderer/lib/protocolTheme';
import type { MeshProtocol } from '@/shared/meshProtocol';

export interface GlobalMessageSearchDialogProps {
  open: boolean;
  onClose: () => void;
  enabledProtocols: readonly MeshProtocol[];
  reticulumIdentityId?: string | null;
  ownNodeIdsByProtocol?: Partial<Record<MeshProtocol, ReadonlySet<number>>>;
  ownReticulumHashes?: ReadonlySet<string>;
  onSelectHit: (hit: GlobalMessageSearchHit) => void;
  /** Switch to the unified inbox (multi-select actions across protocols). */
  onOpenInbox?: () => void;
}

function formatHitTime(ts: number): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    // catch-no-log-ok Invalid Date / locale edge; empty label is fine
    return '';
  }
}

const PROTOCOL_LABEL_KEYS: Record<MeshProtocol, string> = {
  meshtastic: 'globalMessageSearch.meshtastic',
  meshcore: 'globalMessageSearch.meshcore',
  reticulum: 'globalMessageSearch.reticulum',
};

function protocolLabelKey(protocol: MeshProtocol): string {
  return PROTOCOL_LABEL_KEYS[protocol];
}

/**
 * Cross-protocol FTS dialog (Ctrl/Cmd+Shift+F). Uses existing db:search* IPC;
 * selecting a hit opens Chat and focuses the message.
 */
export function GlobalMessageSearchDialog({
  open,
  onClose,
  enabledProtocols,
  reticulumIdentityId,
  ownNodeIdsByProtocol,
  ownReticulumHashes,
  onSelectHit,
  onOpenInbox,
}: GlobalMessageSearchDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [protocol, setProtocol] = useState<GlobalMessageSearchProtocolFilter>('all');
  const [direction, setDirection] = useState<GlobalMessageSearchDirection>('all');
  const [senderQuery, setSenderQuery] = useState('');
  const [hits, setHits] = useState<GlobalMessageSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const searchGen = useRef(0);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
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
  }, [open, onClose]);

  const ownNodeIds = useMemo(() => {
    const set = new Set<number>();
    for (const p of enabledProtocols) {
      const ids = ownNodeIdsByProtocol?.[p];
      if (!ids) continue;
      for (const id of ids) set.add(id >>> 0);
    }
    return set;
  }, [enabledProtocols, ownNodeIdsByProtocol]);

  const runSearch = useCallback(
    async (nextQuery: string) => {
      const q = nextQuery.trim();
      if (!q) {
        setHits([]);
        setError(null);
        setLoading(false);
        return;
      }
      const api = window.electronAPI?.db;
      if (!api?.searchMessages || !api.searchMeshcoreMessages || !api.searchReticulumMessages) {
        setError(t('globalMessageSearch.unavailable'));
        setHits([]);
        return;
      }
      const gen = ++searchGen.current;
      setLoading(true);
      setError(null);
      try {
        const results = await runGlobalMessageSearch({
          query: q,
          filters: {
            protocol,
            senderQuery,
            direction,
            ownNodeIds,
            ownReticulumHashes,
          },
          api: {
            searchMessages: api.searchMessages.bind(api),
            searchMeshcoreMessages: api.searchMeshcoreMessages.bind(api),
            searchReticulumMessages: api.searchReticulumMessages.bind(api),
          },
          reticulumIdentityId,
          enabledProtocols,
          limitPerProtocol: GLOBAL_MESSAGE_SEARCH_LIMIT,
        });
        if (gen !== searchGen.current) return;
        setHits(results);
        setActiveIndex(0);
      } catch (err) {
        if (gen !== searchGen.current) return;
        console.error('[GlobalMessageSearch] search failed', err);
        setError(t('globalMessageSearch.failed'));
        setHits([]);
      } finally {
        if (gen === searchGen.current) setLoading(false);
      }
    },
    [
      direction,
      enabledProtocols,
      ownNodeIds,
      ownReticulumHashes,
      protocol,
      reticulumIdentityId,
      senderQuery,
      t,
    ],
  );

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      void runSearch(query);
    }, 250);
    return () => {
      window.clearTimeout(handle);
    };
  }, [open, query, protocol, senderQuery, direction, runSearch]);

  if (!open) return null;

  const openHit = (hit: GlobalMessageSearchHit) => {
    onSelectHit(hit);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 flex items-start justify-center bg-black/50 px-3 pt-[12vh]"
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
        data-global-message-search
        className="border-ink-700 bg-ink-900 shadow-level-3 rounded-modal flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden border"
      >
        <div className="border-ink-700 flex items-center gap-2 border-b px-3 py-2">
          <Search className={`${ICON_MD} text-ink-400 shrink-0`} aria-hidden />
          <h2 id={titleId} className="text-body text-ink-100 sr-only">
            {t('globalMessageSearch.title')}
          </h2>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter' && hits[activeIndex]) {
                e.preventDefault();
                openHit(hits[activeIndex]);
              }
            }}
            placeholder={t('globalMessageSearch.placeholder')}
            aria-label={t('globalMessageSearch.placeholder')}
            className="text-body text-ink-100 placeholder:text-muted min-w-0 flex-1 bg-transparent outline-none"
          />
          {onOpenInbox ? (
            <button
              type="button"
              onClick={onOpenInbox}
              className="text-ink-400 hover:text-ink-100 hover:bg-ink-800 rounded-control p-1.5"
              aria-label={t('unifiedInbox.open')}
              title={t('unifiedInbox.open')}
            >
              <Inbox className={ICON_MD} aria-hidden />
            </button>
          ) : null}
          <button
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
            <span>{t('globalMessageSearch.protocol')}</span>
            <select
              className="border-ink-700 bg-ink-950 text-ink-100 rounded-control border px-2 py-1"
              value={protocol}
              onChange={(e) => {
                setProtocol(e.target.value as GlobalMessageSearchProtocolFilter);
              }}
              aria-label={t('globalMessageSearch.protocol')}
            >
              <option value="all">{t('globalMessageSearch.protocolAll')}</option>
              {enabledProtocols.map((p) => (
                <option key={p} value={p}>
                  {t(protocolLabelKey(p))}
                </option>
              ))}
            </select>
          </label>
          <label className="text-label text-ink-400 flex items-center gap-1.5">
            <span>{t('globalMessageSearch.direction')}</span>
            <select
              className="border-ink-700 bg-ink-950 text-ink-100 rounded-control border px-2 py-1"
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value as GlobalMessageSearchDirection);
              }}
              aria-label={t('globalMessageSearch.direction')}
            >
              <option value="all">{t('globalMessageSearch.directionAll')}</option>
              <option value="inbound">{t('globalMessageSearch.directionInbound')}</option>
              <option value="outbound">{t('globalMessageSearch.directionOutbound')}</option>
            </select>
          </label>
          <label className="text-label text-ink-400 flex min-w-[10rem] flex-1 items-center gap-1.5">
            <span className="shrink-0">{t('globalMessageSearch.sender')}</span>
            <input
              type="search"
              value={senderQuery}
              onChange={(e) => {
                setSenderQuery(e.target.value);
              }}
              placeholder={t('globalMessageSearch.senderPlaceholder')}
              aria-label={t('globalMessageSearch.sender')}
              className="border-ink-700 bg-ink-950 text-ink-100 placeholder:text-muted rounded-control min-w-0 flex-1 border px-2 py-1"
            />
          </label>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto px-1 py-1"
          role="listbox"
          aria-label={t('globalMessageSearch.results')}
        >
          {loading ? (
            <p className="text-label text-ink-400 px-3 py-4">
              {t('globalMessageSearch.searching')}
            </p>
          ) : error ? (
            <p className="text-label px-3 py-4 text-red-400" role="alert">
              {error}
            </p>
          ) : query.trim() === '' ? (
            <p className="text-label text-ink-400 px-3 py-4">{t('globalMessageSearch.hint')}</p>
          ) : hits.length === 0 ? (
            <p className="text-label text-ink-400 px-3 py-4">
              {t('globalMessageSearch.noResults')}
            </p>
          ) : (
            hits.map((hit, index) => {
              const active = index === activeIndex;
              const convo =
                hit.channel != null
                  ? t('globalMessageSearch.channel', { index: hit.channel })
                  : t('globalMessageSearch.directMessage');
              return (
                <button
                  key={`${hit.protocol}-${hit.dbId ?? hit.timestamp}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`hover:bg-sidebar-active-bg flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-start ${
                    active ? 'bg-sidebar-active-bg' : ''
                  }`}
                  onMouseEnter={() => {
                    setActiveIndex(index);
                  }}
                  onClick={() => {
                    openHit(hit);
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={`text-label font-medium ${PROTOCOL_THEME[hit.protocol].nameTextClass}`}
                    >
                      {t(protocolLabelKey(hit.protocol))}
                    </span>
                    <span className="text-2xs text-muted shrink-0">
                      {formatHitTime(hit.timestamp)}
                    </span>
                  </div>
                  <div className="text-label text-ink-300 truncate">
                    {hit.senderName}
                    <span className="text-muted"> · {convo}</span>
                  </div>
                  <div className="text-body text-ink-100 line-clamp-2">{hit.payload}</div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
