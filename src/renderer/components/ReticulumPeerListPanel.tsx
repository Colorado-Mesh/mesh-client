/* eslint-disable react-hooks/incompatible-library -- TanStack Virtual useVirtualizer; same as NodeListPanel */
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, MessageCircle, RefreshCw, Star } from 'lucide-react-motion';
import {
  memo,
  type ReactNode,
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { formatRelativeOrIsoDate } from '@/renderer/lib/formatRelativeOrIsoDate';
import { normalizeLastHeardMs } from '@/renderer/lib/nodeStatus';
import {
  registerReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';
import { parseReticulumDestinationInput } from '@/renderer/lib/reticulum/reticulumDestinationInput';
import {
  cheapReticulumPeerLabel,
  filterPreparedReticulumPeerRows,
  type PreparedReticulumPeerRow,
  prepareReticulumPeerRows,
  RETICULUM_PEER_ROW_HEIGHT_PX,
  RETICULUM_PEER_VIRTUALIZE_THRESHOLD,
  reticulumPeerLastActivityMs,
  type ReticulumPeerSortDir,
  type ReticulumPeerSortKey,
  sortPreparedReticulumPeerRows,
} from '@/renderer/lib/reticulum/reticulumPeerListRows';
import {
  formatReticulumPeerPathToast,
  formatReticulumPeerProbeToast,
  isReticulumSidecarRunning,
  probeReticulumPeer,
  requestReticulumPeerPath,
} from '@/renderer/lib/reticulum/reticulumSidecarReads';
import type { ReticulumPeer } from '@/shared/reticulum-types';

import type { ContactGroup } from '../../shared/electron-api.types';
import type { MeshNode } from '../lib/types';
import { useNomadNetworkStore } from '../stores/nomadNetworkStore';
import {
  refreshReticulumPeersFromSidecar,
  resolveReticulumPeerLabel,
  useReticulumPeerStore,
} from '../stores/reticulumPeerStore';
import { ReticulumPeerPathsDetail } from './reticulum/ReticulumPeerPathsDetail';
import { ReticulumProfileIconSlot } from './ReticulumProfileIcon';
import { useToast } from './Toast';

type PeerListTab = 'peers' | 'contacts' | 'favorites';
type SortKey = ReticulumPeerSortKey;
type SortDir = ReticulumPeerSortDir;

export interface ReticulumPeerListPanelProps {
  isConnected: boolean;
  onPeerClick: (hash: string) => void;
  onSendMessage: (nodeNum: number) => void;
  /** Forced live path-table dump (`?refresh=1`). Used by the Refresh button. */
  onRefresh?: () => Promise<void>;
  /** Soft/cached peers refresh. Used on connect when the store is still empty. */
  onSoftRefresh?: () => Promise<void>;
  onToggleFavorite?: (nodeId: number, favorited: boolean) => Promise<void>;
  /** Canonical LXMF contacts from identity-scoped nodeStore (NodeListPanel adapter). */
  contactNodes?: Map<number, MeshNode>;
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

interface PeerTableRowProps {
  prepared: PreparedReticulumPeerRow;
  activeTab: PeerListTab;
  busy: boolean;
  contacted: boolean;
  verified: boolean;
  iconName?: string | null;
  iconColor?: string | null;
  displayLabel: string;
  formatPeerActivity: (peer: ReticulumPeer) => string;
  onPeerClick: (hash: string) => void;
  onToggleFavorite: (peer: ReticulumPeer) => void;
  renderActionButtons: (peer: ReticulumPeer, busy: boolean) => ReactNode;
  t: (key: string, opts?: Record<string, string>) => string;
}

const PeerTableRow = memo(function PeerTableRow({
  prepared,
  activeTab,
  busy,
  contacted,
  verified,
  iconName,
  iconColor,
  displayLabel,
  formatPeerActivity,
  onPeerClick,
  onToggleFavorite,
  renderActionButtons,
  t,
}: PeerTableRowProps) {
  const peer = prepared.peer;
  return (
    <tr
      className="cursor-pointer border-b border-gray-800 hover:bg-gray-900/60"
      onClick={() => {
        onPeerClick(peer.destination_hash);
      }}
    >
      <td className="max-w-[10rem] truncate py-2 pr-2 pl-2 font-mono" title={peer.destination_hash}>
        <span className="inline-flex items-center gap-1.5">
          <ReticulumProfileIconSlot
            iconName={iconName}
            iconColor={iconColor}
            size={14}
            destinationHash={peer.destination_hash}
          />
          <span className="truncate">{displayLabel}</span>
          {verified ? (
            <Check
              className="text-readable-green h-3.5 w-3.5 shrink-0"
              aria-label={t('peerDetailModal.verifiedRowAria')}
            />
          ) : null}
        </span>
      </td>
      {activeTab === 'peers' ? (
        <>
          <td className="py-2 pr-2">
            <span
              className={
                contacted
                  ? 'bg-readable-green/20 text-readable-green rounded px-1.5 py-0.5 text-[10px] font-medium'
                  : 'text-muted text-[10px]'
              }
            >
              {contacted ? t('peerListPanel.contactYes') : t('peerListPanel.contactNo')}
            </span>
          </td>
          <td className="py-2 pr-2">{peer.hops ?? '—'}</td>
          <td className="py-2 pr-2 whitespace-nowrap" title={formatPeerActivity(peer)}>
            {formatPeerActivity(peer)}
          </td>
          <td className="hidden max-w-[8rem] truncate py-2 pr-2 sm:table-cell">
            {peer.interface ?? '—'}
          </td>
        </>
      ) : (
        <>
          <td className="py-2 pr-2 whitespace-nowrap" title={formatPeerActivity(peer)}>
            {formatPeerActivity(peer)}
          </td>
          <td className="py-2 pr-2">{peer.hops ?? '—'}</td>
          <td className="py-2 pr-2">
            <button
              type="button"
              className={peer.favorited ? 'text-yellow-400' : 'text-gray-500'}
              aria-label={t('peerListPanel.toggleFavorite')}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(peer);
              }}
            >
              <Star className="h-4 w-4" fill={peer.favorited ? 'currentColor' : 'none'} />
            </button>
          </td>
        </>
      )}
      <td className="py-2 pr-2 whitespace-nowrap">{renderActionButtons(peer, busy)}</td>
    </tr>
  );
});

function buildSourcePeerRows(
  activeTab: PeerListTab,
  peers: Map<string, ReticulumPeer>,
  contacts: Map<string, ReticulumPeer>,
  selectedGroupId: number | null,
  groupMemberIds: Set<number> | undefined,
): ReticulumPeer[] {
  if (activeTab === 'favorites') {
    const all = new Map<string, ReticulumPeer>();
    for (const peer of peers.values()) {
      if (peer.favorited) all.set(peer.destination_hash, peer);
    }
    for (const contact of contacts.values()) {
      if (contact.favorited) all.set(contact.destination_hash, contact);
    }
    return [...all.values()];
  }
  if (activeTab === 'contacts') {
    let rows = [...contacts.values()];
    if (selectedGroupId != null && groupMemberIds?.size) {
      rows = rows.filter((c) => groupMemberIds.has(reticulumHashToNodeId(c.destination_hash)));
    }
    return rows;
  }
  return [...peers.values()];
}

export default function ReticulumPeerListPanel({
  isConnected,
  onPeerClick,
  onSendMessage,
  onRefresh,
  onSoftRefresh,
  onToggleFavorite,
  contactNodes,
  groups = [],
  selectedGroupId = null,
  onGroupChange,
  onManageGroups,
  groupMemberIds,
  contactGroupsEnabled = false,
}: ReticulumPeerListPanelProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const peersRevision = useReticulumPeerStore((s) => s.peersRevision);
  const peersSize = useReticulumPeerStore((s) => s.peers.size);
  const contacts = useReticulumPeerStore((s) => s.contacts);
  const peerAppearanceByHash = useReticulumPeerStore((s) => s.peerAppearanceByHash);
  const isContact = useReticulumPeerStore((s) => s.isContact);
  const nomadNodes = useNomadNetworkStore((s) => s.nodes);

  const handleToggleFavorite = useCallback(
    async (peer: ReticulumPeer) => {
      const nodeId = peerHashToNodeNum(peer.destination_hash);
      const nextFavorited = !peer.favorited;
      if (onToggleFavorite) {
        await onToggleFavorite(nodeId, nextFavorited);
        return;
      }
      await useReticulumPeerStore.getState().toggleFavorite(peer.destination_hash, nextFavorited);
    },
    [onToggleFavorite],
  );

  const [activeTab, setActiveTab] = useState<PeerListTab>('peers');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [lookupInput, setLookupInput] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [refreshing, setRefreshing] = useState(false);
  const [actionBusyHash, setActionBusyHash] = useState<string | null>(null);
  const [pathsDetailHash, setPathsDetailHash] = useState<string | null>(null);
  const [sortedRows, setSortedRows] = useState<PreparedReticulumPeerRow[]>([]);
  const [verifiedHashes, setVerifiedHashes] = useState<Set<string>>(() => new Set());

  const tableScrollRef = useRef<HTMLDivElement>(null);
  const sortedRowsPrepGenRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await window.electronAPI.db.getReticulumDestinations();
        if (cancelled) return;
        const next = new Set<string>();
        for (const row of rows) {
          const r = row as {
            destination_hash?: unknown;
            verified?: unknown;
          };
          if (
            (r.verified === 1 || r.verified === true) &&
            typeof r.destination_hash === 'string' &&
            r.destination_hash
          ) {
            next.add(r.destination_hash.toLowerCase());
          }
        }
        setVerifiedHashes(next);
      } catch (err) {
        console.warn(
          '[ReticulumPeerListPanel] load verified destinations failed: ' + errLikeToLogString(err),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [peersRevision, contacts]);

  const runForcedRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (onRefresh) {
        await onRefresh();
      } else {
        await refreshReticulumPeersFromSidecar({ forceRefresh: true });
      }
    } catch (e) {
      console.warn('[ReticulumPeerListPanel] refresh ' + errLikeToLogString(e));
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  const runSoftRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (onSoftRefresh) {
        await onSoftRefresh();
      } else {
        await refreshReticulumPeersFromSidecar();
      }
    } catch (e) {
      console.warn('[ReticulumPeerListPanel] soft refresh ' + errLikeToLogString(e));
    } finally {
      setRefreshing(false);
    }
  }, [onSoftRefresh]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 250);
    return () => {
      window.clearTimeout(id);
    };
  }, [searchQuery]);

  useEffect(() => {
    if (!isConnected) return;
    // Runtime already keeps the store warm via connect/poll/patches — avoid a live dump on open.
    if (useReticulumPeerStore.getState().peers.size > 0) return;
    void runSoftRefresh();
  }, [isConnected, runSoftRefresh]);

  const resolvePeerLabel = useCallback(
    (peer: ReticulumPeer) => {
      const nodeId = reticulumHashToNodeId(peer.destination_hash);
      const nomadName = nomadNodes.get(peer.destination_hash.toLowerCase())?.display_name;
      return resolveReticulumPeerLabel(peer, contactNodes?.get(nodeId)?.long_name, nomadName);
    },
    [contactNodes, nomadNodes],
  );

  useEffect(() => {
    const gen = ++sortedRowsPrepGenRef.current;
    const run = () => {
      if (gen !== sortedRowsPrepGenRef.current) return;
      const peers = useReticulumPeerStore.getState().peers;
      const sourceRows = buildSourcePeerRows(
        activeTab,
        peers,
        contacts,
        selectedGroupId,
        groupMemberIds,
      );
      // Peers tab: cheap labels for the full prepare; overlay resolution for visible rows.
      const labelFor =
        activeTab === 'peers'
          ? (peer: ReticulumPeer) => cheapReticulumPeerLabel(peer)
          : resolvePeerLabel;
      const prepared = prepareReticulumPeerRows(sourceRows, labelFor);
      const filtered = filterPreparedReticulumPeerRows(prepared, debouncedSearchQuery);
      const sorted = sortPreparedReticulumPeerRows(filtered, sortKey, sortDir);
      if (gen !== sortedRowsPrepGenRef.current) return;
      setSortedRows(sorted);
    };
    const approxCount =
      activeTab === 'peers'
        ? peersSize
        : activeTab === 'contacts'
          ? contacts.size
          : peersSize + contacts.size;
    // Debounce large-list rebuilds under patch storms; stretch further at mega-mesh.
    const debounceMs =
      approxCount > 10_000 ? 400 : approxCount > RETICULUM_PEER_VIRTUALIZE_THRESHOLD ? 250 : 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (debounceMs > 0) {
      timer = setTimeout(() => {
        startTransition(run);
      }, debounceMs);
    } else {
      run();
    }
    return () => {
      if (timer != null) clearTimeout(timer);
    };
    // peersRevision (not Map identity) drives rebuilds when patches flush.
  }, [
    activeTab,
    contacts,
    debouncedSearchQuery,
    groupMemberIds,
    peersRevision,
    peersSize,
    resolvePeerLabel,
    selectedGroupId,
    sortDir,
    sortKey,
  ]);

  const shouldVirtualize = sortedRows.length > RETICULUM_PEER_VIRTUALIZE_THRESHOLD;
  const rowVirtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => RETICULUM_PEER_ROW_HEIGHT_PX,
    overscan: 10,
    enabled: shouldVirtualize,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  // Never fall back to mounting the full list while virtualizing (would hang at ~6k rows).
  const rowsForRender = shouldVirtualize
    ? virtualRows
    : sortedRows.map((row, index) => ({
        index,
        start: index * RETICULUM_PEER_ROW_HEIGHT_PX,
        end: (index + 1) * RETICULUM_PEER_ROW_HEIGHT_PX,
        size: RETICULUM_PEER_ROW_HEIGHT_PX,
        key: row.peer.destination_hash,
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

  const ariaSortValue = (key: SortKey): 'ascending' | 'descending' | 'none' =>
    sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';

  const requestPath = async (hash: string) => {
    setActionBusyHash(hash);
    try {
      if (!(await isReticulumSidecarRunning())) {
        addToast(t('connectionPanel.reticulumIdentity.startStackFirst'), 'error');
        return;
      }
      const result = await requestReticulumPeerPath(hash);
      const toast = formatReticulumPeerPathToast(t, result);
      addToast(toast.message, toast.variant);
      // Path results arrive via WS peers_updated patches — avoid a full dump.
    } catch (e) {
      console.warn('[ReticulumPeerListPanel] path ' + errLikeToLogString(e));
    } finally {
      setActionBusyHash(null);
    }
  };

  const probePeer = async (hash: string) => {
    setActionBusyHash(hash);
    try {
      if (!(await isReticulumSidecarRunning())) {
        addToast(t('connectionPanel.reticulumIdentity.startStackFirst'), 'error');
        return;
      }
      const result = await probeReticulumPeer(hash);
      const toast = formatReticulumPeerProbeToast(t, result);
      addToast(toast.message, toast.variant);
      if (result.ok && result.hops != null) {
        useReticulumPeerStore.getState().updatePeer(hash, { hops: result.hops });
      }
      // Probe hops applied locally; skip full path-table refresh.
    } catch (e) {
      console.warn('[ReticulumPeerListPanel] probe ' + errLikeToLogString(e));
    } finally {
      setActionBusyHash(null);
    }
  };

  const lookupByHash = async () => {
    const parsed = parseReticulumDestinationInput(lookupInput);
    if (!parsed) {
      setLookupError(t('peerListPanel.lookupInvalid'));
      return;
    }
    setLookupError(null);
    setLookupBusy(true);
    try {
      if (!(await isReticulumSidecarRunning())) {
        addToast(t('connectionPanel.reticulumIdentity.startStackFirst'), 'error');
        return;
      }
      const pathResult = await requestReticulumPeerPath(parsed);
      const pathToast = formatReticulumPeerPathToast(t, pathResult);
      addToast(pathToast.message, pathToast.variant);
      const probeResult = await probeReticulumPeer(parsed);
      const probeToast = formatReticulumPeerProbeToast(t, probeResult);
      addToast(probeToast.message, probeToast.variant);
      if (probeResult.ok && probeResult.hops != null) {
        useReticulumPeerStore.getState().updatePeer(parsed, { hops: probeResult.hops });
      }
      await refreshReticulumPeersFromSidecar();
      const peer = useReticulumPeerStore.getState().peers.get(parsed);
      if (peer) {
        setLookupInput('');
        onPeerClick(parsed);
      }
    } catch (e) {
      console.warn('[ReticulumPeerListPanel] lookup ' + errLikeToLogString(e));
    } finally {
      setLookupBusy(false);
    }
  };

  const formatPeerActivity = useCallback(
    (peer: ReticulumPeer) => {
      const ms = reticulumPeerLastActivityMs(peer);
      if (!ms) return '—';
      return formatRelativeOrIsoDate(ms, t, normalizeLastHeardMs);
    },
    [t],
  );

  const emptyKey =
    activeTab === 'contacts'
      ? 'peerListPanel.emptyContacts'
      : activeTab === 'favorites'
        ? 'peerListPanel.emptyFavorites'
        : 'peerListPanel.emptyPeers';

  const tableColSpan = activeTab === 'peers' ? 6 : 5;

  const renderActionButtons = (peer: ReticulumPeer, busy: boolean) => (
    <>
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
      <button
        type="button"
        className="ml-2 text-amber-400 hover:underline disabled:opacity-40"
        disabled={busy}
        aria-label={t('peerListPanel.pathsAria', { hash: peer.destination_hash })}
        aria-expanded={pathsDetailHash === peer.destination_hash}
        onClick={(e) => {
          e.stopPropagation();
          setPathsDetailHash((cur) =>
            cur === peer.destination_hash ? null : peer.destination_hash,
          );
        }}
      >
        {t('peerListPanel.paths')}
      </button>
    </>
  );

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
            void runForcedRefresh();
          }}
          className="flex items-center justify-center gap-1 rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-40 min-[480px]:justify-self-end"
          aria-label={t('common.refresh')}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
          {t('common.refresh')}
        </button>
      </div>

      {activeTab === 'peers' ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <input
              type="text"
              value={lookupInput}
              onChange={(e) => {
                setLookupInput(e.target.value);
                if (lookupError) setLookupError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void lookupByHash();
                }
              }}
              placeholder={t('peerListPanel.lookupPlaceholder')}
              aria-label={t('peerListPanel.lookupAria')}
              aria-invalid={lookupError != null}
              disabled={!isConnected || lookupBusy}
              className="bg-deep-black min-w-0 flex-1 rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-100 disabled:opacity-40"
            />
            <button
              type="button"
              disabled={!isConnected || lookupBusy || !lookupInput.trim()}
              onClick={() => {
                void lookupByHash();
              }}
              className="rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-40"
              aria-label={t('peerListPanel.lookupSubmitAria')}
            >
              {t('peerListPanel.lookupSubmit')}
            </button>
          </div>
          <p className="text-muted text-[11px]">{t('peerListPanel.lookupHint')}</p>
          {lookupError ? (
            <p className="text-xs text-red-400" role="alert">
              {lookupError}
            </p>
          ) : null}
        </div>
      ) : null}

      <div
        className="flex flex-wrap items-center gap-2"
        role="tablist"
        aria-label={t('peerListPanel.heading')}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'peers'}
          className={`rounded px-3 py-1 text-sm ${activeTab === 'peers' ? 'bg-readable-green text-white' : 'border border-gray-600 text-gray-300'}`}
          onClick={() => {
            setActiveTab('peers');
          }}
        >
          {t('peerListPanel.tabPeers')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'contacts'}
          className={`rounded px-3 py-1 text-sm ${activeTab === 'contacts' ? 'bg-readable-green text-white' : 'border border-gray-600 text-gray-300'}`}
          onClick={() => {
            setActiveTab('contacts');
          }}
        >
          {t('peerListPanel.tabContacts')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'favorites'}
          className={`rounded px-3 py-1 text-sm ${activeTab === 'favorites' ? 'bg-readable-green text-white' : 'border border-gray-600 text-gray-300'}`}
          onClick={() => {
            setActiveTab('favorites');
          }}
        >
          {t('peerListPanel.tabFavorites')}
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
              <th className="py-2 pr-2 pl-2" aria-sort={ariaSortValue('name')}>
                <button
                  type="button"
                  className="hover:text-gray-200"
                  aria-label={t('peerListPanel.colName')}
                  onClick={() => {
                    toggleSort('name');
                  }}
                >
                  {t('peerListPanel.colName')}
                  {sortIndicator('name')}
                </button>
              </th>
              {activeTab === 'peers' ? (
                <>
                  <th className="py-2 pr-2">{t('peerListPanel.colContact')}</th>
                  <th className="py-2 pr-2" aria-sort={ariaSortValue('hops')}>
                    <button
                      type="button"
                      className="hover:text-gray-200"
                      aria-label={t('connectionPanel.reticulumPeers.hops')}
                      onClick={() => {
                        toggleSort('hops');
                      }}
                    >
                      {t('connectionPanel.reticulumPeers.hops')}
                      {sortIndicator('hops')}
                    </button>
                  </th>
                  <th className="py-2 pr-2" aria-sort={ariaSortValue('lastSeen')}>
                    <button
                      type="button"
                      className="hover:text-gray-200"
                      aria-label={t('peerListPanel.colLastSeen')}
                      onClick={() => {
                        toggleSort('lastSeen');
                      }}
                    >
                      {t('peerListPanel.colLastSeen')}
                      {sortIndicator('lastSeen')}
                    </button>
                  </th>
                  <th
                    className="hidden py-2 pr-2 sm:table-cell"
                    aria-sort={ariaSortValue('interface')}
                  >
                    <button
                      type="button"
                      className="hover:text-gray-200"
                      aria-label={t('peerListPanel.colInterface')}
                      onClick={() => {
                        toggleSort('interface');
                      }}
                    >
                      {t('peerListPanel.colInterface')}
                      {sortIndicator('interface')}
                    </button>
                  </th>
                </>
              ) : (
                <>
                  <th className="py-2 pr-2" aria-sort={ariaSortValue('lastSeen')}>
                    <button
                      type="button"
                      className="hover:text-gray-200"
                      aria-label={t('peerListPanel.colLastHeard')}
                      onClick={() => {
                        toggleSort('lastSeen');
                      }}
                    >
                      {t('peerListPanel.colLastHeard')}
                      {sortIndicator('lastSeen')}
                    </button>
                  </th>
                  <th className="py-2 pr-2" aria-sort={ariaSortValue('hops')}>
                    <button
                      type="button"
                      className="hover:text-gray-200"
                      aria-label={t('connectionPanel.reticulumPeers.hops')}
                      onClick={() => {
                        toggleSort('hops');
                      }}
                    >
                      {t('connectionPanel.reticulumPeers.hops')}
                      {sortIndicator('hops')}
                    </button>
                  </th>
                  <th className="py-2 pr-2" aria-sort={ariaSortValue('favorite')}>
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
                </>
              )}
              <th className="py-2 pr-2">{t('connectionPanel.reticulumPeers.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {shouldVirtualize && virtualRows.length > 0 ? (
              <tr>
                <td colSpan={tableColSpan} style={{ height: virtualRows[0]?.start ?? 0 }} />
              </tr>
            ) : null}
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={tableColSpan} className="text-muted px-2 py-8 text-center text-sm">
                  {t(emptyKey)}
                </td>
              </tr>
            ) : shouldVirtualize && virtualRows.length === 0 ? (
              <tr>
                <td
                  colSpan={tableColSpan}
                  style={{
                    height:
                      rowVirtualizer.getTotalSize() ||
                      sortedRows.length * RETICULUM_PEER_ROW_HEIGHT_PX,
                  }}
                />
              </tr>
            ) : (
              rowsForRender.map((virtualRow) => {
                const prepared = sortedRows[virtualRow.index];
                if (!prepared) return null;
                const peer = prepared.peer;
                const busy = actionBusyHash === peer.destination_hash;
                const iconMeta = peerAppearanceByHash.get(peer.destination_hash.toLowerCase());
                const contacted = isContact(peer.destination_hash);
                const verified = verifiedHashes.has(peer.destination_hash.toLowerCase());
                const displayLabel =
                  activeTab === 'peers' ? resolvePeerLabel(peer) : prepared.label;
                return (
                  <PeerTableRow
                    key={peer.destination_hash}
                    prepared={prepared}
                    activeTab={activeTab}
                    busy={busy}
                    contacted={contacted}
                    verified={verified}
                    iconName={iconMeta?.icon_name}
                    iconColor={iconMeta?.icon_color}
                    displayLabel={displayLabel}
                    formatPeerActivity={formatPeerActivity}
                    onPeerClick={onPeerClick}
                    onToggleFavorite={(p) => {
                      void handleToggleFavorite(p);
                    }}
                    renderActionButtons={renderActionButtons}
                    t={t}
                  />
                );
              })
            )}
            {shouldVirtualize && virtualRows.length > 0 ? (
              <tr>
                <td
                  colSpan={tableColSpan}
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

      {pathsDetailHash ? (
        <ReticulumPeerPathsDetail
          key={pathsDetailHash}
          destinationHash={pathsDetailHash}
          onClose={() => {
            setPathsDetailHash(null);
          }}
        />
      ) : null}
    </div>
  );
}
