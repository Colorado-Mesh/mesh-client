/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity */
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  PARENT_HOVER_ATTR,
  Settings,
  TriangleAlert,
  User,
} from 'lucide-react-motion';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIconTrigger, useParentIconTrigger } from '@/renderer/lib/icons/iconMotionContext';

import type { ContactGroup } from '../../shared/electron-api.types';
import {
  formatMeshtasticNodeId,
  meshtasticNodeIdMatchesHexQuery,
} from '../../shared/nodeNameUtils';
import type { LocationFilter } from '../App';
import { useMeshcoreContactCapacity } from '../hooks/useMeshcoreContactCapacity';
import {
  formatCoordColumns,
  latestPositionHistoryPoint,
  resolveNodeMapPosition,
} from '../lib/coordUtils';
import { getRoutingRowForNode } from '../lib/diagnostics/diagnosticRows';
import { snrMeaningfulForNodeDiagnostics } from '../lib/diagnostics/snrMeaningfulForNodeDiagnostics';
import { getMapOverlayColors, MAP_BASEMAPS } from '../lib/mapBasemapUtils';
import { MESHCORE_CONTACTS_WARNING_THRESHOLD, MESHCORE_MAX_CONTACTS } from '../lib/meshcoreUtils';
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
  MeshtasticMqttOnlyPathIcons,
  resolveMeshtasticPathBadge,
} from '../lib/meshtasticSourceIcons';
import { nodeHealthScore, nodeHealthTier } from '../lib/nodeHealthScore';
import { getNodeTypeIcon } from '../lib/nodeIcons';
import { getNodeStatus, haversineDistanceKm, normalizeLastHeardMs } from '../lib/nodeStatus';
import { useRadioProvider } from '../lib/radio/providerFactory';
import { RoleDisplay } from '../lib/roleInfo';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '../lib/timeConstants';
import type { MeshNode } from '../lib/types';
import { useCoordFormatStore } from '../stores/coordFormatStore';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';
import { useMapLayerStore } from '../stores/mapLayerStore';
import { usePositionHistoryStore } from '../stores/positionHistoryStore';
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
  { group_id: -1, typeKey: 'nodeListPanel.meshcoreTypeChat' as const, hw_model: 'Chat' },
  { group_id: -2, typeKey: 'nodeListPanel.meshcoreTypeRepeater' as const, hw_model: 'Repeater' },
  { group_id: -3, typeKey: 'nodeListPanel.meshcoreTypeRoom' as const, hw_model: 'Room' },
] as const;

function meshcoreContactTypeLabel(
  t: (key: string) => string,
  hw_model: string | undefined,
): string {
  if (hw_model === 'Chat') return t('nodeListPanel.meshcoreTypeChat');
  if (hw_model === 'Repeater') return t('nodeListPanel.meshcoreTypeRepeater');
  if (hw_model === 'Room') return t('nodeListPanel.meshcoreTypeRoom');
  return hw_model?.trim() || t('common.emDash');
}

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
  const trigger = useIconTrigger();
  const p = { 'aria-hidden': true as const, trigger, size: 12 };

  if (sortField !== field) {
    return <ArrowUpDown {...p} className="ml-1 inline h-3 w-3 text-gray-600" />;
  }
  return sortAsc ? (
    <ChevronUp {...p} className="text-bright-green ml-1 inline h-3 w-3" />
  ) : (
    <ChevronDown {...p} className="text-bright-green ml-1 inline h-3 w-3" />
  );
}

interface Props {
  nodes: Map<number, MeshNode>;
  myNodeNum: number;
  onNodeClick: (node: MeshNode) => void;
  mqttConnected?: boolean;
  radioConnected?: boolean;
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
  onShowOnMap?: (nodeId: number, lat: number, lon: number) => void;
  onOffloadContactsFromRadio?: () => Promise<number>;
}

