/* eslint-disable react-hooks/incompatible-library -- TanStack Virtual useVirtualizer; same as ChatPanel/RawPacketLogPanel */
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Download,
  KeyRound,
  MapPin,
  Radio,
  RefreshCw,
  Search,
  Settings,
  Star,
  TriangleAlert,
  Upload,
  User,
} from 'lucide-react-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ICON_MD, ICON_SM_PLUS } from '@/renderer/lib/icons/iconClass';
import { useIconTrigger } from '@/renderer/lib/icons/iconMotionContext';

import type { ContactGroup } from '../../shared/electron-api.types';
import { meshcoreContactDisplayName } from '../../shared/meshcoreContactSanitize';
import {
  formatMeshtasticNodeId,
  meshtasticNodeIdMatchesHexQuery,
} from '../../shared/nodeNameUtils';
import type { LocationFilter } from '../App';
import {
  type OffloadContactsFromRadioFn,
  useMeshcoreContactCapacity,
} from '../hooks/useMeshcoreContactCapacity';
import { useMessages } from '../hooks/useMessages';
import { useNowMs } from '../hooks/useNowMs';
import {
  buildChatDmPeerIndex,
  type ChatDmPeerDbRow,
  type ChatDmPeerIndexEntry,
  mergeChatDmPeerDbRows,
} from '../lib/chatDmPeerIndex';
import {
  formatCoordColumns,
  latestPositionHistoryPoint,
  resolveNodeMapPosition,
} from '../lib/coordUtils';
import {
  filterDiagnosticRowsForProtocol,
  getRoutingRowForNode,
} from '../lib/diagnostics/diagnosticRows';
import { translateRoutingRowDescription } from '../lib/diagnostics/diagnosticsLabels';
import { snrMeaningfulForNodeDiagnostics } from '../lib/diagnostics/snrMeaningfulForNodeDiagnostics';
import { downloadBlob } from '../lib/downloadBlob';
import { errLikeToLogString } from '../lib/errLikeToLogString';
import { EXPORT_FORMAT_VERSION, nodesToCsv, TOPOLOGY_EXPORT_FORMAT } from '../lib/exportFormats';
import { formatRelativeOrIsoDate } from '../lib/formatRelativeOrIsoDate';
import { getIdentityIdForProtocol } from '../lib/identityByProtocol';
import {
  isMeshcoreOffloadAbortError,
  meshcoreOffloadAbortRemovedCount,
} from '../lib/meshcoreOffload';
import {
  isMeshcoreDmExcludedHwModel,
  MESHCORE_CONTACTS_WARNING_THRESHOLD,
  MESHCORE_MAX_CONTACTS,
} from '../lib/meshcoreUtils';
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
  isMeshtasticSelfHybridPath,
  MeshtasticHybridPathIcons,
  meshtasticHybridPathLabels,
  MeshtasticMqttOnlyPathIcons,
  resolveMeshtasticPathBadge,
} from '../lib/meshtasticSourceIcons';
import { nodesToExportRows } from '../lib/nodeExportRows';
import { nodeHealthScore, nodeHealthTier } from '../lib/nodeHealthScore';
import { getNodeTypeIcon } from '../lib/nodeIcons';
import { getNodeStatus, haversineDistanceKm, normalizeLastHeardMs } from '../lib/nodeStatus';
import { getOfflineIdentityIdForProtocol } from '../lib/offlineProtocolIdentities';
import { useRadioProvider } from '../lib/radio/providerFactory';
import { RoleDisplay } from '../lib/roleInfo';
import { messageRecordsToChatMessages } from '../lib/storeRecordAdapters';
import type { MeshNode, MeshProtocol } from '../lib/types';
import { useCoordFormatStore } from '../stores/coordFormatStore';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';
import { usePositionHistoryStore } from '../stores/positionHistoryStore';
import SignalBars from './SignalBars';
import { useToast } from './Toast';
import { Button, IconButton } from './ui/Button';
import { INPUT_CLASS, NOTICE_CLASS, SELECT_CLASS } from './ui/formClasses';
import { LabeledMenuButton } from './ui/Menu';
import { SegmentedControl } from './ui/SegmentedControl';
import { SortIndicator } from './ui/SortIndicator';
import { StatusDot } from './ui/StatusDot';

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

type NodeListTab = 'all' | 'history';

