/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity */
import { useEffect, useMemo, useState } from 'react';

import type { ContactGroup } from '../../shared/electron-api.types';
import type { LocationFilter } from '../App';
import { formatCoordColumns } from '../lib/coordUtils';
import { getRoutingRowForNode } from '../lib/diagnostics/diagnosticRows';
import { snrMeaningfulForNodeDiagnostics } from '../lib/diagnostics/snrMeaningfulForNodeDiagnostics';
import {
  MESHTASTIC_BUILTIN_CONTACT_GROUP_FILTERS,
  MESHTASTIC_CONTACT_GROUP_BUILTIN_GPS,
  MESHTASTIC_CONTACT_GROUP_BUILTIN_RF_MQTT,
  MESHTASTIC_CONTACT_GROUP_BUILTIN_ROUTER,
  meshtasticContactGroupMatchesBuiltinGps,
  meshtasticContactGroupMatchesBuiltinRfMqtt,
  meshtasticContactGroupMatchesBuiltinRouter,
} from '../lib/meshtasticContactGroupUtils';
import {
  MeshtasticHybridPathIcons,
  meshtasticNodeShowsHybridMqttPath,
} from '../lib/meshtasticSourceIcons';
import { getNodeTypeIcon } from '../lib/nodeIcons';
import { getNodeStatus, haversineDistanceKm, normalizeLastHeardMs } from '../lib/nodeStatus';
import { useRadioProvider } from '../lib/radio/providerFactory';
import { RoleDisplay } from '../lib/roleInfo';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '../lib/timeConstants';
import type { MeshNode } from '../lib/types';
import { useCoordFormatStore } from '../stores/coordFormatStore';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';
import SignalBars from './SignalBars';
import { useToast } from './Toast';

interface ImportContactsResult {
  imported: number;
  skipped: number;
  errors: string[];
}

type SortField =
  | 'node_id'
  | 'long_name'
  | 'short_name'
  | 'rssi'
  | 'snr'
  | 'battery'
  | 'last_heard'
  | 'latitude'
  | 'longitude'
  | 'role'
  | 'hw_model'
  | 'hops_away'
  | 'via_mqtt'
  | 'voltage'
  | 'channel_utilization'
  | 'air_util_tx'
  | 'altitude'
  | 'redundancy';

const BUILTIN_TYPE_FILTERS = [
  { group_id: -1, label: 'Chat', hw_model: 'Chat' },
  { group_id: -2, label: 'Repeater', hw_model: 'Repeater' },
  { group_id: -3, label: 'Room', hw_model: 'Room' },
] as const;

/** Sort fields that do not apply when the Nodes table is in MeshCore (contacts) layout. */
const MESHCORE_INAPPLICABLE_SORT_FIELDS: readonly SortField[] = [
  'short_name',
  'role',
  'via_mqtt',
  'rssi',
  'snr',
  'voltage',
  'channel_utilization',
  'air_util_tx',
  'altitude',
  'redundancy',
];