export default function NodeListPanel({
  nodes,
  myNodeNum,
  onNodeClick,
  mqttConnected = false,
  radioConnected = false,
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
  onShowOnMap,
  onOffloadContactsFromRadio,
}: Props) {
  const { addToast } = useToast();
  const { t } = useTranslation();
  const parentIconTrigger = useParentIconTrigger();
  const iconTrigger = useIconTrigger();
  const { nodeStaleThresholdMs, nodeOfflineThresholdMs } = useRadioProvider(mode);
  const coordinateFormat = useCoordFormatStore((s) => s.coordinateFormat);
  const basemapId = useMapLayerStore((s) => s.basemapId);
  const staleLegendColor = getMapOverlayColors(MAP_BASEMAPS[basemapId].isDark).stale;
  const positionHistory = usePositionHistoryStore((s) => s.history);
  const diagnosticRows = useDiagnosticsStore((s) => s.diagnosticRows);
  const ignoreMqttEnabled = useDiagnosticsStore((s) => s.ignoreMqttEnabled);
  const nodeRedundancy = useDiagnosticsStore((s) => s.nodeRedundancy);
  const [sortField, setSortField] = useState<SortField>('last_heard');
  const [sortAsc, setSortAsc] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [advertLoading, setAdvertLoading] = useState(false);
  const {
    contactCount,
    loading: offloadLoading,
    offloadAndReconcile,
    summary,
  } = useMeshcoreContactCapacity({ enabled: mode === 'meshcore' });

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
      addToast(t('nodeListPanel.contactsRefreshed'), 'success');
    } catch (e) {
      console.warn('[NodeListPanel] refresh failed:', e instanceof Error ? e.message : e);
      addToast(
        t('nodeListPanel.refreshFailed', { message: e instanceof Error ? e.message : String(e) }),
        'error',
      );
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
          ? t('nodeListPanel.importResultError', {
              imported: result.imported,
              skipped: result.skipped,
              errors: result.errors.slice(0, 3).join('; '),
            })
          : result.skipped > 0
            ? t('nodeListPanel.importResultSuccessWithSkipped', {
                count: result.imported,
                skipped: result.skipped,
              })
            : t('nodeListPanel.importResultSuccess', { count: result.imported });
      addToast(msg, result.errors.length > 0 ? 'error' : 'success');
    } catch (e) {
      console.warn('[NodeListPanel] import failed:', e instanceof Error ? e.message : e);
      addToast(
        t('nodeListPanel.importFailed', { message: e instanceof Error ? e.message : String(e) }),
        'error',
      );
    } finally {
      setImportLoading(false);
    }
  };

  const handleSendAdvert = async () => {
    if (!onSendAdvert) return;
    setAdvertLoading(true);
    try {
      await onSendAdvert();
      addToast(t('nodeListPanel.floodAdvertSent'), 'success');
    } catch (e) {
      console.warn('[NodeListPanel] sendAdvert failed:', e instanceof Error ? e.message : e);
      addToast(
        t('nodeListPanel.advertFailed', { message: e instanceof Error ? e.message : String(e) }),
        'error',
      );
    } finally {
      setAdvertLoading(false);
    }
  };

  const handleOffloadContacts = async () => {
    try {
      const { offloadedCount, reconciledCount, refreshFailed } = await offloadAndReconcile(
        onRefreshContacts,
        onOffloadContactsFromRadio,
      );
      addToast(t('radioPanel.offloadedContacts', { count: offloadedCount }), 'success');
      if (reconciledCount !== null && reconciledCount >= MESHCORE_MAX_CONTACTS) {
        addToast(t('radioPanel.offloadReconcileStillFull', { count: reconciledCount }), 'error');
      } else if (
        reconciledCount !== null &&
        reconciledCount >= MESHCORE_CONTACTS_WARNING_THRESHOLD
      ) {
        addToast(
          t('radioPanel.offloadReconcileStillNearFull', { count: reconciledCount }),
          'error',
        );
      } else if (refreshFailed) {
        addToast(t('radioPanel.offloadReconcileRefreshFailed'), 'error');
      }
    } catch (e) {
      console.warn('[NodeListPanel] offload contacts failed:', e instanceof Error ? e.message : e);
      addToast(t('radioPanel.failedOffloadContacts'), 'error');
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
          (mode === 'meshcore'
            ? n.node_id.toString(16).includes(q.replace(/^!/, ''))
            : meshtasticNodeIdMatchesHexQuery(n.node_id, q)),
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
    if (!ts) return t('common.never');
    const normalizedTs = normalizeLastHeardMs(ts);
    const diff = Date.now() - normalizedTs;
    if (diff < MS_PER_MINUTE) return t('common.justNow');
    if (diff < MS_PER_HOUR) {
      return t('common.minutesAgo', { count: Math.floor(diff / MS_PER_MINUTE) });
    }
    if (diff < MS_PER_DAY) {
      return t('common.hoursAgo', { count: Math.floor(diff / MS_PER_HOUR) });
    }
    return new Date(normalizedTs).toLocaleDateString();
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* 1fr | auto | 1fr keeps the search visually centered on wide screens (matches MeshCore’s title | search | import row). */}
      <div className="grid grid-cols-1 items-center gap-3 min-[480px]:grid-cols-[1fr_auto_1fr]">
        <h2 className="text-bright-green text-lg font-semibold min-[480px]:justify-self-start">
          {mode === 'meshcore'
            ? t('nodeListPanel.headingContacts')
            : t('nodeListPanel.headingNodeDatabase')}{' '}
          ({headerCountLabel})
        </h2>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
          }}
          placeholder={
            mode === 'meshcore'
              ? t('nodeListPanel.searchContactsPlaceholder')
              : t('nodeListPanel.searchNodesPlaceholder')
          }
          aria-label={
            mode === 'meshcore'
              ? t('nodeListPanel.searchContactsAria')
              : t('nodeListPanel.searchNodesAria')
          }
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
              aria-label={t('nodeListPanel.refreshContacts')}
              className="flex w-full items-center justify-center gap-2 rounded border border-purple-600 px-3 py-1.5 text-sm font-medium text-purple-400 transition-colors hover:bg-purple-900/30 hover:text-purple-300 disabled:opacity-50 min-[480px]:w-auto"
            >
              {refreshLoading ? (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border border-purple-400 border-t-transparent" />
              ) : null}
              {t('nodeListPanel.buttonRefresh')}
            </button>
          ) : null}
          {mode === 'meshcore' && onSendAdvert ? (
            <button
              type="button"
              onClick={() => {
                void handleSendAdvert();
              }}
              disabled={!meshcoreRadioOperational || advertLoading}
              aria-label={t('nodeListPanel.sendFloodAdvert')}
              className="bg-brand-green/20 text-brand-green border-brand-green/30 hover:bg-brand-green/30 flex w-full items-center justify-center gap-2 rounded border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 min-[480px]:w-auto"
            >
              {advertLoading ? (
                <span className="border-brand-green inline-block h-3 w-3 animate-spin rounded-full border border-t-transparent" />
              ) : null}
              {t('nodeListPanel.buttonFloodAdvert')}
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
              {t('nodeListPanel.buttonImportContacts')}
            </button>
          ) : (
            <div className="hidden min-w-0 min-[480px]:block" aria-hidden />
          )}
          <button
            aria-label={t('nodeListPanel.buttonExportJson')}
            className="flex w-full items-center justify-center gap-2 rounded border border-gray-600/50 px-3 py-1.5 text-sm font-medium text-gray-400 transition-colors hover:border-gray-500 hover:text-gray-200 min-[480px]:w-auto"
            onClick={() => {
              const payload = nodeList.map((n) => ({
                node_id: n.node_id,
                hex_id: formatMeshtasticNodeId(n.node_id),
                long_name: n.long_name,
                short_name: n.short_name,
                hw_model: n.hw_model,
                snr: n.snr,
                rssi: n.rssi,
                battery: n.battery,
                voltage: n.voltage,
                last_heard: n.last_heard,
                latitude: n.latitude,
                longitude: n.longitude,
                altitude: n.altitude,
                hops_away: n.hops_away,
                via_mqtt: n.via_mqtt,
                favorited: n.favorited,
              }));
              const blob = new Blob(
                [JSON.stringify({ exportedAt: new Date().toISOString(), nodes: payload }, null, 2)],
                {
                  type: 'application/json',
                },
              );
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `mesh-topology-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              setTimeout(() => {
                URL.revokeObjectURL(url);
              }, 0);
            }}
          >
            {t('nodeListPanel.buttonExportJson')}
          </button>
        </div>
      </div>
      {mode === 'meshcore' && (
        <p className="max-w-2xl text-xs text-gray-500">{t('nodeListPanel.meshcoreImportedHint')}</p>
      )}
      {mode === 'meshcore' && summary.isWarning && (
        <div
          className={`shrink-0 rounded-lg border px-3 py-2 text-xs ${
            summary.isCritical
              ? 'border-red-700 bg-red-900/30 text-red-200'
              : 'border-yellow-700 bg-yellow-900/30 text-yellow-200'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {t('nodeDetailModal.radioCapacityTitle', {
                current: contactCount ?? '?',
                max: MESHCORE_MAX_CONTACTS,
              })}
            </span>
            {contactCount !== null && contactCount > 0 ? (
              <button
                type="button"
                onClick={() => {
                  void handleOffloadContacts();
                }}
                disabled={offloadLoading}
                aria-label={t('radioPanel.offloadContacts')}
                className="rounded border border-yellow-700 bg-yellow-900/30 px-2 py-0.5 text-xs font-medium text-yellow-300 transition-colors hover:bg-yellow-800/50 disabled:opacity-40"
              >
                {offloadLoading ? '...' : t('radioPanel.offloadContacts')}
              </button>
            ) : null}
          </div>
        </div>
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
            aria-label={t('nodeListPanel.filterByContactGroup')}
            className="bg-secondary-dark/80 focus:border-brand-green/50 flex-1 rounded-lg border border-gray-600/50 px-3 py-1.5 text-sm text-gray-200 focus:outline-none"
          >
            <option value="">
              {mode === 'meshcore'
                ? t('nodeListPanel.filterOptionAllContacts')
                : t('nodeListPanel.filterOptionAllNodes')}
            </option>
            {mode === 'meshcore'
              ? BUILTIN_TYPE_FILTERS.map((f) => (
                  <option key={f.group_id} value={f.group_id}>
                    {t('nodeListPanel.filterTypePrefix', { label: t(f.typeKey) })}
                  </option>
                ))
              : MESHTASTIC_BUILTIN_CONTACT_GROUP_FILTERS.map((f) => (
                  <option key={f.group_id} value={f.group_id}>
                    {f.label}
                  </option>
                ))}
            {groups?.map((g) => (
              <option key={g.group_id} value={g.group_id}>
                {t('nodeListPanel.filterGroupPrefix', {
                  name: g.name,
                  count: g.member_count,
                })}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onManageGroups}
            aria-label={t('nodeListPanel.manageContactGroups')}
            title={t('nodeListPanel.manageGroups')}
            {...{ [PARENT_HOVER_ATTR]: '' }}
            className="hover:bg-secondary-dark text-muted shrink-0 rounded-lg p-1.5 transition-colors hover:text-gray-200"
          >
            <Settings aria-hidden className="h-4 w-4" trigger={parentIconTrigger} size={16} />
          </button>
        </div>
      )}

      {/* Distance filter status */}
      {filterStatus === 'no-gps' && (
        <div className="shrink-0 rounded-lg border border-yellow-700 bg-yellow-900/30 px-3 py-2 text-xs text-yellow-300">
          {t('nodeListPanel.distanceFilterNoGpsBanner')}
        </div>
      )}
      {filterStatus !== null && filterStatus !== 'no-gps' && filterStatus.hidden > 0 && (
        <div className="bg-brand-green/10 border-brand-green/30 text-brand-green shrink-0 rounded-lg border px-3 py-2 text-xs">
          {t('nodeListPanel.distanceFilterActiveBanner', {
            count: filterStatus.hidden,
            maxDistance: locationFilter.maxDistance,
            unit:
              locationFilter.unit === 'miles'
                ? t('appPanel.distanceUnitMiles')
                : t('appPanel.distanceUnitKm'),
          })}
        </div>
      )}

      {/* Online / Stale / Offline summary */}
      <div className="text-muted flex shrink-0 gap-3 text-xs">
        <span className="flex items-center gap-1">
          <span className="bg-brand-green inline-block h-2 w-2 rounded-full" />
          {t('nodeListPanel.summaryOnline', {
            count: nodeList.filter(
              (n) =>
                getNodeStatus(n.last_heard, nodeStaleThresholdMs, nodeOfflineThresholdMs) ===
                'online',
            ).length,
          })}
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: staleLegendColor }}
          />
          {t('nodeListPanel.summaryStale', {
            count: nodeList.filter(
              (n) =>
                getNodeStatus(n.last_heard, nodeStaleThresholdMs, nodeOfflineThresholdMs) ===
                'stale',
            ).length,
          })}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-slate-700" />
          {t('nodeListPanel.summaryOffline', {
            count: nodeList.filter(
              (n) =>
                getNodeStatus(n.last_heard, nodeStaleThresholdMs, nodeOfflineThresholdMs) ===
                'offline',
            ).length,
          })}
        </span>
      </div>

      <div className="min-h-0 min-w-0 flex-1">
        <table
          style={{ minWidth: mode === 'meshcore' ? '1000px' : '1600px' }}
          className="text-sm whitespace-nowrap"
        >
          <caption className="sr-only">{t('nodeListPanel.tableCaptionMeshNodes')}</caption>
          <thead>
            <tr className="bg-deep-black text-muted sticky top-0 z-10 text-left whitespace-nowrap">
              <th scope="col" className="w-8 px-3 py-2">
                <span className="sr-only">{t('nodeListPanel.columnStatus')}</span>
              </th>
              <th scope="col" className="w-6 px-2 py-2" title={t('nodeListPanel.favoritesColumn')}>
                <span className="sr-only">{t('nodeListPanel.columnFavorite')}</span>
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
                {t('nodeListPanel.columnId')}{' '}
                <SortIcon field="node_id" sortField={sortField} sortAsc={sortAsc} />
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
                {t('nodeListPanel.columnLongName')}{' '}
                <SortIcon field="long_name" sortField={sortField} sortAsc={sortAsc} />
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
                  {t('nodeListPanel.columnShort')}{' '}
                  <SortIcon field="short_name" sortField={sortField} sortAsc={sortAsc} />
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
                {t('nodeListPanel.columnLastHeard')}{' '}
                <SortIcon field="last_heard" sortField={sortField} sortAsc={sortAsc} />
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
                  title={t('nodeListPanel.meshcoreContactType')}
                >
                  {t('nodeListPanel.columnType')}{' '}
                  <SortIcon field="hw_model" sortField={sortField} sortAsc={sortAsc} />
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
                  {t('nodeListPanel.columnRole')}{' '}
                  <SortIcon field="role" sortField={sortField} sortAsc={sortAsc} />
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
                {t('nodeListPanel.columnHops')}{' '}
                <SortIcon field="hops_away" sortField={sortField} sortAsc={sortAsc} />
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
                  {t('nodeListPanel.columnMqtt')}{' '}
                  <SortIcon field="via_mqtt" sortField={sortField} sortAsc={sortAsc} />
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
                {coordinateFormat === 'mgrs'
                  ? t('nodeListPanel.columnMgrs')
                  : t('nodeListPanel.columnLat')}{' '}
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
                  {t('nodeListPanel.columnLon')}{' '}
                  <SortIcon field="longitude" sortField={sortField} sortAsc={sortAsc} />
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
                    {t('nodeListPanel.columnSignal')}{' '}
                    <SortIcon field="rssi" sortField={sortField} sortAsc={sortAsc} />
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
                    title={t('nodeListPanel.snrTooltip')}
                  >
                    {t('nodeListPanel.columnSnr')}{' '}
                    <SortIcon field="snr" sortField={sortField} sortAsc={sortAsc} />
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
                {t('nodeListPanel.columnBattery')}{' '}
                <SortIcon field="battery" sortField={sortField} sortAsc={sortAsc} />
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
                    {t('nodeListPanel.columnVoltage')}{' '}
                    <SortIcon field="voltage" sortField={sortField} sortAsc={sortAsc} />
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
                    {t('nodeListPanel.columnChUtil')}{' '}
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
                    {t('nodeListPanel.columnAirTx')}{' '}
                    <SortIcon field="air_util_tx" sortField={sortField} sortAsc={sortAsc} />
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
                    {t('nodeListPanel.columnAlt')}{' '}
                    <SortIcon field="altitude" sortField={sortField} sortAsc={sortAsc} />
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
                    title={t('nodeListPanel.echoesTooltip')}
                  >
                    {t('nodeListPanel.columnRedund')}{' '}
                    <SortIcon field="redundancy" sortField={sortField} sortAsc={sortAsc} />
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
                    ? t('nodeListPanel.emptyNoSearchMatches')
                    : t('nodeListPanel.emptyNoNodesYet')}
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
                const health = nodeHealthScore(node);
                const healthTier = nodeHealthTier(health.total);
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
                              ? t('nodeListPanel.statusOnline')
                              : status === 'stale'
                                ? t('nodeListPanel.statusStale')
                                : t('nodeListPanel.statusOffline')
                          }
                          title={
                            status === 'online'
                              ? t('nodeListPanel.statusOnline')
                              : status === 'stale'
                                ? t('nodeListPanel.statusStale')
                                : t('nodeListPanel.statusOffline')
                          }
                        />
                        {isSelf && (
                          <span
                            className="text-bright-green text-[10px] font-bold"
                            title={t('nodeListPanel.yourNodeTooltip')}
                          >
                            ★
                          </span>
                        )}
                        <span
                          className={`rounded px-1 text-[9px] leading-tight font-semibold ${
                            healthTier === 'good'
                              ? 'bg-green-900/60 text-green-400'
                              : healthTier === 'warn'
                                ? 'bg-yellow-900/60 text-yellow-400'
                                : 'bg-red-900/60 text-red-400'
                          }`}
                          title={t('nodeListPanel.healthTooltip', {
                            total: health.total,
                            signal: health.signal,
                            recency: health.recency,
                            load: health.load,
                            battery: health.battery,
                          })}
                          aria-label={t('nodeListPanel.healthAriaLabel', { total: health.total })}
                        >
                          {health.total}
                        </span>
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
                          aria-label={
                            node.favorited
                              ? t('nodeListPanel.removeFromFavorites')
                              : t('nodeListPanel.addToFavorites')
                          }
                          aria-pressed={node.favorited}
                          title={
                            node.favorited
                              ? t('nodeListPanel.removeFromFavorites')
                              : t('nodeListPanel.addToFavorites')
                          }
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
                      {formatMeshtasticNodeId(node.node_id)}
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
                                <span
                                  role="img"
                                  title={routingRow.description}
                                  aria-label={routingRow.description}
                                >
                                  <TriangleAlert
                                    aria-hidden
                                    className={`h-4 w-4 shrink-0 ${
                                      routingRow.severity === 'error'
                                        ? 'text-red-400'
                                        : routingRow.severity === 'info'
                                          ? 'text-blue-400'
                                          : 'text-orange-400'
                                    }`}
                                    trigger={iconTrigger}
                                    size={16}
                                  />
                                </span>
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
                            {meshcoreContactTypeLabel(t, node.hw_model)}
                          </span>
                        ) : node.hw_model === 'Chat' ? (
                          <span className="inline-flex items-center gap-1 text-gray-300">
                            <User
                              aria-hidden
                              className="h-3.5 w-3.5"
                              trigger={iconTrigger}
                              size={14}
                            />
                            {meshcoreContactTypeLabel(t, node.hw_model)}
                          </span>
                        ) : (
                          <span className="text-gray-300">
                            {meshcoreContactTypeLabel(t, node.hw_model)}
                          </span>
                        )
                      ) : node.hw_model === 'Chat' ? (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                          <User
                            aria-hidden
                            className="h-3.5 w-3.5"
                            trigger={iconTrigger}
                            size={14}
                          />
                          {meshcoreContactTypeLabel(t, node.hw_model)}
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
                      <td className="px-3 py-2 text-xs text-gray-300">
                        <div className="flex justify-center">
                          {(() => {
                            const pathBadge = resolveMeshtasticPathBadge({
                              node,
                              isSelf,
                              mqttConnected,
                              radioConnected,
                            });
                            if (pathBadge === 'mqttOnly') {
                              const title = node.heard_via_mqtt_only
                                ? t('nodeListPanel.mqttHeardOnlyTooltip')
                                : isSelf
                                  ? t('nodeListPanel.mqttConnectedTooltip')
                                  : t('nodeListPanel.mqttHeardOnlyTooltip');
                              return (
                                <MeshtasticMqttOnlyPathIcons title={title} ariaLabel={title} />
                              );
                            }
                            if (pathBadge === 'hybrid') {
                              const isSelfHybrid = isSelf && mqttConnected && radioConnected;
                              return (
                                <MeshtasticHybridPathIcons
                                  title={
                                    isSelfHybrid
                                      ? t('nodeListPanel.connectedViaRfAndMqttTooltip')
                                      : t('nodeListPanel.hybridMqttPathTooltip')
                                  }
                                  ariaLabel={
                                    isSelfHybrid
                                      ? t('nodeListPanel.connectedViaRfAndMqttAria')
                                      : t('nodeListPanel.hybridMqttPathAria')
                                  }
                                />
                              );
                            }
                            return '-';
                          })()}
                        </div>
                      </td>
                    )}
                    {(() => {
                      const mapPosition = resolveNodeMapPosition(
                        node,
                        latestPositionHistoryPoint(positionHistory.get(node.node_id)),
                      );
                      const { latCell, lonCell } = formatCoordColumns(
                        mapPosition?.lat ?? node.latitude,
                        mapPosition?.lon ?? node.longitude,
                        coordinateFormat,
                      );
                      const canShowOnMap = onShowOnMap != null && mapPosition != null;
                      return (
                        <>
                          <td className="text-muted px-3 py-2 text-right font-mono text-xs">
                            <span className="inline-flex items-center justify-end gap-1">
                              {latCell}
                              {canShowOnMap && (
                                <button
                                  type="button"
                                  className="text-brand-green hover:text-bright-green rounded p-0.5 transition-colors"
                                  aria-label={t('nodeListPanel.showOnMap')}
                                  title={t('nodeListPanel.showOnMap')}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (mapPosition) {
                                      onShowOnMap(node.node_id, mapPosition.lat, mapPosition.lon);
                                    }
                                  }}
                                >
                                  📍
                                </button>
                              )}
                            </span>
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
                                title={t('nodeListPanel.signalBarsTooltip')}
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