function stubDmHistoryNode(nodeId: number, lastMessageAt: number, mode: MeshProtocol): MeshNode {
  const hex = formatMeshtasticNodeId(nodeId).replace(/^!/, '');
  return {
    node_id: nodeId,
    long_name: mode === 'meshcore' ? hex : `!${hex}`,
    short_name: hex.slice(-4),
    hw_model: mode === 'meshcore' ? 'Chat' : '',
    snr: 0,
    battery: 0,
    last_heard: lastMessageAt,
    latitude: null,
    longitude: null,
    favorited: false,
    source: 'rf',
  };
}

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
  if (hw_model === 'Sensor') return t('nodeListPanel.meshcoreTypeSensor');
  if (hw_model === 'None') return t('nodeListPanel.meshcoreTypeNone');
  if (hw_model === 'Unknown') return t('nodeListPanel.meshcoreTypeUnknown');
  return hw_model?.trim() || t('common.emDash');
}

/** Sort fields that do not apply when the Nodes table is in MeshCore (contacts) layout. */
const MESHCORE_INAPPLICABLE_SORT_FIELDS: ReadonlySet<SortField> = new Set([
  'short_name',
  'role',
  'via_mqtt',
  'voltage',
  'channel_utilization',
  'air_util_tx',
  'altitude',
  'redundancy',
]);

function SortIcon({
  field,
  sortField,
  sortAsc,
}: {
  field: SortField;
  sortField: SortField;
  sortAsc: boolean;
}) {
  return <SortIndicator direction={sortField === field ? (sortAsc ? 'asc' : 'desc') : null} />;
}

type NodeStatusFilter = 'all' | 'online' | 'stale' | 'offline';

