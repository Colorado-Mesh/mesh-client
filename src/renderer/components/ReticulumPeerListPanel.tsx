/* eslint-disable react-hooks/incompatible-library -- TanStack Virtual useVirtualizer; same as NodeListPanel */
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageCircle, RefreshCw, Star } from 'lucide-react-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { formatRelativeOrIsoDate } from '@/renderer/lib/formatRelativeOrIsoDate';
import { normalizeLastHeardMs } from '@/renderer/lib/nodeStatus';
import {
  registerReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';
import type { ReticulumContact, ReticulumPeer } from '@/shared/reticulum-types';

import type { ContactGroup } from '../../shared/electron-api.types';
import {
  refreshReticulumPeersFromSidecar,
  useReticulumPeerStore,
} from '../stores/reticulumPeerStore';

const PEER_REFRESH_MS = 30_000;

type PeerListTab = 'peers' | 'contacts';
type SortKey = 'name' | 'hops' | 'lastSeen' | 'interface' | 'favorite';
type SortDir = 'asc' | 'desc';

export interface ReticulumPeerListPanelProps {
  isConnected: boolean;
  onPeerClick: (hash: string) => void;
  onSendMessage: (nodeNum: number) => void;
  onRefresh?: () => Promise<void>;
  groups?: ContactGroup[];
  selectedGroupId?: number | null;
  onGroupChange?: (groupId: number | null) => void;
  onManageGroups?: () => void;
  groupMemberIds?: Set<number>;
  contactGroupsEnabled?: boolean;
}

function peerHashToNodeNum(hash: string): number {
  const nodeId = reticulumHashToNodeId(hash);
  registerReticulumDestinationHash(nodeId, hash);
  return nodeId;
}

function displayName(peer: ReticulumPeer): string {
  return (
    peer.custom_display_name?.trim() ||
    peer.display_name?.trim() ||
    peer.destination_hash.slice(0, 12)
  );
}

function lastActivityMs(peer: ReticulumPeer): number {
  const contact = peer as ReticulumContact;
  const ts = contact.last_heard ?? peer.last_seen ?? 0;
  return normalizeLastHeardMs(ts);
}

function comparePeers(a: ReticulumPeer, b: ReticulumPeer, key: SortKey, dir: SortDir): number {
  const sign = dir === 'asc' ? 1 : -1;
  switch (key) {
    case 'name':
      return sign * displayName(a).localeCompare(displayName(b));
    case 'hops':
      return sign * ((a.hops ?? -1) - (b.hops ?? -1));
    case 'lastSeen':
      return sign * (lastActivityMs(a) - lastActivityMs(b));
    case 'interface':
      return sign * (a.interface ?? '').localeCompare(b.interface ?? '');
    case 'favorite':
      return sign * (Number(Boolean(b.favorited)) - Number(Boolean(a.favorited)));
    default:
      return 0;
  }
}

export default function ReticulumPeerListPanel({
  isConnected,
  onPeerClick,
  onSendMessage,
  onRefresh,
  groups = [],
  selectedGroupId = null,
  onGroupChange,
  onManageGroups,
  groupMemberIds,
  contactGroupsEnabled = false,
}: ReticulumPeerListPanelProps) {
  const { t } = useTranslation();
  const peers = useReticulumPeerStore((s) => s.peers);
  const contacts = useReticulumPeerStore((s) => s.contacts);
  const getDisplayName = useReticulumPeerStore((s) => s.getDisplayName);
  const toggleFavorite = useReticulumPeerStore((s) => s.toggleFavorite);

  const [activeTab, setActiveTab] = useState<PeerListTab>('peers');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [refreshing, setRefreshing] = useState(false);
  const [actionBusyHash, setActionBusyHash] = useState<string | null>(null);

  const tableScrollRef = useRef<HTMLDivElement>(null);

  const runRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (onRefresh) {
        await onRefresh();
      } else {
        await refreshReticulumPeersFromSidecar();
      }
    } catch (e) {
      console.warn('[ReticulumPeerListPanel] refresh ' + errLikeToLogString(e));
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  useEffect(() => {
    if (!isConnected) return;
    void runRefresh();
    const id = window.setInterval(() => {
      void runRefresh();
    }, PEER_REFRESH_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [isConnected, runRefresh]);

  const sourceRows = useMemo(() => {
    if (activeTab === 'contacts') {
      let rows = [...contacts.values()];
      if (selectedGroupId != null && groupMemberIds?.size) {
        rows = rows.filter((c) => groupMemberIds.has(reticulumHashToNodeId(c.destination_hash)));
      }
      return rows;
    }
    return [...peers.values()];
  }, [activeTab, contacts, peers, selectedGroupId, groupMemberIds]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sourceRows;
    return sourceRows.filter((peer) => {
      const name = displayName(peer).toLowerCase();
      const hash = peer.destination_hash.toLowerCase();
      return name.includes(q) || hash.includes(q);
    });
  }, [searchQuery, sourceRows]);

  const sortedRows = useMemo(() => {
    const rows = [...filteredRows];
    rows.sort((a, b) => comparePeers(a, b, sortKey, sortDir));
    return rows;
  }, [filteredRows, sortKey, sortDir]);

  const shouldVirtualize = sortedRows.length > 100;
  const rowVirtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => 44,
    overscan: 10,
    enabled: shouldVirtualize,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const rowsForRender =
    shouldVirtualize && virtualRows.length > 0
      ? virtualRows
      : sortedRows.map((peer, index) => ({
          index,
          start: index * 44,
          end: (index + 1) * 44,
          size: 44,
          key: peer.destination_hash,
          lane: 0 as const,
        }));

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const requestPath = async (hash: string) => {
    setActionBusyHash(hash);
    try {
      await window.electronAPI.reticulum.proxyPost(`/api/v1/peers/${hash}/path`, {});
    } catch (e) {
      console.warn('[ReticulumPeerListPanel] path ' + errLikeToLogString(e));
    } finally {
      setActionBusyHash(null);
    }
  };

  const probePeer = async (hash: string) => {
    setActionBusyHash(hash);
    try {
      await window.electronAPI.reticulum.proxyPost(`/api/v1/peers/${hash}/probe`, {});
    } catch (e) {
      console.warn('[ReticulumPeerListPanel] probe ' + errLikeToLogString(e));
    } finally {
      setActionBusyHash(null);
    }
  };

  const formatTime = (peer: ReticulumPeer) => {
    const ms = lastActivityMs(peer);
    if (!ms) return '—';
    return formatRelativeOrIsoDate(ms, t, normalizeLastHeardMs);
  };

  const emptyKey =
    activeTab === 'contacts' ? 'peerListPanel.emptyContacts' : 'peerListPanel.emptyPeers';

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="grid grid-cols-1 items-center gap-3 min-[480px]:grid-cols-[1fr_auto_1fr]">
        <h2 className="text-bright-green text-lg font-semibold min-[480px]:justify-self-start">
          {t('peerListPanel.heading')} ({sortedRows.length})
        </h2>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
          }}
          placeholder={t('peerListPanel.searchPlaceholder')}
          aria-label={t('peerListPanel.searchAria')}
          className="bg-deep-black w-full min-w-0 rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-100 min-[480px]:w-64 min-[480px]:justify-self-center"
        />
        <button
          type="button"
          disabled={!isConnected || refreshing}
          onClick={() => {
            void runRefresh();
          }}
          className="flex items-center justify-center gap-1 rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-40 min-[480px]:justify-self-end"
          aria-label={t('common.refresh')}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
          {t('common.refresh')}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`rounded px-3 py-1 text-sm ${activeTab === 'peers' ? 'bg-readable-green text-white' : 'border border-gray-600 text-gray-300'}`}
          onClick={() => {
            setActiveTab('peers');
          }}
        >
          {t('peerListPanel.tabPeers')}
        </button>
        <button
          type="button"
          className={`rounded px-3 py-1 text-sm ${activeTab === 'contacts' ? 'bg-readable-green text-white' : 'border border-gray-600 text-gray-300'}`}
          onClick={() => {
            setActiveTab('contacts');
          }}
        >
          {t('peerListPanel.tabContacts')}
        </button>
        {contactGroupsEnabled && activeTab === 'contacts' && onGroupChange ? (
          <>
            <select
              value={selectedGroupId ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                onGroupChange(v ? Number(v) : null);
              }}
              className="bg-deep-black rounded border border-gray-600 px-2 py-1 text-sm text-gray-200"
              aria-label={t('peerListPanel.groupFilterAria')}
            >
              <option value="">{t('peerListPanel.allGroups')}</option>
              {groups.map((g) => (
                <option key={g.group_id} value={g.group_id}>
                  {g.name}
                </option>
              ))}
            </select>
            {onManageGroups ? (
              <button
                type="button"
                className="text-sm text-amber-400 hover:underline"
                onClick={onManageGroups}
              >
                {t('peerListPanel.manageGroups')}
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      <div
        ref={tableScrollRef}
        className="min-h-0 flex-1 overflow-auto rounded border border-gray-700"
      >
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="bg-deep-black sticky top-0 z-10">
            <tr className="text-muted border-b border-gray-700">
              <th className="py-2 pr-2 pl-2">
                <button
                  type="button"
                  className="hover:text-gray-200"
                  onClick={() => {
                    toggleSort('name');
                  }}
                >
                  {t('peerListPanel.colName')}
                  {sortIndicator('name')}
                </button>
              </th>
              <th className="py-2 pr-2">
                <button
                  type="button"
                  className="hover:text-gray-200"
                  onClick={() => {
                    toggleSort('hops');
                  }}
                >
                  {t('connectionPanel.reticulumPeers.hops')}
                  {sortIndicator('hops')}
                </button>
              </th>
              <th className="py-2 pr-2">
                <button
                  type="button"
                  className="hover:text-gray-200"
                  onClick={() => {
                    toggleSort('lastSeen');
                  }}
                >
                  {t('peerListPanel.colLastSeen')}
                  {sortIndicator('lastSeen')}
                </button>
              </th>
              <th className="hidden py-2 pr-2 sm:table-cell">
                <button
                  type="button"
                  className="hover:text-gray-200"
                  onClick={() => {
                    toggleSort('interface');
                  }}
                >
                  {t('peerListPanel.colInterface')}
                  {sortIndicator('interface')}
                </button>
              </th>
              <th className="py-2 pr-2">
                <button
                  type="button"
                  className="hover:text-gray-200"
                  onClick={() => {
                    toggleSort('favorite');
                  }}
                  aria-label={t('peerListPanel.colFavorite')}
                >
                  ★{sortIndicator('favorite')}
                </button>
              </th>
              <th className="py-2 pr-2">{t('connectionPanel.reticulumPeers.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {shouldVirtualize && virtualRows.length > 0 ? (
              <tr>
                <td colSpan={6} style={{ height: virtualRows[0]?.start ?? 0 }} />
              </tr>
            ) : null}
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-muted px-2 py-8 text-center text-sm">
                  {t(emptyKey)}
                </td>
              </tr>
            ) : (
              rowsForRender.map((virtualRow) => {
                const peer = sortedRows[virtualRow.index];
                if (!peer) return null;
                const busy = actionBusyHash === peer.destination_hash;
                const label = getDisplayName(peer);
                return (
                  <tr
                    key={peer.destination_hash}
                    ref={shouldVirtualize ? rowVirtualizer.measureElement : undefined}
                    data-index={virtualRow.index}
                    className="cursor-pointer border-b border-gray-800 hover:bg-gray-900/60"
                    onClick={() => {
                      onPeerClick(peer.destination_hash);
                    }}
                  >
                    <td className="max-w-[10rem] truncate py-2 pr-2 pl-2 font-mono" title={label}>
                      {label}
                    </td>
                    <td className="py-2 pr-2">{peer.hops ?? '—'}</td>
                    <td className="py-2 pr-2 whitespace-nowrap" title={formatTime(peer)}>
                      {formatTime(peer)}
                    </td>
                    <td className="hidden max-w-[8rem] truncate py-2 pr-2 sm:table-cell">
                      {peer.interface ?? '—'}
                    </td>
                    <td className="py-2 pr-2">
                      <button
                        type="button"
                        className={peer.favorited ? 'text-yellow-400' : 'text-gray-500'}
                        aria-label={t('peerListPanel.toggleFavorite')}
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleFavorite(peer.destination_hash, !peer.favorited);
                        }}
                      >
                        <Star className="h-4 w-4" fill={peer.favorited ? 'currentColor' : 'none'} />
                      </button>
                    </td>
                    <td className="py-2 pr-2 whitespace-nowrap">
                      <button
                        type="button"
                        className="text-amber-400 hover:underline disabled:opacity-40"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSendMessage(peerHashToNodeNum(peer.destination_hash));
                        }}
                        aria-label={t('peerListPanel.openChat')}
                      >
                        <MessageCircle className="inline h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="ml-2 text-amber-400 hover:underline disabled:opacity-40"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void requestPath(peer.destination_hash);
                        }}
                      >
                        {t('connectionPanel.reticulumPeers.path')}
                      </button>
                      <button
                        type="button"
                        className="ml-2 text-amber-400 hover:underline disabled:opacity-40"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void probePeer(peer.destination_hash);
                        }}
                      >
                        {t('connectionPanel.reticulumPeers.probe')}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
            {shouldVirtualize && virtualRows.length > 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    height:
                      rowVirtualizer.getTotalSize() -
                      (virtualRows[virtualRows.length - 1]?.end ?? 0),
                  }}
                />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