function SortIcon({
  field,
  sortField,
  sortAsc,
}: {
  field: SortField;
  sortField: SortField;
  sortAsc: boolean;
}) {
  if (sortField !== field) {
    return (
      <svg
        className="ml-1 inline h-3 w-3 text-gray-600"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
        />
      </svg>
    );
  }
  return (
    <svg
      className="text-bright-green ml-1 inline h-3 w-3"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d={sortAsc ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'}
      />
    </svg>
  );
}

interface Props {
  nodes: Map<number, MeshNode>;
  myNodeNum: number;
  onNodeClick: (node: MeshNode) => void;
  mqttConnected?: boolean;
  locationFilter: LocationFilter;
  onToggleFavorite: (nodeId: number, favorited: boolean) => void;
  mode?: 'meshtastic' | 'meshcore';
  groups?: ContactGroup[];
  selectedGroupId?: number | null;
  onGroupChange?: (id: number | null) => void;
  onManageGroups?: () => void;
  groupMemberIds?: Set<number>;
  onImportContacts?: () => Promise<ImportContactsResult>;
  /** When false, hide contact-group filter UI even if onManageGroups is set */
  contactGroupsEnabled?: boolean;
  /** MeshCore: show Refresh button on Contacts tab (paired with onRefreshContacts) */
  meshcoreShowRefreshControl?: boolean;
  onRefreshContacts?: () => Promise<void>;
  /** MeshCore: flood advert (same as Radio panel Device Actions). */
  onSendAdvert?: () => Promise<void>;
  /** When false, Flood Advert is disabled (radio not operational). Ignored if onSendAdvert is unset. */
  meshcoreRadioOperational?: boolean;
  meshcoreShowPublicKeys?: boolean;
  meshcorePublicKeyHexByNodeId?: Map<number, string>;
}

export default function NodeListPanel({
  nodes,
  myNodeNum,
  onNodeClick,
  mqttConnected = false,
  locationFilter,
  onToggleFavorite,
  mode = 'meshtastic',
  groups,
  selectedGroupId,
  onGroupChange,
  onManageGroups,
  groupMemberIds,
  onImportContacts,
  contactGroupsEnabled = true,
  meshcoreShowRefreshControl = false,
  onRefreshContacts,
  onSendAdvert,
  meshcoreRadioOperational = true,
  meshcoreShowPublicKeys = false,
  meshcorePublicKeyHexByNodeId,
}: Props) {
  const { addToast } = useToast();
  const { nodeStaleThresholdMs, nodeOfflineThresholdMs } = useRadioProvider(mode);
  const coordinateFormat = useCoordFormatStore((s) => s.coordinateFormat);
  const diagnosticRows = useDiagnosticsStore((s) => s.diagnosticRows);
  const ignoreMqttEnabled = useDiagnosticsStore((s) => s.ignoreMqttEnabled);
  const nodeRedundancy = useDiagnosticsStore((s) => s.nodeRedundancy);
  const [sortField, setSortField] = useState<SortField>('last_heard');
  const [sortAsc, setSortAsc] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [advertLoading, setAdvertLoading] = useState(false);

  useEffect(() => {
    if (mode === 'meshcore' && MESHCORE_INAPPLICABLE_SORT_FIELDS.includes(sortField)) {
      setSortField('last_heard');
      setSortAsc(false);
    }
  }, [mode, sortField]);
  const handleRefreshContacts = async () => {
    if (!onRefreshContacts) return;
    setRefreshLoading(true);
    try {
      await onRefreshContacts();
      addToast('Contacts refreshed.', 'success');
    } catch (e) {
      console.warn('[NodeListPanel] refresh failed:', e instanceof Error ? e.message : e);
      addToast(`Refresh failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setRefreshLoading(false);
    }
  };

  const handleImport = async () => {
    if (!onImportContacts) return;
    setImportLoading(true);
    try {
      const result = await onImportContacts();
      if (result.imported === 0 && result.skipped === 0 && result.errors.length === 0) return;
      const msg =
        result.errors.length > 0
          ? `Imported ${result.imported}, skipped ${result.skipped}. Errors: ${result.errors.slice(0, 3).join('; ')}`
          : `Imported ${result.imported} contact${result.imported !== 1 ? 's' : ''}${result.skipped > 0 ? `, skipped ${result.skipped}` : ''}.`;
      addToast(msg, result.errors.length > 0 ? 'error' : 'success');
    } catch (e) {
      console.warn('[NodeListPanel] import failed:', e instanceof Error ? e.message : e);
      addToast(`Import failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setImportLoading(false);
    }
  };

  const handleSendAdvert = async () => {
    if (!onSendAdvert) return;
    setAdvertLoading(true);
    try {
      await onSendAdvert();
      addToast('Flood advert sent', 'success');
    } catch (e) {
      console.warn('[NodeListPanel] sendAdvert failed:', e instanceof Error ? e.message : e);
      addToast(`Advert failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setAdvertLoading(false);
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(field === 'long_name' || field === 'short_name' || field === 'hw_model'); // text asc, numbers desc
    }
  };

  const nodeList = useMemo(() => {
    let list = Array.from(nodes.values());

    // Filter by search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (n) =>
          n.long_name.toLowerCase().includes(q) ||
          n.short_name.toLowerCase().includes(q) ||
          n.hw_model?.toLowerCase().includes(q) ||
          n.node_id.toString(16).includes(q),
      );
    }

    // Filter by group membership or built-in filters (MeshCore: contact type; Meshtastic: GPS / RF+MQTT)
    if (selectedGroupId != null) {
      if (mode === 'meshcore') {
        if (selectedGroupId < 0) {
          const typeFilter = BUILTIN_TYPE_FILTERS.find((f) => f.group_id === selectedGroupId);
          if (typeFilter) list = list.filter((n) => n.hw_model === typeFilter.hw_model);
        } else if (groupMemberIds) {
          list = list.filter((n) => groupMemberIds.has(n.node_id));
        }
      } else if (mode === 'meshtastic') {
        if (selectedGroupId === MESHTASTIC_CONTACT_GROUP_BUILTIN_GPS) {
          list = list.filter((n) => meshtasticContactGroupMatchesBuiltinGps(n, myNodeNum));
        } else if (selectedGroupId === MESHTASTIC_CONTACT_GROUP_BUILTIN_RF_MQTT) {
          list = list.filter((n) => meshtasticContactGroupMatchesBuiltinRfMqtt(n, myNodeNum));
        } else if (selectedGroupId === MESHTASTIC_CONTACT_GROUP_BUILTIN_ROUTER) {
          list = list.filter((n) => meshtasticContactGroupMatchesBuiltinRouter(n, myNodeNum));
        } else if (selectedGroupId > 0 && groupMemberIds) {
          list = list.filter((n) => groupMemberIds.has(n.node_id));
        }
      }
    }

    // Filter MQTT-only nodes
    if (locationFilter.hideMqttOnly) {
      list = list.filter((n) => !n.heard_via_mqtt_only);
    }

    // Filter by distance
    if (locationFilter.enabled) {
      const homeNode = myNodeNum ? nodes.get(myNodeNum) : undefined;
      const homeHasLocation =
        homeNode?.latitude != null &&
        homeNode.latitude !== 0 &&
        homeNode.longitude != null &&
        homeNode.longitude !== 0;
      if (homeHasLocation) {
        const maxKm =
          locationFilter.unit === 'miles'
            ? locationFilter.maxDistance * 1.60934
            : locationFilter.maxDistance;
        list = list.filter((n) => {
          if (n.node_id === myNodeNum) return true;
          // Nodes without GPS can't be distance-filtered — keep them visible
          if (n.latitude == null || n.longitude == null) return true;
          const d = haversineDistanceKm(
            homeNode.latitude!,
            homeNode.longitude!,
            n.latitude,
            n.longitude,
          );
          return d <= maxKm;
        });
      }
    }

    // Sort
    list.sort((a, b) => {
      // Self-node always first
      if (a.node_id === myNodeNum) return -1;
      if (b.node_id === myNodeNum) return 1;
      // Favorites pinned above non-favorites
      const aFav = a.favorited ? 1 : 0;
      const bFav = b.favorited ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav;
      // Regular field sort
      let cmp = 0;
      switch (sortField) {
        case 'node_id':
          cmp = a.node_id - b.node_id;
          break;
        case 'long_name':
          cmp = (a.long_name || '').localeCompare(b.long_name || '');
          break;
        case 'short_name':
          cmp = (a.short_name || '').localeCompare(b.short_name || '');
          break;
        case 'rssi':
          cmp = (a.rssi ?? -999) - (b.rssi ?? -999);
          break;
        case 'snr':
          cmp = (a.snr ?? -999) - (b.snr ?? -999);
          break;
        case 'battery':
          cmp = (a.battery || 0) - (b.battery || 0);
          break;
        case 'last_heard':
          cmp = (a.last_heard || 0) - (b.last_heard || 0);
          break;
        case 'latitude':
          cmp = (a.latitude || 0) - (b.latitude || 0);
          break;
        case 'longitude':
          cmp = (a.longitude || 0) - (b.longitude || 0);
          break;
        case 'role':
          cmp = (a.role ?? 999) - (b.role ?? 999);
          break;
        case 'hw_model':
          cmp = (a.hw_model || '').localeCompare(b.hw_model || '');
          break;
        case 'hops_away':
          cmp = (a.hops_away ?? 999) - (b.hops_away ?? 999);
          break;
        case 'via_mqtt': {
          const aVal = a.heard_via_mqtt_only ? 2 : a.via_mqtt ? 1 : 0;
          const bVal = b.heard_via_mqtt_only ? 2 : b.via_mqtt ? 1 : 0;
          cmp = aVal - bVal;
          break;
        }
        case 'voltage':
          cmp = (a.voltage ?? 0) - (b.voltage ?? 0);
          break;
        case 'channel_utilization':
          cmp = (a.channel_utilization ?? 0) - (b.channel_utilization ?? 0);
          break;
        case 'air_util_tx':
          cmp = (a.air_util_tx ?? 0) - (b.air_util_tx ?? 0);
          break;
        case 'altitude':
          cmp = (a.altitude ?? 0) - (b.altitude ?? 0);
          break;
        case 'redundancy': {
          const aRed = nodeRedundancy.get(a.node_id)?.maxPaths ?? 1;
          const bRed = nodeRedundancy.get(b.node_id)?.maxPaths ?? 1;
          cmp = aRed - bRed;
          break;
        }
      }
      return sortAsc ? cmp : -cmp;
    });

    return list;
  }, [
    nodes,
    sortField,
    sortAsc,
    searchQuery,
    myNodeNum,
    locationFilter,
    nodeRedundancy,
    mode,
    selectedGroupId,
    groupMemberIds,
  ]);

  const filterStatus = useMemo(() => {
    if (!locationFilter.enabled) return null;
    const homeNode = myNodeNum ? nodes.get(myNodeNum) : undefined;
    const homeHasLocation =
      homeNode?.latitude != null &&
      homeNode.latitude !== 0 &&
      homeNode.longitude != null &&
      homeNode.longitude !== 0;
    if (!homeHasLocation) return 'no-gps';
    const totalWithGps = Array.from(nodes.values()).filter(
      (n) => n.node_id !== myNodeNum && (n.latitude || n.longitude),
    ).length;
    const visibleWithGps = nodeList.filter(
      (n) => n.node_id !== myNodeNum && (n.latitude || n.longitude),
    ).length;
    return { hidden: totalWithGps - visibleWithGps };
  }, [locationFilter, myNodeNum, nodes, nodeList]);
  const totalNodeCount = nodes.size;
  const visibleNodeCount = nodeList.length;
  const headerCountLabel =
    visibleNodeCount === totalNodeCount
      ? `${visibleNodeCount}`
      : `${visibleNodeCount} of ${totalNodeCount}`;

  function formatTime(ts: number): string {
    if (!ts) return 'Never';
    const normalizedTs = normalizeLastHeardMs(ts);
    const diff = Date.now() - normalizedTs;
    if (diff < MS_PER_MINUTE) return 'Just now';
    if (diff < MS_PER_HOUR) return `${Math.floor(diff / MS_PER_MINUTE)}m ago`;
    if (diff < MS_PER_DAY) return `${Math.floor(diff / MS_PER_HOUR)}h ago`;
    return new Date(normalizedTs).toLocaleDateString();
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* 1fr | auto | 1fr keeps the search visually centered on wide screens (matches MeshCore’s title | search | import row). */}
      <div className="grid grid-cols-1 items-center gap-3 min-[480px]:grid-cols-[1fr_auto_1fr]">
        <h2 className="text-bright-green text-lg font-semibold min-[480px]:justify-self-start">
          {mode === 'meshcore' ? 'Contacts' : 'Node Database'} ({headerCountLabel})
        </h2>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
          }}
          placeholder={mode === 'meshcore' ? 'Search contacts…' : 'Search nodes…'}
          aria-label={mode === 'meshcore' ? 'Search contacts' : 'Search nodes'}
          className="bg-secondary-dark/80 focus:border-brand-green/50 w-full max-w-[20rem] min-w-[8rem] rounded-lg border border-gray-600/50 px-3 py-1.5 text-sm text-gray-200 focus:outline-none min-[480px]:justify-self-center"
        />
        <div className="flex flex-wrap justify-stretch gap-2 min-[480px]:justify-end">
          {mode === 'meshcore' && meshcoreShowRefreshControl && onRefreshContacts ? (
            <button
              type="button"
              onClick={() => {
                void handleRefreshContacts();
              }}
              disabled={refreshLoading}
              aria-label="Refresh contacts from radio"
              className="flex w-full items-center justify-center gap-2 rounded border border-purple-600 px-3 py-1.5 text-sm font-medium text-purple-400 transition-colors hover:bg-purple-900/30 hover:text-purple-300 disabled:opacity-50 min-[480px]:w-auto"
            >
              {refreshLoading ? (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border border-purple-400 border-t-transparent" />
              ) : null}
              Refresh
            </button>
          ) : null}
          {mode === 'meshcore' && onSendAdvert ? (
            <button
              type="button"
              onClick={() => {
                void handleSendAdvert();
              }}
              disabled={!meshcoreRadioOperational || advertLoading}
              aria-label="Send flood advert"
              className="bg-brand-green/20 text-brand-green border-brand-green/30 hover:bg-brand-green/30 flex w-full items-center justify-center gap-2 rounded border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 min-[480px]:w-auto"
            >
              {advertLoading ? (
                <span className="border-brand-green inline-block h-3 w-3 animate-spin rounded-full border border-t-transparent" />
              ) : null}
              Flood Advert
            </button>
          ) : null}
          {mode === 'meshcore' && onImportContacts ? (
            <button
              onClick={handleImport}
              disabled={importLoading}
              className="bg-brand-green/20 text-brand-green border-brand-green/30 hover:bg-brand-green/30 flex w-full items-center justify-center gap-2 rounded border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 min-[480px]:w-auto"
            >
              {importLoading ? (
                <span className="border-brand-green inline-block h-3 w-3 animate-spin rounded-full border border-t-transparent" />
              ) : null}
              Import Contacts
            </button>
          ) : (
            <div className="hidden min-w-0 min-[480px]:block" aria-hidden />
          )}
        </div>
      </div>
      {mode === 'meshcore' && (
        <p className="max-w-2xl text-xs text-gray-500">
          Imported contacts use the import time as Last heard until an RF advert or Ping / Status
          updates it.
        </p>
      )}

      {/* Group filter (MeshCore + Meshtastic when contactGroupsEnabled) */}
      {contactGroupsEnabled && onManageGroups && (
        <div className="flex shrink-0 items-center gap-2">
          <select
            value={selectedGroupId ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              onGroupChange?.(val === '' ? null : Number(val));
            }}
            aria-label="Filter by contact group"
            className="bg-secondary-dark/80 focus:border-brand-green/50 flex-1 rounded-lg border border-gray-600/50 px-3 py-1.5 text-sm text-gray-200 focus:outline-none"
          >
            <option value="">{mode === 'meshcore' ? 'All contacts' : 'All nodes'}</option>
            {mode === 'meshcore'
              ? BUILTIN_TYPE_FILTERS.map((f) => (
                  <option key={f.group_id} value={f.group_id}>
                    Type: {f.label}
                  </option>
                ))
              : MESHTASTIC_BUILTIN_CONTACT_GROUP_FILTERS.map((f) => (
                  <option key={f.group_id} value={f.group_id}>
                    {f.label}
                  </option>
                ))}
            {groups?.map((g) => (
              <option key={g.group_id} value={g.group_id}>
                Group: {g.name} ({g.member_count})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onManageGroups}
            aria-label="Manage contact groups"
            title="Manage groups"
            className="hover:bg-secondary-dark text-muted shrink-0 rounded-lg p-1.5 transition-colors hover:text-gray-200"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Distance filter status */}
      {filterStatus === 'no-gps' && (
        <div className="shrink-0 rounded-lg border border-yellow-700 bg-yellow-900/30 px-3 py-2 text-xs text-yellow-300">
          Distance filter is enabled but your device has no GPS fix — all nodes are shown.
        </div>
      )}
      {filterStatus !== null && filterStatus !== 'no-gps' && filterStatus.hidden > 0 && (
        <div className="bg-brand-green/10 border-brand-green/30 text-brand-green shrink-0 rounded-lg border px-3 py-2 text-xs">
          Distance filter active — {filterStatus.hidden} node{filterStatus.hidden !== 1 ? 's' : ''}{' '}
          hidden beyond {locationFilter.maxDistance} {locationFilter.unit}.
        </div>
      )}

      {/* Online / Stale / Offline summary */}
      <div className="text-muted flex shrink-0 gap-3 text-xs">
        <span className="flex items-center gap-1">
          <span className="bg-brand-green inline-block h-2 w-2 rounded-full" />
          {
            nodeList.filter(
              (n) =>
                getNodeStatus(n.last_heard, nodeStaleThresholdMs, nodeOfflineThresholdMs) ===
                'online',
            ).length
          }{' '}
          online
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-violet-900" />
          {
            nodeList.filter(
              (n) =>
                getNodeStatus(n.last_heard, nodeStaleThresholdMs, nodeOfflineThresholdMs) ===
                'stale',
            ).length
          }{' '}
          stale
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-slate-700" />
          {
            nodeList.filter(
              (n) =>
                getNodeStatus(n.last_heard, nodeStaleThresholdMs, nodeOfflineThresholdMs) ===
                'offline',
            ).length
          }{' '}
          offline
        </span>
      </div>

      <div className="min-h-0 min-w-0 flex-1">
        <table
          style={{ minWidth: mode === 'meshcore' ? '1000px' : '1600px' }}
          className="text-sm whitespace-nowrap"
        >
          <caption className="sr-only">Connected mesh nodes</caption>
          <thead>
            <tr className="bg-deep-black text-muted sticky top-0 z-10 text-left whitespace-nowrap">
              <th scope="col" className="w-8 px-3 py-2">
                <span className="sr-only">Status</span>
              </th>
              <th scope="col" className="w-6 px-2 py-2" title="Favorites">
                <span className="sr-only">Favorite</span>
              </th>
              <th
                scope="col"
                aria-sort={
                  sortField === 'node_id' ? (sortAsc ? 'ascending' : 'descending') : 'none'
                }
                className="cursor-pointer px-3 py-2 transition-colors select-none hover:text-gray-200"
                onClick={() => {
                  handleSort('node_id');
                }}
              >
                ID <SortIcon field="node_id" sortField={sortField} sortAsc={sortAsc} />
              </th>
              <th
                scope="col"
                aria-sort={
                  sortField === 'long_name' ? (sortAsc ? 'ascending' : 'descending') : 'none'
                }
                className="cursor-pointer px-3 py-2 transition-colors select-none hover:text-gray-200"
                onClick={() => {
                  handleSort('long_name');
                }}
              >
                Long Name <SortIcon field="long_name" sortField={sortField} sortAsc={sortAsc} />
              </th>
              {mode !== 'meshcore' && (
                <th
                  scope="col"
                  aria-sort={
                    sortField === 'short_name' ? (sortAsc ? 'ascending' : 'descending') : 'none'
                  }
                  className="cursor-pointer px-3 py-2 transition-colors select-none hover:text-gray-200"
                  onClick={() => {
                    handleSort('short_name');
                  }}
                >
                  Short <SortIcon field="short_name" sortField={sortField} sortAsc={sortAsc} />
                </th>
              )}
              <th
                scope="col"
                aria-sort={
                  sortField === 'last_heard' ? (sortAsc ? 'ascending' : 'descending') : 'none'
                }
                className="cursor-pointer px-3 py-2 transition-colors select-none hover:text-gray-200"
                onClick={() => {
                  handleSort('last_heard');
                }}
              >
                Last Heard <SortIcon field="last_heard" sortField={sortField} sortAsc={sortAsc} />
              </th>
              {mode === 'meshcore' ? (
                <th
                  scope="col"
                  aria-sort={
                    sortField === 'hw_model' ? (sortAsc ? 'ascending' : 'descending') : 'none'
                  }
                  className="cursor-pointer px-3 py-2 transition-colors select-none hover:text-gray-200"
                  onClick={() => {
                    handleSort('hw_model');
                  }}
                  title="MeshCore contact / advert type"
                >
                  Type <SortIcon field="hw_model" sortField={sortField} sortAsc={sortAsc} />
                </th>
              ) : (
                <th
                  scope="col"
                  aria-sort={sortField === 'role' ? (sortAsc ? 'ascending' : 'descending') : 'none'}
                  className="cursor-pointer px-3 py-2 transition-colors select-none hover:text-gray-200"
                  onClick={() => {
                    handleSort('role');
                  }}
                >
                  Role <SortIcon field="role" sortField={sortField} sortAsc={sortAsc} />
                </th>
              )}
              <th
                scope="col"
                aria-sort={
                  sortField === 'hops_away' ? (sortAsc ? 'ascending' : 'descending') : 'none'
                }
                className="cursor-pointer px-3 py-2 text-right transition-colors select-none hover:text-gray-200"
                onClick={() => {
                  handleSort('hops_away');
                }}
              >
                Hops <SortIcon field="hops_away" sortField={sortField} sortAsc={sortAsc} />
              </th>
              {mode !== 'meshcore' && (
                <th
                  scope="col"
                  aria-sort={
                    sortField === 'via_mqtt' ? (sortAsc ? 'ascending' : 'descending') : 'none'
                  }
                  className="cursor-pointer px-3 py-2 text-center transition-colors select-none hover:text-gray-200"
                  onClick={() => {
                    handleSort('via_mqtt');
                  }}
                >
                  MQTT <SortIcon field="via_mqtt" sortField={sortField} sortAsc={sortAsc} />
                </th>
              )}
              <th
                scope="col"
                aria-sort={
                  sortField === 'latitude' ? (sortAsc ? 'ascending' : 'descending') : 'none'
                }
                className="cursor-pointer px-3 py-2 text-right transition-colors select-none hover:text-gray-200"
                onClick={() => {
                  handleSort('latitude');
                }}
              >
                {coordinateFormat === 'mgrs' ? 'MGRS' : 'Lat'}{' '}
                <SortIcon field="latitude" sortField={sortField} sortAsc={sortAsc} />
              </th>
              {coordinateFormat !== 'mgrs' && (
                <th
                  scope="col"
                  aria-sort={
                    sortField === 'longitude' ? (sortAsc ? 'ascending' : 'descending') : 'none'
                  }
                  className="cursor-pointer px-3 py-2 text-right transition-colors select-none hover:text-gray-200"
                  onClick={() => {
                    handleSort('longitude');
                  }}
                >
                  Lon <SortIcon field="longitude" sortField={sortField} sortAsc={sortAsc} />
                </th>
              )}
              {mode !== 'meshcore' && (
                <>
                  <th
                    scope="col"
                    aria-sort={
                      sortField === 'rssi' ? (sortAsc ? 'ascending' : 'descending') : 'none'
                    }
                    className="cursor-pointer px-3 py-2 text-right transition-colors select-none hover:text-gray-200"
                    onClick={() => {
                      handleSort('rssi');
                    }}
                  >
                    Signal <SortIcon field="rssi" sortField={sortField} sortAsc={sortAsc} />
                  </th>
                  <th
                    scope="col"
                    aria-sort={
                      sortField === 'snr' ? (sortAsc ? 'ascending' : 'descending') : 'none'
                    }
                    className="cursor-pointer px-3 py-2 text-right transition-colors select-none hover:text-gray-200"
                    onClick={() => {
                      handleSort('snr');
                    }}
                    title="SNR in dB — only meaningful for direct (0-hop) RF neighbors"
                  >
                    SNR <SortIcon field="snr" sortField={sortField} sortAsc={sortAsc} />
                  </th>
                </>
              )}
              <th
                scope="col"
                aria-sort={
                  sortField === 'battery' ? (sortAsc ? 'ascending' : 'descending') : 'none'
                }
                className="cursor-pointer px-3 py-2 text-right transition-colors select-none hover:text-gray-200"
                onClick={() => {
                  handleSort('battery');
                }}
              >
                Battery <SortIcon field="battery" sortField={sortField} sortAsc={sortAsc} />
              </th>
              {mode !== 'meshcore' && (
                <>
                  <th
                    scope="col"
                    aria-sort={
                      sortField === 'voltage' ? (sortAsc ? 'ascending' : 'descending') : 'none'
                    }
                    className="cursor-pointer px-3 py-2 text-right transition-colors select-none hover:text-gray-200"
                    onClick={() => {
                      handleSort('voltage');
                    }}
                  >
                    Voltage <SortIcon field="voltage" sortField={sortField} sortAsc={sortAsc} />
                  </th>
                  <th
                    scope="col"
                    aria-sort={
                      sortField === 'channel_utilization'
                        ? sortAsc
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                    className="cursor-pointer px-3 py-2 text-right transition-colors select-none hover:text-gray-200"
                    onClick={() => {
                      handleSort('channel_utilization');
                    }}
                  >
                    Ch.Util{' '}
                    <SortIcon field="channel_utilization" sortField={sortField} sortAsc={sortAsc} />
                  </th>
                  <th
                    scope="col"
                    aria-sort={
                      sortField === 'air_util_tx' ? (sortAsc ? 'ascending' : 'descending') : 'none'
                    }
                    className="cursor-pointer px-3 py-2 text-right transition-colors select-none hover:text-gray-200"
                    onClick={() => {
                      handleSort('air_util_tx');
                    }}
                  >
                    Air Tx <SortIcon field="air_util_tx" sortField={sortField} sortAsc={sortAsc} />
                  </th>
                  <th
                    scope="col"
                    aria-sort={
                      sortField === 'altitude' ? (sortAsc ? 'ascending' : 'descending') : 'none'
                    }
                    className="cursor-pointer px-3 py-2 text-right transition-colors select-none hover:text-gray-200"
                    onClick={() => {
                      handleSort('altitude');
                    }}
                  >
                    Alt <SortIcon field="altitude" sortField={sortField} sortAsc={sortAsc} />
                  </th>
                  <th
                    scope="col"
                    aria-sort={
                      sortField === 'redundancy' ? (sortAsc ? 'ascending' : 'descending') : 'none'
                    }
                    className="cursor-pointer px-3 py-2 text-right transition-colors select-none hover:text-gray-200"
                    onClick={() => {
                      handleSort('redundancy');
                    }}
                    title="Echoes: same packet received via multiple paths (e.g. RF + MQTT or multiple RF hops). Higher means better mesh redundancy."
                  >
                    Redund. <SortIcon field="redundancy" sortField={sortField} sortAsc={sortAsc} />
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/50">
            {nodeList.length === 0 ? (
              <tr>
                <td
                  colSpan={(mode === 'meshcore' ? 9 : 19) - (coordinateFormat === 'mgrs' ? 1 : 0)}
                  className="text-muted py-8 text-center"
                >
                  {searchQuery
                    ? 'No nodes match your search.'
                    : 'No nodes discovered yet. Connect to a device to see the mesh network.'}
                </td>
              </tr>
            ) : (
              nodeList.map((node) => {
                const isSelf = node.node_id === myNodeNum;
                const status = getNodeStatus(
                  node.last_heard,
                  nodeStaleThresholdMs,
                  nodeOfflineThresholdMs,
                );
                const isMqttOnlyDimmed = ignoreMqttEnabled && !!node.heard_via_mqtt_only;
                const rowOpacity = isMqttOnlyDimmed
                  ? 'opacity-50'
                  : status === 'offline'
                    ? 'opacity-20'
                    : status === 'stale'
                      ? 'opacity-35'
                      : '';

                return (
                  <tr
                    key={node.node_id}
                    onClick={() => {
                      onNodeClick(node);
                    }}
                    className={`hover:bg-secondary-dark/50 cursor-pointer transition-colors ${rowOpacity} ${
                      isSelf ? 'bg-brand-green/5 border-l-brand-green border-l-2' : ''
                    }`}
                  >
                    {/* Status indicator */}
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <span
                          role="img"
                          className={`h-2 w-2 rounded-full ${
                            status === 'online'
                              ? 'bg-brand-green'
                              : status === 'stale'
                                ? 'bg-purple-800'
                                : 'bg-gray-600'
                          }`}
                          aria-label={
                            status === 'online'
                              ? 'Online'
                              : status === 'stale'
                                ? 'Stale'
                                : 'Offline'
                          }
                          title={status}
                        />
                        {isSelf && (
                          <span
                            className="text-bright-green text-[10px] font-bold"
                            title="This is your node"
                          >
                            ★
                          </span>
                        )}
                      </div>
                    </td>
                    {/* Favorite toggle */}
                    <td
                      className="px-2 py-2"
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      {!isSelf && (
                        <button
                          onClick={() => {
                            onToggleFavorite(node.node_id, !node.favorited);
                          }}
                          aria-label={node.favorited ? 'Remove from favorites' : 'Add to favorites'}
                          aria-pressed={node.favorited}
                          title={node.favorited ? 'Remove from favorites' : 'Add to favorites'}
                        >
                          <span
                            className={
                              node.favorited
                                ? 'text-yellow-400'
                                : 'text-gray-600 hover:text-yellow-400'
                            }
                            aria-hidden="true"
                          >
                            {node.favorited ? '★' : '☆'}
                          </span>
                        </button>
                      )}
                    </td>
                    <td className="text-muted px-3 py-2 font-mono text-xs">
                      !{node.node_id.toString(16)}
                      {mode === 'meshcore' && meshcorePublicKeyHexByNodeId?.has(node.node_id) && (
                        <span className="ml-1">🔑</span>
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 ${isSelf ? 'text-bright-green font-medium' : 'text-gray-200'} ${isMqttOnlyDimmed ? 'line-through' : ''}`}
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <span className="truncate">
                            {node.long_name || '-'}
                            {isSelf && (
                              <span className="text-bright-green/60 ml-1.5 text-[10px]">(you)</span>
                            )}
                          </span>
                          {!isSelf &&
                            (() => {
                              const routingRow = getRoutingRowForNode(diagnosticRows, node.node_id);
                              if (!routingRow) return null;
                              return (
                                <svg
                                  className={`h-4 w-4 shrink-0 ${
                                    routingRow.severity === 'error'
                                      ? 'text-red-400'
                                      : routingRow.severity === 'info'
                                        ? 'text-blue-400'
                                        : 'text-orange-400'
                                  }`}
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                >
                                  <title>{routingRow.description}</title>
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                                  />
                                </svg>
                              );
                            })()}
                        </span>
                        {mode === 'meshcore' &&
                          meshcoreShowPublicKeys &&
                          meshcorePublicKeyHexByNodeId?.get(node.node_id) && (
                            <span className="text-muted font-mono text-[10px] break-all whitespace-normal">
                              {meshcorePublicKeyHexByNodeId.get(node.node_id)}
                            </span>
                          )}
                      </div>
                    </td>
                    {mode !== 'meshcore' && (
                      <td
                        className={`px-3 py-2 text-gray-300 ${isMqttOnlyDimmed ? 'line-through' : ''}`}
                      >
                        {node.short_name || '-'}
                      </td>
                    )}
                    <td className="text-muted px-3 py-2">{formatTime(node.last_heard)}</td>
                    <td className="px-3 py-2 text-xs">
                      {mode === 'meshcore' ? (
                        node.hw_model === 'Repeater' || node.hw_model === 'Room' ? (
                          <span className="inline-flex items-center gap-1 text-gray-300">
                            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                              <path d={getNodeTypeIcon(node.hw_model) ?? ''} />
                            </svg>
                            {node.hw_model}
                          </span>
                        ) : node.hw_model === 'Chat' ? (
                          <span className="inline-flex items-center gap-1 text-gray-300">
                            <svg
                              className="h-3.5 w-3.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <circle cx="12" cy="8" r="4" />
                              <path d="M4 20c0-4 3.58-7 8-7s8 3 8 7" />
                            </svg>
                            Chat
                          </span>
                        ) : (
                          <span className="text-gray-300">{node.hw_model || '—'}</span>
                        )
                      ) : node.hw_model === 'Chat' ? (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                          <svg
                            className="h-3.5 w-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <circle cx="12" cy="8" r="4" />
                            <path d="M4 20c0-4 3.58-7 8-7s8 3 8 7" />
                          </svg>
                          Chat
                        </span>
                      ) : (
                        <RoleDisplay role={node.role} />
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 text-right text-xs ${(isSelf && (node.hops_away ?? 0)) === 0 ? 'text-bright-green' : 'text-gray-300'}`}
                    >
                      {node.heard_via_mqtt_only ? (
                        <span className="text-muted">—</span>
                      ) : (
                        (node.hops_away ?? (isSelf ? 0 : '-'))
                      )}
                    </td>
                    {mode !== 'meshcore' && (
                      <td className="px-3 py-2 text-center text-xs text-gray-300">
                        {node.heard_via_mqtt_only ? (
                          <span title="Heard only via MQTT" className="text-blue-400">
                            🌐
                          </span>
                        ) : isSelf && mqttConnected ? (
                          <span title="Connected via MQTT" className="text-blue-400">
                            🌐
                          </span>
                        ) : meshtasticNodeShowsHybridMqttPath(node) ? (
                          <MeshtasticHybridPathIcons />
                        ) : (
                          '-'
                        )}
                      </td>
                    )}
                    {(() => {
                      const { latCell, lonCell } = formatCoordColumns(
                        node.latitude,
                        node.longitude,
                        coordinateFormat,
                      );
                      return (
                        <>
                          <td className="text-muted px-3 py-2 text-right font-mono text-xs">
                            {latCell}
                          </td>
                          {coordinateFormat !== 'mgrs' && (
                            <td className="text-muted px-3 py-2 text-right font-mono text-xs">
                              {lonCell}
                            </td>
                          )}
                        </>
                      );
                    })()}
                    {mode !== 'meshcore' && (
                      <>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end">
                            {node.heard_via_mqtt_only ? (
                              <span className="text-muted text-xs">—</span>
                            ) : isSelf || snrMeaningfulForNodeDiagnostics(node) ? (
                              <SignalBars rssi={node.rssi} isSelf={isSelf} />
                            ) : (
                              <span
                                className="text-muted text-xs"
                                title="Signal bars (RSSI) only for direct (0-hop) RF neighbors"
                              >
                                —
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="text-muted px-3 py-2 text-right font-mono text-xs">
                          {node.heard_via_mqtt_only
                            ? '—'
                            : isSelf || snrMeaningfulForNodeDiagnostics(node)
                              ? node.snr != null && node.snr !== 0
                                ? `${node.snr.toFixed(1)} dB`
                                : '—'
                              : '—'}
                        </td>
                      </>
                    )}
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {node.battery > 0 && (
                          <div className="bg-secondary-dark h-1.5 w-10 overflow-hidden rounded-full">
                            <div
                              className={`h-full rounded-full ${
                                node.battery > 50
                                  ? 'bg-brand-green'
                                  : node.battery > 20
                                    ? 'bg-yellow-500'
                                    : 'bg-red-500'
                              }`}
                              style={{
                                width: `${Math.min(node.battery, 100)}%`,
                              }}
                            />
                          </div>
                        )}
                        <span
                          className={
                            node.battery > 50
                              ? 'text-bright-green'
                              : node.battery > 20
                                ? 'text-yellow-400'
                                : node.battery > 0
                                  ? 'text-red-400'
                                  : 'text-muted'
                          }
                        >
                          {node.battery > 0 ? `${node.battery}%` : '-'}
                        </span>
                      </div>
                    </td>
                    {mode !== 'meshcore' && (
                      <>
                        <td className="px-3 py-2 text-right text-xs text-gray-300">
                          {node.voltage != null ? `${node.voltage.toFixed(2)} V` : '-'}
                        </td>
                        <td className="px-3 py-2 text-right text-xs text-gray-300">
                          {node.channel_utilization != null
                            ? `${node.channel_utilization.toFixed(1)}%`
                            : '-'}
                        </td>
                        <td className="px-3 py-2 text-right text-xs text-gray-300">
                          {node.air_util_tx != null ? `${node.air_util_tx.toFixed(1)}%` : '-'}
                        </td>
                        <td className="px-3 py-2 text-right text-xs text-gray-300">
                          {node.altitude != null && node.altitude !== 0
                            ? `${node.altitude} m`
                            : '-'}
                        </td>
                        {(() => {
                          const red = nodeRedundancy.get(node.node_id);
                          const echoes = red ? red.maxPaths - 1 : 0;
                          return (
                            <td
                              className={`px-3 py-2 text-right font-mono text-xs ${
                                echoes >= 3
                                  ? 'text-lime-400'
                                  : echoes > 0
                                    ? 'text-gray-300'
                                    : 'text-muted'
                              }`}
                              title={red ? `${red.score}% connection health` : undefined}
                            >
                              {echoes > 0 ? `+${echoes}` : '-'}
                            </td>
                          );
                        })()}
                      </>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