interface Props {
  nodes: Map<number, MeshNode>;
  myNodeNum: number;
  onNodeClick: (node: MeshNode) => void;
  mqttConnected?: boolean;
  radioConnected?: boolean;
  locationFilter: LocationFilter;
  onToggleFavorite: (nodeId: number, favorited: boolean) => void;
  mode?: MeshProtocol;
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
  onOffloadContactsFromRadio?: OffloadContactsFromRadioFn;
  /** Node shown in the detail pane; its row is highlighted. */
  selectedNodeId?: number | null;
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
  selectedNodeId = null,
}: Props) {
  const { addToast } = useToast();
  const { t } = useTranslation();
  const iconTrigger = useIconTrigger();
  const capabilities = useRadioProvider(mode);
  const { nodeStaleThresholdMs, nodeOfflineThresholdMs } = capabilities;
  const coordinateFormat = useCoordFormatStore((s) => s.coordinateFormat);
  const positionHistory = usePositionHistoryStore((s) => s.history);
  const diagnosticRows = useDiagnosticsStore((s) => s.diagnosticRows);
  const protocolDiagnosticRows = useMemo(
    () => filterDiagnosticRowsForProtocol(diagnosticRows, mode),
    [diagnosticRows, mode],
  );
  const ignoreMqttEnabled = useDiagnosticsStore((s) => s.ignoreMqttEnabled);
  const nodeRedundancy = useDiagnosticsStore((s) => s.nodeRedundancy);
  const [listTab, setListTab] = useState<NodeListTab>('all');
  const [dbDmPeers, setDbDmPeers] = useState<ChatDmPeerDbRow[]>([]);
  const [sortField, setSortField] = useState<SortField>('last_heard');
  const [sortAsc, setSortAsc] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<NodeStatusFilter>('all');
  const [importLoading, setImportLoading] = useState(false);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [advertLoading, setAdvertLoading] = useState(false);

  const identityId = getIdentityIdForProtocol(mode) ?? getOfflineIdentityIdForProtocol(mode);
  const identityMessages = useMessages(identityId);
  const ownNodeIdSet = useMemo(() => new Set([myNodeNum >>> 0]), [myNodeNum]);
  const meshcoreExcludedDmPeerIds = useMemo(() => {
    if (mode !== 'meshcore') return null;
    const excludedIds = new Set<number>();
    for (const [peerId, node] of nodes) {
      if (isMeshcoreDmExcludedHwModel(node.hw_model)) excludedIds.add(peerId);
    }
    return excludedIds;
  }, [mode, nodes]);
  const excludeDmPeer = useCallback(
    (peer: number) => meshcoreExcludedDmPeerIds?.has(peer) === true,
    [meshcoreExcludedDmPeerIds],
  );
  const chatUnreadDmOptions = useMemo(
    () => (mode === 'meshcore' ? { excludeDmPeer } : undefined),
    [excludeDmPeer, mode],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows =
          mode === 'meshcore'
            ? await window.electronAPI.db.listMeshcoreDmPeers(myNodeNum)
            : await window.electronAPI.db.listMeshtasticDmPeers(myNodeNum);
        if (!cancelled) {
          const next = Array.isArray(rows) ? rows : [];
          setDbDmPeers((prev) => (prev.length === 0 && next.length === 0 ? prev : next));
        }
      } catch (e) {
        console.warn('[NodeListPanel] listDmPeers ' + errLikeToLogString(e));
        if (!cancelled) {
          setDbDmPeers((prev) => (prev.length === 0 ? prev : []));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, myNodeNum, identityMessages.length]);

  const dmPeerIndex = useMemo(() => {
    const chatMessages = messageRecordsToChatMessages(identityMessages);
    const fromMemory = buildChatDmPeerIndex(chatMessages, ownNodeIdSet, mode, chatUnreadDmOptions);
    const merged = mergeChatDmPeerDbRows(fromMemory, dbDmPeers);
    if (mode !== 'meshcore' || !meshcoreExcludedDmPeerIds) return merged;
    // Drop Room/Repeater peers even if SQLite still has DM-shaped rows.
    for (const peer of [...merged.keys()]) {
      if (meshcoreExcludedDmPeerIds.has(peer)) merged.delete(peer);
    }
    return merged;
  }, [
    chatUnreadDmOptions,
    dbDmPeers,
    identityMessages,
    meshcoreExcludedDmPeerIds,
    mode,
    ownNodeIdSet,
  ]);
  const {
    contactCount,
    loading: offloadLoading,
    offloadProgress,
    cancelOffload,
    offloadAndReconcile,
    summary,
  } = useMeshcoreContactCapacity({ enabled: mode === 'meshcore' });

  useEffect(() => {
    if (mode === 'meshcore' && MESHCORE_INAPPLICABLE_SORT_FIELDS.has(sortField)) {
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
      if (isMeshcoreOffloadAbortError(e)) {
        const removed = meshcoreOffloadAbortRemovedCount(e);
        addToast(
          removed > 0
            ? t('radioPanel.offloadCancelledPartial', { count: removed })
            : t('radioPanel.offloadCancelled'),
          'info',
        );
        return;
      }
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

  const baseNodeList = useMemo(() => {
    let list: MeshNode[];
    const historyActivity = new Map<number, ChatDmPeerIndexEntry>();

    if (listTab === 'history') {
      list = [];
      for (const [peerId, entry] of dmPeerIndex) {
        historyActivity.set(peerId, entry);
        const existing = nodes.get(peerId);
        if (existing) {
          list.push({
            ...existing,
            last_heard: Math.max(existing.last_heard ?? 0, entry.lastMessageAt),
          });
        } else {
          list.push(stubDmHistoryNode(peerId, entry.lastMessageAt, mode));
        }
      }
    } else {
      list = Array.from(nodes.values());
    }

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
    if (listTab === 'all' && selectedGroupId != null) {
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
    if (listTab === 'all' && locationFilter.hideMqttOnly) {
      list = list.filter((n) => !n.heard_via_mqtt_only);
    }

    // Filter by distance
    if (listTab === 'all' && locationFilter.enabled) {
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
      if (listTab === 'history') {
        const aTs = historyActivity.get(a.node_id)?.lastMessageAt ?? a.last_heard ?? 0;
        const bTs = historyActivity.get(b.node_id)?.lastMessageAt ?? b.last_heard ?? 0;
        if (aTs !== bTs) return sortAsc ? aTs - bTs : bTs - aTs;
      }
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
    dmPeerIndex,
    listTab,
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

  // Status depends on elapsed time, so the counts and the filter follow a once-a-minute clock
  // as well as node data; otherwise a quiet node stays "online" until something else changes.
  const statusClockMs = useNowMs();
  const statusNowMs = statusClockMs > 0 ? statusClockMs : undefined;

  const statusCounts = useMemo(() => {
    const counts = { online: 0, stale: 0, offline: 0 };
    for (const n of baseNodeList) {
      counts[
        getNodeStatus(n.last_heard, nodeStaleThresholdMs, nodeOfflineThresholdMs, statusNowMs)
      ] += 1;
    }
    return counts;
  }, [baseNodeList, nodeStaleThresholdMs, nodeOfflineThresholdMs, statusNowMs]);

  const nodeList = useMemo(
    () =>
      statusFilter === 'all'
        ? baseNodeList
        : baseNodeList.filter(
            (n) =>
              getNodeStatus(
                n.last_heard,
                nodeStaleThresholdMs,
                nodeOfflineThresholdMs,
                statusNowMs,
              ) === statusFilter,
          ),
    [baseNodeList, statusFilter, nodeStaleThresholdMs, nodeOfflineThresholdMs, statusNowMs],
  );

  const nodeTableScrollRef = useRef<HTMLDivElement>(null);
  const nodeTableColSpan = (mode === 'meshcore' ? 11 : 19) - (coordinateFormat === 'mgrs' ? 1 : 0);
  const shouldVirtualizeNodeRows = nodeList.length > 100;
  const nodeRowVirtualizer = useVirtualizer({
    count: nodeList.length,
    getScrollElement: () => nodeTableScrollRef.current,
    estimateSize: () => 44,
    overscan: 10,
    enabled: shouldVirtualizeNodeRows,
  });
  const virtualNodeRows = nodeRowVirtualizer.getVirtualItems();
  const rowsForRender =
    shouldVirtualizeNodeRows && virtualNodeRows.length > 0
      ? virtualNodeRows
      : nodeList.map((node, index) => ({
          index,
          start: index * 44,
          end: (index + 1) * 44,
          size: 44,
          key: node.node_id,
          lane: 0 as const,
        }));

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
    const visibleWithGps = baseNodeList.filter(
      (n) => n.node_id !== myNodeNum && (n.latitude || n.longitude),
    ).length;
    return { hidden: totalWithGps - visibleWithGps };
  }, [locationFilter, myNodeNum, nodes, baseNodeList]);
  const totalNodeCount = listTab === 'history' ? dmPeerIndex.size : nodes.size;
  const visibleNodeCount = nodeList.length;
  const headerCountLabel =
    visibleNodeCount === totalNodeCount
      ? `${visibleNodeCount}`
      : `${visibleNodeCount} of ${totalNodeCount}`;

  function formatTime(ts: number): string {
    return formatRelativeOrIsoDate(ts, t, normalizeLastHeardMs);
  }

  const exportJson = () => {
    const payload = nodesToExportRows(nodeList, {
      protocol: mode,
      staleThresholdMs: nodeStaleThresholdMs,
      offlineThresholdMs: nodeOfflineThresholdMs,
    });
    const blob = new Blob(
      [
        JSON.stringify(
          {
            format: TOPOLOGY_EXPORT_FORMAT,
            version: EXPORT_FORMAT_VERSION,
            exportedAt: new Date().toISOString(),
            nodes: payload,
          },
          null,
          2,
        ),
      ],
      {
        type: 'application/json',
      },
    );
    downloadBlob(blob, `mesh-topology-${new Date().toISOString().slice(0, 10)}.json`);
  };
  const exportCsv = () => {
    const csv = nodesToCsv(
      nodesToExportRows(nodeList, {
        protocol: mode,
        staleThresholdMs: nodeStaleThresholdMs,
        offlineThresholdMs: nodeOfflineThresholdMs,
      }),
    );
    downloadBlob(
      new Blob([csv], { type: 'text/csv' }),
      `mesh-topology-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };
  // The heading stays the same in All and History, so the view control beside it never moves. The
  // count changes with every filter, so it sits after the control.
  const listHeading =
    mode === 'meshcore'
      ? t('nodeListPanel.headingContacts')
      : t('nodeListPanel.headingNodeDatabase');
  const smallSpinner = (
    <span
      aria-hidden
      className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent"
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-ink-200 text-base font-semibold">{listHeading}</h2>
        <SegmentedControl
          aria-label={t('nodeListPanel.listViewAria')}
          value={listTab}
          onChange={setListTab}
          options={[
            { value: 'all', label: t('nodeListPanel.tabAll') },
            { value: 'history', label: t('nodeListPanel.tabHistory') },
          ]}
        />
        <span data-list-count="" className="text-muted font-mono text-sm">
          ({headerCountLabel})
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {mode === 'meshcore' && meshcoreShowRefreshControl && onRefreshContacts ? (
            <Button
              size="sm"
              onClick={() => {
                void handleRefreshContacts();
              }}
              disabled={refreshLoading}
              aria-label={t('nodeListPanel.refreshContacts')}
              icon={
                refreshLoading ? (
                  smallSpinner
                ) : (
                  <RefreshCw aria-hidden className={ICON_SM_PLUS} size={14} />
                )
              }
            >
              {t('nodeListPanel.buttonRefresh')}
            </Button>
          ) : null}
          {mode === 'meshcore' && onSendAdvert ? (
            <Button
              size="sm"
              onClick={() => {
                void handleSendAdvert();
              }}
              disabled={!meshcoreRadioOperational || advertLoading}
              aria-label={t('nodeListPanel.sendFloodAdvert')}
              title={
                meshcoreRadioOperational ? undefined : t('nodeListPanel.sendFloodAdvertUnavailable')
              }
              icon={
                advertLoading ? (
                  smallSpinner
                ) : (
                  <Radio aria-hidden className={ICON_SM_PLUS} size={14} />
                )
              }
            >
              {t('nodeListPanel.buttonFloodAdvert')}
            </Button>
          ) : null}
          {mode === 'meshcore' && onImportContacts ? (
            <Button
              size="sm"
              onClick={handleImport}
              disabled={importLoading}
              icon={
                importLoading ? (
                  smallSpinner
                ) : (
                  <Upload aria-hidden className={ICON_SM_PLUS} size={14} />
                )
              }
            >
              {t('nodeListPanel.buttonImportContacts')}
            </Button>
          ) : null}
          <LabeledMenuButton
            size="sm"
            label={t('nodeListPanel.buttonExport')}
            icon={<Download aria-hidden className={ICON_SM_PLUS} size={14} />}
            menuLabel={t('nodeListPanel.exportMenuLabel')}
            entries={[
              { id: 'json', label: t('nodeListPanel.buttonExportJson'), onSelect: exportJson },
              { id: 'csv', label: t('nodeListPanel.buttonExportCsv'), onSelect: exportCsv },
            ]}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-[18rem] min-w-[10rem] flex-1">
          <Search
            aria-hidden
            className={`${ICON_MD} text-muted pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2`}
            size={16}
          />
          <input
            type="search"
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
            className={`${INPUT_CLASS} pl-8`}
          />
        </div>
        <SegmentedControl
          aria-label={t('nodeListPanel.statusFilterAria')}
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            {
              value: 'all',
              label: t('nodeListPanel.statusFilterAll'),
              count: baseNodeList.length,
            },
            {
              value: 'online',
              label: t('nodeListPanel.statusOnline'),
              count: statusCounts.online,
              dot: 'ok',
            },
            {
              value: 'stale',
              label: t('nodeListPanel.statusStale'),
              count: statusCounts.stale,
              dot: 'idle',
            },
            {
              value: 'offline',
              label: t('nodeListPanel.statusOffline'),
              count: statusCounts.offline,
              dot: 'off',
            },
          ]}
        />
        {listTab === 'all' && contactGroupsEnabled && onManageGroups && (
          <div className="flex min-w-[12rem] items-center gap-1.5">
            <select
              value={selectedGroupId ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                onGroupChange?.(val === '' ? null : Number(val));
              }}
              aria-label={t('nodeListPanel.filterByContactGroup')}
              className={SELECT_CLASS}
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
            <IconButton
              onClick={onManageGroups}
              aria-label={t('nodeListPanel.manageContactGroups')}
              title={t('nodeListPanel.manageGroups')}
              icon={<Settings aria-hidden className={ICON_MD} size={16} />}
            />
          </div>
        )}
      </div>
      {mode === 'meshcore' && (
        <p className="text-muted max-w-2xl text-xs">{t('nodeListPanel.meshcoreImportedHint')}</p>
      )}
      {mode === 'meshcore' && summary.isWarning && (
        <div className={`shrink-0 ${summary.isCritical ? NOTICE_CLASS.error : NOTICE_CLASS.warn}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {t('nodeDetailModal.radioCapacityTitle', {
                current: contactCount ?? '?',
                max: MESHCORE_MAX_CONTACTS,
              })}
            </span>
            {contactCount !== null && contactCount > 0 ? (
              offloadLoading ? (
                <div
                  className="flex items-center gap-2"
                  role="status"
                  aria-live="polite"
                  aria-label={t('radioPanel.offloading')}
                >
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border border-orange-300 border-t-transparent" />
                  <span>
                    {offloadProgress?.phase === 'removing' && offloadProgress.total > 0
                      ? t('radioPanel.offloadingProgress', {
                          current: offloadProgress.current,
                          total: offloadProgress.total,
                        })
                      : t('radioPanel.offloading')}
                  </span>
                  <Button size="sm" onClick={cancelOffload} aria-label={t('common.cancel')}>
                    {t('common.cancel')}
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  onClick={() => {
                    void handleOffloadContacts();
                  }}
                  aria-label={t('radioPanel.offloadContacts')}
                >
                  {t('radioPanel.offloadContacts')}
                </Button>
              )
            ) : null}
          </div>
        </div>
      )}

      {/* Distance filter status */}
      {filterStatus === 'no-gps' && (
        <div className={`shrink-0 ${NOTICE_CLASS.warn}`}>
          {t('nodeListPanel.distanceFilterNoGpsBanner')}
        </div>
      )}
      {filterStatus !== null && filterStatus !== 'no-gps' && filterStatus.hidden > 0 && (
        <div className={`shrink-0 ${NOTICE_CLASS.info}`}>
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

      <div
        ref={nodeTableScrollRef}
        className="bg-deep-black border-ink-800 min-h-0 min-w-0 flex-1 overflow-auto rounded-xl border"
      >
        <table
          style={{ minWidth: mode === 'meshcore' ? '1000px' : '1600px' }}
          className="text-sm whitespace-nowrap"
        >
          <caption className="sr-only">{t('nodeListPanel.tableCaptionMeshNodes')}</caption>
          <thead>
            <tr className="bg-deep-black text-muted border-ink-800 sticky top-0 z-10 border-b text-left text-xs whitespace-nowrap">
              <th scope="col" className="w-16 px-3 py-2">
                {t('nodeListPanel.columnHealth')}
              </th>
              <th scope="col" className="w-6 px-2 py-2" title={t('nodeListPanel.favoritesColumn')}>
                <span className="sr-only">{t('nodeListPanel.columnFavorite')}</span>
              </th>
              {mode !== 'meshcore' && (
                <th
                  scope="col"
                  aria-sort={
                    sortField === 'node_id' ? (sortAsc ? 'ascending' : 'descending') : 'none'
                  }
                  className="hover:text-ink-200 cursor-pointer px-3 py-2 transition-colors select-none"
                  onClick={() => {
                    handleSort('node_id');
                  }}
                >
                  {t('nodeListPanel.columnId')}{' '}
                  <SortIcon field="node_id" sortField={sortField} sortAsc={sortAsc} />
                </th>
              )}
              <th
                scope="col"
                aria-sort={
                  sortField === 'long_name' ? (sortAsc ? 'ascending' : 'descending') : 'none'
                }
                className="hover:text-ink-200 cursor-pointer px-3 py-2 transition-colors select-none"
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
                  className="hover:text-ink-200 cursor-pointer px-3 py-2 transition-colors select-none"
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
                className="hover:text-ink-200 cursor-pointer px-3 py-2 transition-colors select-none"
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
                  className="hover:text-ink-200 cursor-pointer px-3 py-2 transition-colors select-none"
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
                  className="hover:text-ink-200 cursor-pointer px-3 py-2 transition-colors select-none"
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
                className="hover:text-ink-200 cursor-pointer px-3 py-2 text-right transition-colors select-none"
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
                  className="hover:text-ink-200 cursor-pointer px-3 py-2 text-center transition-colors select-none"
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
                className="hover:text-ink-200 cursor-pointer px-3 py-2 text-right transition-colors select-none"
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
                  className="hover:text-ink-200 cursor-pointer px-3 py-2 text-right transition-colors select-none"
                  onClick={() => {
                    handleSort('longitude');
                  }}
                >
                  {t('nodeListPanel.columnLon')}{' '}
                  <SortIcon field="longitude" sortField={sortField} sortAsc={sortAsc} />
                </th>
              )}
              <th
                scope="col"
                aria-sort={sortField === 'rssi' ? (sortAsc ? 'ascending' : 'descending') : 'none'}
                className="hover:text-ink-200 cursor-pointer px-3 py-2 text-right transition-colors select-none"
                onClick={() => {
                  handleSort('rssi');
                }}
              >
                {t('nodeListPanel.columnSignal')}{' '}
                <SortIcon field="rssi" sortField={sortField} sortAsc={sortAsc} />
              </th>
              <th
                scope="col"
                aria-sort={sortField === 'snr' ? (sortAsc ? 'ascending' : 'descending') : 'none'}
                className="hover:text-ink-200 cursor-pointer px-3 py-2 text-right transition-colors select-none"
                onClick={() => {
                  handleSort('snr');
                }}
                title={t('nodeListPanel.snrTooltip')}
              >
                {t('nodeListPanel.columnSnr')}{' '}
                <SortIcon field="snr" sortField={sortField} sortAsc={sortAsc} />
              </th>
              <th
                scope="col"
                aria-sort={
                  sortField === 'battery' ? (sortAsc ? 'ascending' : 'descending') : 'none'
                }
                className="hover:text-ink-200 cursor-pointer px-3 py-2 text-right transition-colors select-none"
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
                    className="hover:text-ink-200 cursor-pointer px-3 py-2 text-right transition-colors select-none"
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
                    className="hover:text-ink-200 cursor-pointer px-3 py-2 text-right transition-colors select-none"
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
                    className="hover:text-ink-200 cursor-pointer px-3 py-2 text-right transition-colors select-none"
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
                    className="hover:text-ink-200 cursor-pointer px-3 py-2 text-right transition-colors select-none"
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
                    className="hover:text-ink-200 cursor-pointer px-3 py-2 text-right transition-colors select-none"
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
          <tbody className="divide-ink-800 divide-y">
            {nodeList.length === 0 ? (
              <tr>
                <td colSpan={nodeTableColSpan} className="text-muted py-8 text-center">
                  {searchQuery
                    ? t('nodeListPanel.emptyNoSearchMatches')
                    : listTab === 'history'
                      ? t('nodeListPanel.emptyHistory')
                      : t('nodeListPanel.emptyNoNodesYet')}
                </td>
              </tr>
            ) : (
              <>
                {shouldVirtualizeNodeRows &&
                  virtualNodeRows.length > 0 &&
                  virtualNodeRows[0].start > 0 && (
                    <tr>
                      <td
                        colSpan={nodeTableColSpan}
                        style={{ height: virtualNodeRows[0].start, padding: 0, border: 0 }}
                      />
                    </tr>
                  )}
                {rowsForRender.map((virtualRow) => {
                  const node = nodeList[virtualRow.index];
                  if (!node) return null;
                  const isSelf = node.node_id === myNodeNum;
                  const status = getNodeStatus(
                    node.last_heard,
                    nodeStaleThresholdMs,
                    nodeOfflineThresholdMs,
                  );
                  const health = nodeHealthScore(node);
                  const healthTier = nodeHealthTier(health.total);
                  const isMqttOnlyDimmed = ignoreMqttEnabled && !!node.heard_via_mqtt_only;
                  const isSelected = node.node_id === selectedNodeId;

                  return (
                    <tr
                      key={node.node_id}
                      data-index={shouldVirtualizeNodeRows ? virtualRow.index : undefined}
                      ref={shouldVirtualizeNodeRows ? nodeRowVirtualizer.measureElement : undefined}
                      onClick={() => {
                        onNodeClick(node);
                      }}
                      data-selected={isSelected ? 'true' : undefined}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-sidebar-active-bg'
                          : isSelf
                            ? 'bg-brand-green/5 hover:bg-sidebar-active-bg/60'
                            : 'hover:bg-sidebar-active-bg/60'
                      }`}
                    >
                      {/* Status indicator */}
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <span
                            className="inline-flex"
                            title={
                              status === 'online'
                                ? t('nodeListPanel.statusOnline')
                                : status === 'stale'
                                  ? t('nodeListPanel.statusStale')
                                  : t('nodeListPanel.statusOffline')
                            }
                          >
                            <StatusDot
                              tone={
                                status === 'online' ? 'ok' : status === 'stale' ? 'idle' : 'off'
                              }
                              label={
                                status === 'online'
                                  ? t('nodeListPanel.statusOnline')
                                  : status === 'stale'
                                    ? t('nodeListPanel.statusStale')
                                    : t('nodeListPanel.statusOffline')
                              }
                            />
                          </span>
                          <span
                            className={`text-3xs rounded px-1 leading-tight font-semibold ${
                              healthTier === 'good'
                                ? 'bg-green-900/60 text-green-400'
                                : healthTier === 'warn'
                                  ? 'bg-orange-900/60 text-orange-400'
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
                            type="button"
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
                            <Star
                              aria-hidden
                              size={16}
                              className={`${ICON_MD} ${
                                node.favorited
                                  ? 'fill-current text-yellow-400'
                                  : 'text-muted hover:text-yellow-400'
                              }`}
                            />
                          </button>
                        )}
                      </td>
                      {mode !== 'meshcore' && (
                        <td className="text-muted px-3 py-2 font-mono text-xs">
                          {formatMeshtasticNodeId(node.node_id)}
                        </td>
                      )}
                      <td
                        className={`px-3 py-2 ${isSelf ? 'text-bright-green font-medium' : 'text-ink-200'} ${isMqttOnlyDimmed ? 'line-through' : ''}`}
                      >
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="inline-flex min-w-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onNodeClick(node);
                              }}
                              aria-current={isSelected ? 'true' : undefined}
                              className={`focus-visible:outline-brand-green rounded text-left hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                                mode === 'meshcore' ? 'break-words whitespace-normal' : 'truncate'
                              }`}
                            >
                              {mode === 'meshcore'
                                ? meshcoreContactDisplayName(node.node_id, node.long_name)
                                : node.long_name || '-'}
                            </button>
                            {isSelf && (
                              <span
                                className="bg-brand-green/12 text-bright-green text-label shrink-0 rounded px-1.5 py-px font-medium"
                                title={t('nodeListPanel.yourNodeTooltip')}
                              >
                                {t('nodeListPanel.youBadge')}
                              </span>
                            )}
                            {mode === 'meshcore' &&
                              meshcorePublicKeyHexByNodeId?.has(node.node_id) && (
                                <span
                                  role="img"
                                  className="text-muted shrink-0"
                                  aria-label={t('nodeListPanel.hasPublicKeyTitle')}
                                  title={t('nodeListPanel.hasPublicKeyTitle')}
                                >
                                  <KeyRound aria-hidden className={ICON_SM_PLUS} size={14} />
                                </span>
                              )}
                            {!isSelf &&
                              (() => {
                                const routingRow = getRoutingRowForNode(
                                  protocolDiagnosticRows,
                                  node.node_id,
                                );
                                if (!routingRow) return null;
                                const routingDesc = translateRoutingRowDescription(t, routingRow);
                                return (
                                  <span role="img" title={routingDesc} aria-label={routingDesc}>
                                    <TriangleAlert
                                      aria-hidden
                                      className={`h-4 w-4 shrink-0 ${
                                        routingRow.severity === 'error'
                                          ? 'text-red-400'
                                          : routingRow.severity === 'info'
                                            ? 'text-indigo-400'
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
                              <span className="text-muted text-2xs font-mono break-all whitespace-normal">
                                {meshcorePublicKeyHexByNodeId.get(node.node_id)}
                              </span>
                            )}
                        </div>
                      </td>
                      {mode !== 'meshcore' && (
                        <td
                          className={`text-ink-300 px-3 py-2 ${isMqttOnlyDimmed ? 'line-through' : ''}`}
                        >
                          {node.short_name || '-'}
                        </td>
                      )}
                      <td className="text-muted px-3 py-2">{formatTime(node.last_heard)}</td>
                      <td className="px-3 py-2 text-xs">
                        {mode === 'meshcore' ? (
                          node.hw_model === 'Repeater' || node.hw_model === 'Room' ? (
                            <span className="text-ink-300 inline-flex items-center gap-1">
                              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                                <path d={getNodeTypeIcon(node.hw_model) ?? ''} />
                              </svg>
                              {meshcoreContactTypeLabel(t, node.hw_model)}
                            </span>
                          ) : node.hw_model === 'Chat' ? (
                            <span className="text-ink-300 inline-flex items-center gap-1">
                              <User
                                aria-hidden
                                className="h-3.5 w-3.5"
                                trigger={iconTrigger}
                                size={14}
                              />
                              {meshcoreContactTypeLabel(t, node.hw_model)}
                            </span>
                          ) : (
                            <span className="text-ink-300">
                              {meshcoreContactTypeLabel(t, node.hw_model)}
                            </span>
                          )
                        ) : node.hw_model === 'Chat' ? (
                          <span className="text-ink-400 inline-flex items-center gap-1 text-xs">
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
                        className={`px-3 py-2 text-right text-xs ${(isSelf && (node.hops_away ?? 0)) === 0 ? 'text-bright-green' : 'text-ink-300'}`}
                      >
                        {node.heard_via_mqtt_only ? (
                          <span className="text-muted">—</span>
                        ) : (
                          (node.hops_away ?? (isSelf ? 0 : '-'))
                        )}
                      </td>
                      {mode !== 'meshcore' && (
                        <td className="text-ink-300 px-3 py-2 text-xs">
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
                                const labels = meshtasticHybridPathLabels(
                                  t,
                                  isMeshtasticSelfHybridPath(isSelf, mqttConnected, radioConnected),
                                );
                                return (
                                  <MeshtasticHybridPathIcons
                                    title={labels.title}
                                    ariaLabel={labels.ariaLabel}
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
                                    <MapPin aria-hidden className="h-3.5 w-3.5" />
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
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end">
                          {node.heard_via_mqtt_only ? (
                            <span className="text-muted text-xs">—</span>
                          ) : isSelf || snrMeaningfulForNodeDiagnostics(node, capabilities) ? (
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
                          : isSelf || snrMeaningfulForNodeDiagnostics(node, capabilities)
                            ? node.snr != null && node.snr !== 0
                              ? `${node.snr.toFixed(1)} dB`
                              : '—'
                            : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {node.battery > 0 && (
                            <div className="bg-secondary-dark h-1.5 w-10 overflow-hidden rounded-full">
                              <div
                                className={`h-full rounded-full ${
                                  node.battery > 50
                                    ? 'bg-brand-green'
                                    : node.battery > 20
                                      ? 'bg-orange-500'
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
                                  ? 'text-orange-400'
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
                          <td className="text-ink-300 px-3 py-2 text-right text-xs">
                            {node.voltage != null ? `${node.voltage.toFixed(2)} V` : '-'}
                          </td>
                          <td className="text-ink-300 px-3 py-2 text-right text-xs">
                            {node.channel_utilization != null
                              ? `${node.channel_utilization.toFixed(1)}%`
                              : '-'}
                          </td>
                          <td className="text-ink-300 px-3 py-2 text-right text-xs">
                            {node.air_util_tx != null ? `${node.air_util_tx.toFixed(1)}%` : '-'}
                          </td>
                          <td className="text-ink-300 px-3 py-2 text-right text-xs">
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
                                      ? 'text-ink-300'
                                      : 'text-muted'
                                }`}
                                title={
                                  red
                                    ? t('nodeListPanel.echoesConnectionHealthTooltip', {
                                        score: red.score,
                                      })
                                    : undefined
                                }
                              >
                                {echoes > 0 ? `+${echoes}` : '-'}
                              </td>
                            );
                          })()}
                        </>
                      )}
                    </tr>
                  );
                })}
                {shouldVirtualizeNodeRows && virtualNodeRows.length > 0 && (
                  <tr>
                    <td
                      colSpan={nodeTableColSpan}
                      style={{
                        height:
                          nodeRowVirtualizer.getTotalSize() -
                          virtualNodeRows[virtualNodeRows.length - 1].end,
                        padding: 0,
                        border: 0,
                      }}
                    />
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
