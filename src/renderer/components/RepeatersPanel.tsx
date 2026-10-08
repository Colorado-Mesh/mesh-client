/* eslint-disable react-hooks/incompatible-library -- TanStack Virtual useVirtualizer; same as NodeListPanel */
import { useVirtualizer } from '@tanstack/react-virtual';
import type { TFunction } from 'i18next';
import { ChevronDown, ChevronRight, Ellipsis, Search, Star, Trash2 } from 'lucide-react-motion';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { ICON_MD, ICON_SM_PLUS } from '@/renderer/lib/icons/iconClass';

import { MESHCORE_NEIGHBORS_MAX_RECOMMENDED_HOPS } from '../hooks/meshcore/meshcoreHookPreamble';
import { useMeshcoreRepeaterRemoteAuth } from '../hooks/useMeshcoreRepeaterRemoteAuth';
import { formatCoordPair } from '../lib/coordUtils';
import type {
  CliHistoryEntry,
  MeshCoreNeighborResult,
  MeshCoreNodeTelemetry,
  MeshcoreRepeaterCliOptions,
  MeshCoreRepeaterStatus,
  MeshcoreRequestNeighborsOpts,
  MeshcoreTraceResultEntry,
} from '../lib/meshcore/meshcoreHookTypes';
import {
  meshcoreRepeaterAdminErrorMessage,
  translateMeshcoreUserMessage,
  translateRepeaterCliHistoryText,
} from '../lib/meshcore/meshcoreMessageI18n';
import {
  forgetAdminPassword,
  listSavedAdminPasswords,
  type MeshcoreInfraAdminPasswordEntry,
} from '../lib/meshcoreInfraAdminSecrets';
import {
  buildMeshcorePathChainSegments,
  buildMeshcorePathResolutionFromNodes,
  meshcoreDisplayRouteFromPathSelection,
  meshcoreHopSegmentTooltip,
  meshcorePathBytesEqual,
  meshcoreTraceHopDisplayRows,
} from '../lib/meshcorePathChainDisplay';
import type { MeshcoreRepeaterRpcPendingMap } from '../lib/meshcoreRepeaterAdminPending';
import { isRepeaterAdminRpcPending } from '../lib/meshcoreRepeaterAdminPending';
import { isMeshcoreRepeaterCliDangerCommand } from '../lib/meshcoreRepeaterCliDanger';
import { normalizeMeshcoreCliCommand } from '../lib/meshcoreRepeaterCliQueue';
import { meshcoreTracePathLenToHops } from '../lib/meshcoreUtils';
import { effectiveLastHeardMs, getNodeStatus } from '../lib/nodeStatus';
import type { PathRecord } from '../lib/pathHistoryTypes';
import { useRadioProvider } from '../lib/radio/providerFactory';
import { REPEATER_CLI_MAX_COMMAND_LENGTH } from '../lib/repeaterCommandService';
import {
  DEFAULT_REPEATER_SORT,
  defaultRepeaterSortDir,
  nextRepeaterSort,
  prepareRepeaterSortRows,
  type RepeaterContactSignal,
  type RepeaterSortDir,
  type RepeaterSortKey,
  resolveRepeaterAirPct,
  resolveRepeaterReliability,
  resolveRepeaterRssi,
  resolveRepeaterSnr,
  sortPreparedRepeaterRows,
} from '../lib/repeaterListSort';
import type { MeshNode } from '../lib/types';
import { useCoordFormatStore } from '../stores/coordFormatStore';
import { usePathHistoryStore } from '../stores/pathHistoryStore';
import { useRepeaterSignalStore } from '../stores/repeaterSignalStore';
import { ConfirmModal } from './ConfirmModal';
import { HelpTooltip } from './HelpTooltip';
import { MeshcoreInfraConfigPanel } from './MeshcoreInfraConfigPanel';
import { MeshcoreRepeaterSavedPasswordIndicator } from './MeshcoreRepeaterPasswordControls';
import { MeshcoreRoomAclControls } from './MeshcoreRoomAclControls';
import { MeshcoreRouteChain } from './MeshcoreRouteChain';
import { formatSecondsAgo } from './NodeInfoBody';
import SnrIndicator from './SnrIndicator';
import { useToast } from './Toast';
import { Button, buttonClassName } from './ui/Button';
import { INPUT_CLASS } from './ui/formClasses';
import { MenuButton } from './ui/Menu';
import { SegmentedControl } from './ui/SegmentedControl';
import { SortIndicator } from './ui/SortIndicator';

type TypeFilter = 'all' | 'repeater' | 'room';

const SHARED_CLI_QUICK_COMMANDS = [
  'name',
  'radio',
  'neighbors',
  'version',
  'status',
  'config',
  'help',
  'clock',
  'clock sync',
  'clear stats',
  'advert',
  'advert.zerohop',
  'board',
  'get role',
  'stats-core',
  'stats-radio',
  'stats-packets',
  'discover.neighbors',
  'get path.hash.mode',
  'set path.hash.mode 0',
  'set path.hash.mode 1',
  'set path.hash.mode 2',
] as const;

const ROOM_CLI_QUICK_COMMANDS = ['get acl', 'allow.read.only on', 'allow.read.only off'] as const;

/** MeshCore v1.17+ CommonCLI radio tokens; boards without the hardware reply `Error: unsupported`. */
const RADIO_CLI_QUICK_COMMANDS = [
  'get radio.rxgain',
  'set radio.rxgain on',
  'set radio.rxgain off',
  'get radio.fem.rxgain',
  'set radio.fem.rxgain on',
  'set radio.fem.rxgain off',
  'get radio.fem.txgain',
  'set radio.fem.txgain on',
  'set radio.fem.txgain off',
  'get cad',
  'set cad on',
  'set cad off',
  'get pwrmgt.bootreason',
] as const;

interface CliQuickCommandLabel {
  short: string;
  ariaKey?: string;
  titleKey?: string;
}

const CLI_QUICK_COMMAND_LABELS: Partial<Record<string, CliQuickCommandLabel>> = {
  'get path.hash.mode': { short: 'path.hash', ariaKey: 'repeatersPanel.pathHashCliGet' },
  'set path.hash.mode 0': { short: 'hash 0', ariaKey: 'repeatersPanel.pathHashCliSet0' },
  'set path.hash.mode 1': { short: 'hash 1', ariaKey: 'repeatersPanel.pathHashCliSet1' },
  'set path.hash.mode 2': { short: 'hash 2', ariaKey: 'repeatersPanel.pathHashCliSet2' },
  'allow.read.only on': { short: 'ro on' },
  'allow.read.only off': { short: 'ro off' },
  'get radio.rxgain': { short: 'rxgain', ariaKey: 'repeatersPanel.radioCliRxGainGet' },
  'set radio.rxgain on': { short: 'rxgain on', ariaKey: 'repeatersPanel.radioCliRxGainOn' },
  'set radio.rxgain off': { short: 'rxgain off', ariaKey: 'repeatersPanel.radioCliRxGainOff' },
  'get radio.fem.rxgain': { short: 'fem.rx', ariaKey: 'repeatersPanel.radioCliFemRxGainGet' },
  'set radio.fem.rxgain on': {
    short: 'fem.rx on',
    ariaKey: 'repeatersPanel.radioCliFemRxGainOn',
  },
  'set radio.fem.rxgain off': {
    short: 'fem.rx off',
    ariaKey: 'repeatersPanel.radioCliFemRxGainOff',
  },
  'get radio.fem.txgain': { short: 'fem.tx', ariaKey: 'repeatersPanel.radioCliFemTxGainGet' },
  'set radio.fem.txgain on': {
    short: 'fem.tx on',
    ariaKey: 'repeatersPanel.radioCliFemTxGainOn',
  },
  'set radio.fem.txgain off': {
    short: 'fem.tx off',
    ariaKey: 'repeatersPanel.radioCliFemTxGainOff',
  },
  'get cad': { short: 'cad', ariaKey: 'repeatersPanel.radioCliCadGet' },
  'set cad on': {
    short: 'cad on',
    ariaKey: 'repeatersPanel.radioCliCadOn',
    titleKey: 'repeatersPanel.radioCliCadOnHint',
  },
  'set cad off': { short: 'cad off', ariaKey: 'repeatersPanel.radioCliCadOff' },
  'get pwrmgt.bootreason': {
    short: 'bootreason',
    ariaKey: 'repeatersPanel.radioCliBootReasonGet',
  },
};

interface Props {
  nodes: Map<number, MeshNode>;
  meshcoreNodeStatus: Map<number, MeshCoreRepeaterStatus>;
  meshcoreStatusErrors?: Map<number, string>;
  meshcoreTraceResults: Map<number, MeshcoreTraceResultEntry>;
  meshcorePingErrors?: Map<number, string>;
  /** Survives panel unmount — in-flight status/ping/neighbors/telemetry/CLI RPCs. */
  meshcoreRepeaterRpcPending?: MeshcoreRepeaterRpcPendingMap;
  onRequestRepeaterStatus: (nodeId: number) => Promise<void>;
  onPing: (nodeId: number) => Promise<boolean | undefined>;
  onDeleteRepeater: (nodeId: number) => Promise<void>;
  isConnected: boolean;
  onRequestNeighbors?: (nodeId: number, opts?: MeshcoreRequestNeighborsOpts) => Promise<void>;
  meshcoreNeighbors?: Map<number, MeshCoreNeighborResult>;
  meshcoreNeighborErrors?: Map<number, string>;
  onRequestTelemetry?: (nodeId: number) => Promise<void>;
  meshcoreTelemetry?: Map<number, MeshCoreNodeTelemetry>;
  meshcoreTelemetryErrors?: Map<number, string>;
  onSelectRepeater?: (node: MeshNode) => void;
  onSendCliCommand?: (
    nodeId: number,
    command: string,
    opts?: MeshcoreRepeaterCliOptions,
  ) => Promise<string>;
  meshcoreCliHistories?: Map<number, CliHistoryEntry[]>;
  meshcoreCliErrors?: Map<number, string>;
  onClearCliHistory?: (nodeId: number) => void;
  /** MeshCore: when set (non-null), prefetches SQLite path history for visible repeaters. */
  meshcoreCanPingTrace?: (nodeId: number) => boolean;
  onToggleFavorite?: (nodeId: number, favorited: boolean) => void;
  /** Jump to Rooms tab for this room server. */
  onOpenRoom?: (nodeId: number) => void;
  /** Open configuration for this node (from Rooms Manage jump). */
  pendingFocusNodeId?: number | null;
  onPendingFocusConsumed?: () => void;
}

const REPEATER_ROW_ESTIMATE_PX = 48;
const REPEATER_ROW_EXPANDED_EXTRA_PX = 160;
const REPEATER_VIRTUALIZE_THRESHOLD = 100;

function isMeshcoreNeighborsHopBlocked(node: MeshNode): boolean {
  const hops = node.hops_away;
  return hops != null && hops >= MESHCORE_NEIGHBORS_MAX_RECOMMENDED_HOPS;
}

function formatComputerUtcStamp(d = new Date()): string {
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function isRepeaterCliClockCannotGoBackwards(command: string, response: string): boolean {
  return command.trim().toLowerCase() === 'clock sync' && /cannot go backwards/i.test(response);
}

function formatRelativeTime(t: TFunction, lastHeard: number | null | undefined): string {
  if (!lastHeard) return t('common.never');
  const lastMs = effectiveLastHeardMs(lastHeard);
  if (!lastMs) return t('common.never');
  const ageMs = Date.now() - lastMs;
  const ageSec = Math.floor(ageMs / 1000);
  const clampedSec = Math.max(0, ageSec);
  if (clampedSec < 60) return t('common.justNow');
  const ageMin = Math.floor(clampedSec / 60);
  if (ageMin < 60) return t('common.minutesAgo', { count: ageMin });
  const ageHr = Math.floor(ageMin / 60);
  if (ageHr < 24) return t('common.hoursAgo', { count: ageHr });
  return t('common.daysAgo', { count: Math.floor(ageHr / 24) });
}

function formatUptime(t: TFunction, secs: number | undefined): string {
  if (!secs) return '—';
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  if (days > 0) return t('repeatersPanel.uptimeDaysHours', { days, hours });
  if (hours > 0) return t('repeatersPanel.uptimeHoursMinutes', { hours, minutes: mins });
  return t('repeatersPanel.uptimeMinutes', { minutes: mins });
}

async function runRepeaterAdminAction(
  t: TFunction,
  nodeId: number,
  nodes: Map<number, MeshNode>,
  orphanLabel: (nodeId: number) => string,
  ensureRepeaterAuth: (
    nodeId: number,
    displayName: string,
    hwModel?: string,
  ) => Promise<{ ok: boolean; saved?: boolean }>,
  refreshStoredSecrets: () => void,
  action: () => Promise<void>,
  toastKey: string,
  logTag: string,
  addToast: (message: string, type: 'error') => void,
): Promise<void> {
  const node = nodes.get(nodeId);
  const auth = await ensureRepeaterAuth(
    nodeId,
    node?.long_name ?? orphanLabel(nodeId),
    node?.hw_model,
  );
  if (!auth.ok) return;
  if (auth.saved) refreshStoredSecrets();
  try {
    await action();
  } catch (e) {
    console.warn(`[RepeatersPanel] ${logTag} ` + errLikeToLogString(e));
    addToast(t(toastKey, { message: meshcoreRepeaterAdminErrorMessage(t, e) }), 'error');
  }
}

interface SignalPoint {
  ts: number;
  snr: number;
}

function displayRepeaterSnr(
  node: MeshNode,
  status: MeshCoreRepeaterStatus | undefined,
  history?: SignalPoint[],
  contacts?: Map<number, RepeaterContactSignal>,
): string {
  const snr = resolveRepeaterSnr(node, status, history, contacts);
  return snr == null ? '—' : snr.toFixed(1);
}

function displayRepeaterRssi(
  node: MeshNode,
  status: MeshCoreRepeaterStatus | undefined,
  contacts?: Map<number, RepeaterContactSignal>,
): string {
  const rssi = resolveRepeaterRssi(node, status, contacts);
  return rssi == null ? '—' : String(rssi);
}

function displayReliability(paths: PathRecord[]): string {
  const pct = resolveRepeaterReliability(paths);
  return pct == null ? '—' : `${pct.toFixed(0)}%`;
}

function RepeaterSortIcon({
  field,
  sortKey,
  sortDir,
}: {
  field: RepeaterSortKey;
  sortKey: RepeaterSortKey;
  sortDir: RepeaterSortDir;
}) {
  return <SortIndicator direction={sortKey === field ? sortDir : null} />;
}

function repeaterSortAriaKey(key: RepeaterSortKey, dir: RepeaterSortDir): string {
  switch (key) {
    case 'status':
      return dir === 'asc' ? 'repeatersPanel.sortByStatusAsc' : 'repeatersPanel.sortByStatusDesc';
    case 'name':
      return dir === 'asc' ? 'repeatersPanel.sortByNameAsc' : 'repeatersPanel.sortByNameDesc';
    case 'lastHeard':
      return dir === 'asc'
        ? 'repeatersPanel.sortByLastHeardAsc'
        : 'repeatersPanel.sortByLastHeardDesc';
    case 'snr':
      return dir === 'asc' ? 'repeatersPanel.sortBySnrAsc' : 'repeatersPanel.sortBySnrDesc';
    case 'rssi':
      return dir === 'asc' ? 'repeatersPanel.sortByRssiAsc' : 'repeatersPanel.sortByRssiDesc';
    case 'hops':
      return dir === 'asc' ? 'repeatersPanel.sortByHopsAsc' : 'repeatersPanel.sortByHopsDesc';
    case 'uptime':
      return dir === 'asc' ? 'repeatersPanel.sortByUptimeAsc' : 'repeatersPanel.sortByUptimeDesc';
    case 'airPct':
      return dir === 'asc' ? 'repeatersPanel.sortByAirPctAsc' : 'repeatersPanel.sortByAirPctDesc';
    case 'reliability':
      return dir === 'asc'
        ? 'repeatersPanel.sortByReliabilityAsc'
        : 'repeatersPanel.sortByReliabilityDesc';
  }
}

function RepeaterSortHeader({
  columnKey,
  sortKey,
  sortDir,
  columnLabel,
  ariaLabel,
  title,
  onSort,
}: {
  columnKey: RepeaterSortKey;
  sortKey: RepeaterSortKey;
  sortDir: RepeaterSortDir;
  columnLabel: string;
  ariaLabel: string;
  title?: string;
  onSort: (key: RepeaterSortKey) => void;
}) {
  const ariaSort =
    sortKey === columnKey ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th className="py-2 pr-4 font-medium" aria-sort={ariaSort} title={title}>
      <button
        type="button"
        className="hover:text-ink-200"
        aria-label={ariaLabel}
        onClick={() => {
          onSort(columnKey);
        }}
      >
        {columnLabel}
        <RepeaterSortIcon field={columnKey} sortKey={sortKey} sortDir={sortDir} />
      </button>
    </th>
  );
}

export default function RepeatersPanel({
  nodes,
  meshcoreNodeStatus,
  meshcoreStatusErrors,
  meshcoreTraceResults,
  meshcorePingErrors,
  meshcoreRepeaterRpcPending,
  onRequestRepeaterStatus,
  onPing,
  onDeleteRepeater,
  isConnected,
  onRequestNeighbors,
  meshcoreNeighbors,
  meshcoreNeighborErrors,
  onRequestTelemetry,
  meshcoreTelemetry,
  meshcoreTelemetryErrors,
  onSelectRepeater,
  onSendCliCommand,
  meshcoreCliHistories,
  meshcoreCliErrors,
  onClearCliHistory,
  onToggleFavorite,
  onOpenRoom,
  pendingFocusNodeId,
  onPendingFocusConsumed,
}: Props) {
  const { addToast } = useToast();
  const { t } = useTranslation();
  /** Small spinner inside row buttons and the row busy indicator. */
  const rowSpinner = (
    <span
      aria-hidden
      className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent"
    />
  );
  /** "Confirm?" appears after Remove is chosen from the row menu; focus it so blur cancels. */
  const focusOnMount = useCallback((el: HTMLButtonElement | null) => {
    el?.focus();
  }, []);
  const { ensureRepeaterAuth, RemoteAuthModal } = useMeshcoreRepeaterRemoteAuth();
  const [configNodeId, setConfigNodeId] = useState<number | null>(null);
  const [savedAdminEntries, setSavedAdminEntries] = useState<MeshcoreInfraAdminPasswordEntry[]>(
    () => listSavedAdminPasswords(),
  );
  const [savedPasswordsOpen, setSavedPasswordsOpen] = useState(false);
  const [forgetConfirmKey, setForgetConfirmKey] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sortPref, setSortPref] = useState(DEFAULT_REPEATER_SORT);
  const sortKey = sortPref.key;
  const sortDir = sortPref.dir;
  const lastConsumedPendingFocusRef = useRef<number | null>(null);
  const refreshStoredSecrets = useCallback(() => {
    setSavedAdminEntries(listSavedAdminPasswords());
  }, []);
  const savedCredentialEntries = useMemo(() => savedAdminEntries, [savedAdminEntries]);
  const resolveNodeDisplayName = useCallback(
    (nodeId: number, kind: MeshcoreInfraAdminPasswordEntry['kind']): string => {
      const n = nodes.get(nodeId);
      if (n?.long_name) return n.long_name;
      return t(
        kind === 'Room'
          ? 'repeatersPanel.savedPasswordOrphanRoomLabel'
          : 'repeatersPanel.savedPasswordOrphanLabel',
        {
          nodeId: nodeId.toString(16).padStart(8, '0'),
        },
      );
    },
    [nodes, t],
  );
  const coordinateFormat = useCoordFormatStore((s) => s.coordinateFormat);
  const signalHistory = useRepeaterSignalStore((s) => s.history);
  const pathHistory = usePathHistoryStore((s) => s.records);
  const pathResolution = useMemo(() => buildMeshcorePathResolutionFromNodes(nodes), [nodes]);
  const [deleteLoadingSet, setDeleteLoadingSet] = useState<Set<number>>(new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [expandedNeighbors, setExpandedNeighbors] = useState<Set<number>>(new Set());
  const [neighborsUiPending, setNeighborsUiPending] = useState<Set<number>>(new Set());
  const meshcoreNeighborsRef = useRef(meshcoreNeighbors);
  meshcoreNeighborsRef.current = meshcoreNeighbors;
  const [expandedTelemetry, setExpandedTelemetry] = useState<Set<number>>(new Set());
  const [expandedPath, setExpandedPath] = useState<Set<number>>(new Set());
  const [expandedCli, setExpandedCli] = useState<Set<number>>(new Set());
  const [cliInputValues, setCliInputValues] = useState<Map<number, string>>(new Map());
  const [cliDangerConfirm, setCliDangerConfirm] = useState<{
    nodeId: number;
    command: string;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [meshcoreContactsDb, setMeshcoreContactsDb] = useState<
    Map<
      number,
      {
        node_id: number;
        last_snr: number | null;
        last_rssi: number | null;
        last_advert: number | null;
      }
    >
  >(new Map());

  useEffect(() => {
    void window.electronAPI.db
      .getMeshcoreContacts()
      .then((rows) => {
        const m = new Map<
          number,
          {
            node_id: number;
            last_snr: number | null;
            last_rssi: number | null;
            last_advert: number | null;
          }
        >();
        for (const row of rows as {
          node_id: number;
          last_snr: number | null;
          last_rssi: number | null;
          last_advert: number | null;
        }[]) {
          m.set(row.node_id, row);
        }
        setMeshcoreContactsDb(m);
      })
      .catch(() => {
        // catch-no-log-ok database error - contacts will show as unavailable
      });
  }, []);

  const { nodeStaleThresholdMs, nodeOfflineThresholdMs } = useRadioProvider('meshcore');

  const infraNodes = useMemo(
    () =>
      Array.from(nodes.values()).filter((n) => n.hw_model === 'Repeater' || n.hw_model === 'Room'),
    [nodes],
  );

  useEffect(() => {
    if (nodes.size === 0) return;
    console.debug('[RepeatersPanel] nodes=', nodes.size, 'infraCount=', infraNodes.length);
  }, [nodes.size, infraNodes.length]);

  const repeatersFiltered = useMemo(() => {
    let list = infraNodes;
    if (typeFilter === 'repeater') {
      list = list.filter((n) => n.hw_model === 'Repeater');
    } else if (typeFilter === 'room') {
      list = list.filter((n) => n.hw_model === 'Room');
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (n) =>
          n.long_name.toLowerCase().includes(q) || n.node_id.toString(16).toLowerCase().includes(q),
      );
    }
    const tracePathLenByNodeId = new Map<number, number>();
    for (const [id, trace] of meshcoreTraceResults) {
      if (trace.pathLen != null) tracePathLenByNodeId.set(id, trace.pathLen);
    }
    const currentRouteHopByNodeId = new Map<number, number>();
    const selectBestPath = usePathHistoryStore.getState().selectBestPath;
    for (const node of list) {
      const paths = pathHistory.get(node.node_id) ?? [];
      if (paths.length === 0) continue;
      const route = meshcoreDisplayRouteFromPathSelection(selectBestPath(node.node_id));
      if (route?.hopCount != null) currentRouteHopByNodeId.set(node.node_id, route.hopCount);
    }
    const prepared = prepareRepeaterSortRows(list, {
      statusByNodeId: meshcoreNodeStatus,
      contacts: meshcoreContactsDb,
      signalHistory,
      pathHistory,
      tracePathLenByNodeId,
      currentRouteHopByNodeId,
      nodeStaleThresholdMs,
      nodeOfflineThresholdMs,
    });
    return sortPreparedRepeaterRows(prepared, sortKey, sortDir).map((row) => row.node);
  }, [
    infraNodes,
    meshcoreContactsDb,
    meshcoreNodeStatus,
    meshcoreTraceResults,
    nodeOfflineThresholdMs,
    nodeStaleThresholdMs,
    pathHistory,
    searchQuery,
    signalHistory,
    sortDir,
    sortKey,
    typeFilter,
  ]);

  useEffect(() => {
    if (pendingFocusNodeId == null) return;
    if (lastConsumedPendingFocusRef.current === pendingFocusNodeId) return;
    const target = nodes.get(pendingFocusNodeId);
    if (!target || (target.hw_model !== 'Repeater' && target.hw_model !== 'Room')) {
      lastConsumedPendingFocusRef.current = pendingFocusNodeId;
      onPendingFocusConsumed?.();
      return;
    }
    if (target.hw_model === 'Room') setTypeFilter('room');
    else setTypeFilter('repeater');
    setConfigNodeId(pendingFocusNodeId);
    lastConsumedPendingFocusRef.current = pendingFocusNodeId;
    onPendingFocusConsumed?.();
  }, [nodes, onPendingFocusConsumed, pendingFocusNodeId]);
  const toggleRepeaterSort = useCallback((key: RepeaterSortKey) => {
    setSortPref((prev) => nextRepeaterSort(prev, key));
  }, []);
  const repeaterTableScrollRef = useRef<HTMLDivElement>(null);
  const shouldVirtualizeRepeaterRows = repeatersFiltered.length > REPEATER_VIRTUALIZE_THRESHOLD;
  const repeaterRowVirtualizer = useVirtualizer({
    count: repeatersFiltered.length,
    getScrollElement: () => repeaterTableScrollRef.current,
    estimateSize: (index) => {
      const node = repeatersFiltered[index];
      if (!node) return REPEATER_ROW_ESTIMATE_PX;
      const expanded =
        expandedNeighbors.has(node.node_id) ||
        expandedTelemetry.has(node.node_id) ||
        expandedPath.has(node.node_id) ||
        expandedCli.has(node.node_id);
      return REPEATER_ROW_ESTIMATE_PX + (expanded ? REPEATER_ROW_EXPANDED_EXTRA_PX : 0);
    },
    overscan: 8,
    enabled: shouldVirtualizeRepeaterRows,
  });
  const virtualRepeaterRows = repeaterRowVirtualizer.getVirtualItems();
  const repeaterRowsForRender =
    shouldVirtualizeRepeaterRows && virtualRepeaterRows.length > 0
      ? virtualRepeaterRows
      : repeatersFiltered.map((node, index) => ({
          index,
          start: index * REPEATER_ROW_ESTIMATE_PX,
          end: (index + 1) * REPEATER_ROW_ESTIMATE_PX,
          size: REPEATER_ROW_ESTIMATE_PX,
          key: node.node_id,
          lane: 0 as const,
        }));

  useEffect(() => {
    if (!shouldVirtualizeRepeaterRows) return;
    repeaterRowVirtualizer.measure();
  }, [
    expandedNeighbors,
    expandedTelemetry,
    expandedPath,
    expandedCli,
    shouldVirtualizeRepeaterRows,
    repeaterRowVirtualizer,
  ]);

  const handleForgetSavedPassword = async (
    nodeId: number,
    kind: MeshcoreInfraAdminPasswordEntry['kind'],
  ) => {
    const confirmKey = `${kind}:${nodeId}`;
    if (forgetConfirmKey !== confirmKey) {
      setForgetConfirmKey(confirmKey);
      return;
    }
    setForgetConfirmKey(null);
    try {
      await forgetAdminPassword(nodeId, kind);
      refreshStoredSecrets();
      addToast(t('repeatersPanel.passwordForgotten'), 'success');
    } catch (e) {
      console.warn('[RepeatersPanel] forget saved password failed ' + errLikeToLogString(e));
    }
  };

  const handleStatus = async (nodeId: number) => {
    await runRepeaterAdminAction(
      t,
      nodeId,
      nodes,
      (id) => t('repeatersPanel.savedPasswordOrphanLabel', { nodeId: id.toString(16) }),
      ensureRepeaterAuth,
      refreshStoredSecrets,
      () => onRequestRepeaterStatus(nodeId),
      'repeatersPanel.statusFailedToast',
      'requestRepeaterStatus error',
      addToast,
    );
  };

  const handlePing = async (nodeId: number) => {
    try {
      const ok = await onPing(nodeId);
      if (ok === false) {
        const raw = meshcorePingErrors?.get(nodeId);
        const message = raw
          ? translateMeshcoreUserMessage(t, raw)
          : t('meshcore.errors.pingFailed');
        addToast(t('repeatersPanel.pingFailedToast', { message }), 'error');
      }
    } catch (e) {
      console.warn('[RepeatersPanel] ping error ' + errLikeToLogString(e));
      addToast(
        t('repeatersPanel.pingFailedToast', {
          message: meshcoreRepeaterAdminErrorMessage(t, e),
        }),
        'error',
      );
    }
  };

  const handleDelete = async (nodeId: number) => {
    if (deleteConfirmId !== nodeId) {
      setDeleteConfirmId(nodeId);
      return;
    }
    setDeleteConfirmId(null);
    setDeleteLoadingSet((prev) => new Set([...prev, nodeId]));
    try {
      await onDeleteRepeater(nodeId);
    } catch (e) {
      console.warn('[RepeatersPanel] deleteRepeater failed:', e instanceof Error ? e.message : e);
      addToast(
        t('repeatersPanel.removeFailedToast', {
          message: meshcoreRepeaterAdminErrorMessage(t, e),
        }),
        'error',
      );
    } finally {
      setDeleteLoadingSet((prev) => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
    }
  };

  const handleNeighbors = async (nodeId: number, opts?: { loadMore?: boolean }) => {
    const node = nodes.get(nodeId);
    if (node && isMeshcoreNeighborsHopBlocked(node)) return;
    const isLoadMore = opts?.loadMore === true;
    if (!isLoadMore && expandedNeighbors.has(nodeId)) {
      setExpandedNeighbors((prev) => {
        const n = new Set(prev);
        n.delete(nodeId);
        return n;
      });
      return;
    }
    setNeighborsUiPending((prev) => new Set(prev).add(nodeId));
    try {
      await runRepeaterAdminAction(
        t,
        nodeId,
        nodes,
        (id) => t('repeatersPanel.savedPasswordOrphanLabel', { nodeId: id.toString(16) }),
        ensureRepeaterAuth,
        refreshStoredSecrets,
        async () => {
          // Re-read length after auth so concurrent refresh / double-submit do not reuse a stale offset.
          if (isLoadMore) {
            const requestOffset = meshcoreNeighborsRef.current?.get(nodeId)?.neighbours.length ?? 0;
            if (requestOffset <= 0) return;
            await onRequestNeighbors?.(nodeId, { offset: requestOffset });
            return;
          }
          await onRequestNeighbors?.(nodeId);
          setExpandedNeighbors((prev) => new Set([...prev, nodeId]));
        },
        'repeatersPanel.neighborsFailedToast',
        isLoadMore ? 'requestNeighbors load more error' : 'requestNeighbors error',
        addToast,
      );
    } finally {
      setNeighborsUiPending((prev) => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
    }
  };

  const handleNeighborsLoadMore = async (nodeId: number) => {
    await handleNeighbors(nodeId, { loadMore: true });
  };

  const handleTelemetry = async (nodeId: number) => {
    if (expandedTelemetry.has(nodeId)) {
      setExpandedTelemetry((prev) => {
        const n = new Set(prev);
        n.delete(nodeId);
        return n;
      });
      return;
    }
    await runRepeaterAdminAction(
      t,
      nodeId,
      nodes,
      (id) => t('repeatersPanel.savedPasswordOrphanLabel', { nodeId: id.toString(16) }),
      ensureRepeaterAuth,
      refreshStoredSecrets,
      async () => {
        await onRequestTelemetry?.(nodeId);
        setExpandedTelemetry((prev) => new Set([...prev, nodeId]));
      },
      'repeatersPanel.telemetryFailedToast',
      'requestTelemetry error',
      addToast,
    );
  };

  const togglePath = (nodeId: number) => {
    setExpandedPath((prev) => {
      const n = new Set(prev);
      if (n.has(nodeId)) n.delete(nodeId);
      else n.add(nodeId);
      return n;
    });
  };

  const toggleCli = (nodeId: number) => {
    setExpandedCli((prev) => {
      const n = new Set(prev);
      if (n.has(nodeId)) n.delete(nodeId);
      else n.add(nodeId);
      return n;
    });
  };

  const ensureCliRoutePrimed = async (nodeId: number): Promise<boolean> => {
    if (meshcoreTraceResults.get(nodeId) != null) return true;
    const hops = nodes.get(nodeId)?.hops_away ?? 0;
    if (hops <= 0) return true;
    addToast(t('repeatersPanel.cliAutoPingToast'), 'info');
    try {
      const pingOk = await onPing(nodeId);
      if (pingOk === false) {
        addToast(t('repeatersPanel.cliAutoPingFailed'), 'error');
        return false;
      }
      if (meshcoreTraceResults.get(nodeId) != null || pingOk === true) return true;
      addToast(t('repeatersPanel.cliAutoPingFailed'), 'error');
      return false;
    } catch (e) {
      console.warn('[RepeatersPanel] CLI auto-ping failed ' + errLikeToLogString(e));
      addToast(t('repeatersPanel.cliAutoPingFailed'), 'error');
      return false;
    }
  };

  const sendAuthenticatedCliCommand = async (
    nodeId: number,
    command: string,
    opts?: MeshcoreRepeaterCliOptions,
  ) => {
    if (!onSendCliCommand || !command.trim()) {
      throw new Error(t('infraConfig.commandRejected'));
    }
    const node = nodes.get(nodeId);
    const auth = await ensureRepeaterAuth(
      nodeId,
      node?.long_name ??
        t(
          node?.hw_model === 'Room'
            ? 'repeatersPanel.savedPasswordOrphanRoomLabel'
            : 'repeatersPanel.savedPasswordOrphanLabel',
          { nodeId: nodeId.toString(16) },
        ),
      node?.hw_model,
    );
    if (opts?.isCurrent && !opts.isCurrent()) throw new Error(t('infraConfig.sessionChanged'));
    if (!auth.ok) throw new Error(t('infraConfig.authCancelled'));
    if (auth.saved) refreshStoredSecrets();
    const primed = await ensureCliRoutePrimed(nodeId);
    if (!primed) throw new Error(t('repeatersPanel.cliAutoPingFailed'));
    if (opts?.isCurrent && !opts.isCurrent()) throw new Error(t('infraConfig.sessionChanged'));
    return onSendCliCommand(nodeId, normalizeMeshcoreCliCommand(command), opts);
  };

  const runCliCommand = async (
    nodeId: number,
    command: string,
    opts?: MeshcoreRepeaterCliOptions,
  ) => {
    try {
      const response = await sendAuthenticatedCliCommand(nodeId, command, opts);
      if (isRepeaterCliClockCannotGoBackwards(command, response)) {
        addToast(
          t('repeatersPanel.cliClockCannotGoBackwards', { utc: formatComputerUtcStamp() }),
          'info',
        );
      }
    } catch (e) {
      console.warn('[RepeatersPanel] CLI command error ' + errLikeToLogString(e));
      addToast(meshcoreRepeaterAdminErrorMessage(t, e), 'error');
    }
  };

  const handleCliCommand = async (nodeId: number, command: string) => {
    if (!command.trim()) return;
    if (isMeshcoreRepeaterCliDangerCommand(command)) {
      setCliDangerConfirm({ nodeId, command: command.trim() });
      return;
    }
    await runCliCommand(nodeId, command);
  };

  const handleCliQuickCommand = async (nodeId: number, command: string) => {
    setCliInputValues((prev) => {
      const n = new Map(prev);
      n.set(nodeId, command);
      return n;
    });
    await handleCliCommand(nodeId, command);
  };

  const handleCliClear = (nodeId: number) => {
    onClearCliHistory?.(nodeId);
  };

  const handleCliKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, nodeId: number) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const value = cliInputValues.get(nodeId) ?? '';
      if (value.trim()) {
        void handleCliCommand(nodeId, value);
        setCliInputValues((prev) => {
          const n = new Map(prev);
          n.delete(nodeId);
          return n;
        });
      }
    }
  };

  const configNode = configNodeId == null ? undefined : nodes.get(configNodeId);
  if (configNode && onSendCliCommand) {
    return (
      <>
        <MeshcoreInfraConfigPanel
          key={`${configNode.node_id}:${isConnected}`}
          node={configNode}
          isConnected={isConnected}
          onSend={(command, isCurrent) =>
            sendAuthenticatedCliCommand(configNode.node_id, command, { isCurrent })
          }
          onBack={() => {
            setConfigNodeId(null);
          }}
          onOpenCli={() => {
            setExpandedCli((previous) => new Set([...previous, configNode.node_id]));
            setConfigNodeId(null);
          }}
        />
        {RemoteAuthModal}
      </>
    );
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-ink-200 text-base font-semibold">{t('repeatersPanel.title')}</h2>
          <SegmentedControl
            aria-label={t('repeatersPanel.typeFilterAria')}
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: 'all', label: t('repeatersPanel.filterAll') },
              { value: 'repeater', label: t('repeatersPanel.filterRepeaters') },
              { value: 'room', label: t('repeatersPanel.filterRooms') },
            ]}
          />
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
              placeholder={t('repeatersPanel.searchRepeatersPlaceholder')}
              aria-label={t('repeatersPanel.searchRepeaters')}
              className={`${INPUT_CLASS} pl-8`}
            />
          </div>
        </div>
        <p className="text-muted max-w-2xl text-xs">{t('repeatersPanel.columnsDataHint')}</p>

        {savedCredentialEntries.length > 0 && (
          <div className="bg-deep-black border-ink-800 rounded-xl border">
            <button
              type="button"
              onClick={() => {
                setSavedPasswordsOpen((open) => !open);
              }}
              className="hover:bg-sidebar-active-bg/60 text-ink-300 flex w-full items-center gap-1.5 rounded-xl px-3 py-2 text-left text-xs font-medium"
              aria-expanded={savedPasswordsOpen}
            >
              {savedPasswordsOpen ? (
                <ChevronDown aria-hidden className={`${ICON_SM_PLUS} text-muted`} size={14} />
              ) : (
                <ChevronRight aria-hidden className={`${ICON_SM_PLUS} text-muted`} size={14} />
              )}
              {t('repeatersPanel.savedPasswordsCount', { count: savedCredentialEntries.length })}
            </button>
            {savedPasswordsOpen && (
              <ul className="border-ink-800 max-h-40 overflow-y-auto border-t pb-1">
                {savedCredentialEntries.map(({ nodeId, kind }) => (
                  <li
                    key={`${kind}:${nodeId}`}
                    className="border-ink-800 flex items-center justify-between gap-2 border-b px-3 py-1.5 last:border-b-0"
                  >
                    <span className="text-ink-200 flex min-w-0 items-center gap-2 truncate text-xs">
                      <span
                        className={`text-2xs shrink-0 rounded px-1 py-0.5 font-medium ${
                          kind === 'Room'
                            ? 'bg-purple-900/50 text-purple-300'
                            : 'bg-cyan-900/50 text-cyan-300'
                        }`}
                      >
                        {kind === 'Room'
                          ? t('nodeListPanel.meshcoreTypeRoom')
                          : t('nodeListPanel.meshcoreTypeRepeater')}
                      </span>
                      <span className="truncate">{resolveNodeDisplayName(nodeId, kind)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        void handleForgetSavedPassword(nodeId, kind);
                      }}
                      onBlur={() => {
                        if (forgetConfirmKey === `${kind}:${nodeId}`) setForgetConfirmKey(null);
                      }}
                      className={buttonClassName('danger', 'sm')}
                      aria-label={t('repeatersPanel.forgetPasswordAria')}
                    >
                      {forgetConfirmKey === `${kind}:${nodeId}`
                        ? t('repeatersPanel.buttonConfirmRemove')
                        : t('repeatersPanel.forgetPassword')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {infraNodes.length === 0 ? (
          <div className="text-muted mt-8 text-center text-sm">
            <p>{t('repeatersPanel.noRepeatersYet')}</p>
            <p className="mt-1">
              {t('repeatersPanel.noRepeatersHintPre')}
              <strong>{t('repeatersPanel.importContacts')}</strong>
              {t('repeatersPanel.noRepeatersHintMid')}
              <strong>{t('repeatersPanel.nodesTabName')}</strong>
              {t('repeatersPanel.noRepeatersHintSuffix')}
            </p>
          </div>
        ) : repeatersFiltered.length === 0 ? (
          <div className="text-muted mt-4 text-center text-sm">
            {t('repeatersPanel.noRepeatersMatch')}
          </div>
        ) : (
          <div
            ref={repeaterTableScrollRef}
            className="bg-deep-black border-ink-800 min-h-0 min-w-0 flex-1 overflow-auto rounded-xl border"
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-deep-black text-muted border-ink-800 sticky top-0 z-10 border-b text-left text-xs">
                  {(
                    [
                      ['status', 'repeatersPanel.columnStatus'],
                      ['name', 'repeatersPanel.columnName'],
                      ['lastHeard', 'repeatersPanel.columnLastHeard'],
                      ['snr', 'repeatersPanel.columnSnr', 'repeatersPanel.snrDbTooltip'],
                      ['rssi', 'repeatersPanel.columnRssi', 'repeatersPanel.rssiDbmTooltip'],
                      ['hops', 'repeatersPanel.columnHops', 'repeatersPanel.hopCountTooltip'],
                      ['uptime', 'repeatersPanel.columnUptime'],
                      ['airPct', 'repeatersPanel.columnAirPct'],
                      ['reliability', 'repeatersPanel.columnReliability'],
                    ] as const
                  ).map(([columnKey, labelKey, titleKey]) => (
                    <RepeaterSortHeader
                      key={columnKey}
                      columnKey={columnKey}
                      sortKey={sortKey}
                      sortDir={sortDir}
                      columnLabel={t(labelKey)}
                      ariaLabel={t(
                        repeaterSortAriaKey(
                          columnKey,
                          sortKey === columnKey ? sortDir : defaultRepeaterSortDir(columnKey),
                        ),
                      )}
                      title={titleKey ? t(titleKey) : undefined}
                      onSort={toggleRepeaterSort}
                    />
                  ))}
                  <th className="py-2 pr-3 font-medium">{t('repeatersPanel.columnActions')}</th>
                </tr>
              </thead>
              <tbody className="divide-ink-800 divide-y">
                {shouldVirtualizeRepeaterRows &&
                  virtualRepeaterRows.length > 0 &&
                  virtualRepeaterRows[0].start > 0 && (
                    <tr>
                      <td
                        colSpan={10}
                        style={{ height: virtualRepeaterRows[0].start, padding: 0, border: 0 }}
                      />
                    </tr>
                  )}
                {repeaterRowsForRender.map((virtualRow) => {
                  const node = repeatersFiltered[virtualRow.index];
                  if (!node) return null;
                  const status = meshcoreNodeStatus.get(node.node_id);
                  const traceResult = meshcoreTraceResults.get(node.node_id);
                  const repeaterStatus = getNodeStatus(
                    node.last_heard,
                    nodeStaleThresholdMs,
                    nodeOfflineThresholdMs,
                  );
                  const history = signalHistory.get(node.node_id) ?? [];
                  const paths = pathHistory.get(node.node_id) ?? [];
                  const currentRoute = meshcoreDisplayRouteFromPathSelection(
                    paths.length > 0
                      ? usePathHistoryStore.getState().selectBestPath(node.node_id)
                      : null,
                  );
                  const currentRouteSegments = currentRoute
                    ? buildMeshcorePathChainSegments({
                        pathBytes: currentRoute.pathBytes,
                        hashSizeBytes: currentRoute.hashSizeBytes,
                        getNodeLabel: pathResolution.getNodeLabel,
                        pubKeyByNodeId: pathResolution.pubKeyByNodeId,
                        candidates: pathResolution.candidates,
                      })
                    : [];
                  const traceMatchesCurrentRoute =
                    traceResult != null &&
                    currentRoute != null &&
                    meshcorePathBytesEqual(traceResult.pathHashes, currentRoute.pathBytes);
                  const canExpandPath = traceResult != null || currentRoute != null;
                  const traceHopRows =
                    traceResult != null
                      ? meshcoreTraceHopDisplayRows({
                          pathHashes: traceResult.pathHashes ?? [],
                          pathSnrs: Array.isArray(traceResult.pathSnrs) ? traceResult.pathSnrs : [],
                          hashSizeBytes: traceResult.hashSizeBytes ?? 1,
                          destNodeId: node.node_id,
                          getNodeLabel: pathResolution.getNodeLabel,
                          pubKeyByNodeId: pathResolution.pubKeyByNodeId,
                          candidates: pathResolution.candidates,
                        })
                      : [];
                  const reliabilityText = displayReliability(paths);
                  const airPct = resolveRepeaterAirPct(status);
                  const isStatusLoading = isRepeaterAdminRpcPending(
                    meshcoreRepeaterRpcPending,
                    node.node_id,
                    'status',
                  );
                  const isPingLoading = isRepeaterAdminRpcPending(
                    meshcoreRepeaterRpcPending,
                    node.node_id,
                    'ping',
                  );
                  const statusErrorRaw = meshcoreStatusErrors?.get(node.node_id);
                  const pingErrorRaw = meshcorePingErrors?.get(node.node_id);
                  const isDeleteLoading = deleteLoadingSet.has(node.node_id);
                  const isDeleteConfirm = deleteConfirmId === node.node_id;
                  const isNeighborsLoading =
                    isRepeaterAdminRpcPending(
                      meshcoreRepeaterRpcPending,
                      node.node_id,
                      'neighbors',
                    ) || neighborsUiPending.has(node.node_id);
                  const isTelemetryLoading = isRepeaterAdminRpcPending(
                    meshcoreRepeaterRpcPending,
                    node.node_id,
                    'telemetry',
                  );
                  const isNeighborsExpanded = expandedNeighbors.has(node.node_id);
                  const isTelemetryExpanded = expandedTelemetry.has(node.node_id);
                  const isPathExpanded = expandedPath.has(node.node_id);
                  const isCliExpanded = expandedCli.has(node.node_id);
                  const isCliLoading = isRepeaterAdminRpcPending(
                    meshcoreRepeaterRpcPending,
                    node.node_id,
                    'cli',
                  );
                  const cliHistory = meshcoreCliHistories?.get(node.node_id) ?? [];
                  const cliErrorRaw = meshcoreCliErrors?.get(node.node_id);
                  const cliHopCount =
                    traceResult != null
                      ? meshcoreTracePathLenToHops(traceResult.pathLen)
                      : (node.hops_away ?? 0);
                  const showCliMultiHopHint = cliHopCount > 0 && traceResult == null;
                  const neighborErrorRaw = meshcoreNeighborErrors?.get(node.node_id);
                  const statusErrorText = statusErrorRaw
                    ? translateMeshcoreUserMessage(t, statusErrorRaw)
                    : undefined;
                  const pingErrorText = pingErrorRaw
                    ? translateMeshcoreUserMessage(t, pingErrorRaw)
                    : undefined;
                  const neighborErrorText = neighborErrorRaw
                    ? translateMeshcoreUserMessage(t, neighborErrorRaw)
                    : undefined;
                  const cliErrorText = cliErrorRaw
                    ? translateMeshcoreUserMessage(t, cliErrorRaw)
                    : undefined;
                  const renderCliQuickPill = (cmd: string) => {
                    const label = CLI_QUICK_COMMAND_LABELS[cmd];
                    const ariaLabel = label?.ariaKey ? t(label.ariaKey) : cmd;
                    const title = label?.titleKey ? t(label.titleKey) : ariaLabel;
                    return (
                      <button
                        key={cmd}
                        type="button"
                        onClick={() => void handleCliQuickCommand(node.node_id, cmd)}
                        disabled={!isConnected || isCliLoading}
                        title={title}
                        aria-label={ariaLabel}
                        className="bg-sidebar-active-bg border-secondary-dark hover:bg-secondary-dark text-meta text-ink-300 h-6 rounded-md border px-2 font-mono disabled:opacity-40"
                      >
                        {label?.short ?? cmd}
                      </button>
                    );
                  };
                  const neighborData = meshcoreNeighbors?.get(node.node_id);
                  const telemetryData = meshcoreTelemetry?.get(node.node_id);
                  const telemetryErrorRaw = meshcoreTelemetryErrors?.get(node.node_id);
                  const telemetryErrorText = telemetryErrorRaw
                    ? translateMeshcoreUserMessage(t, telemetryErrorRaw)
                    : undefined;
                  const pingHardDisabled = !isConnected || isPingLoading;
                  const anyPingPendingElsewhere =
                    meshcoreRepeaterRpcPending &&
                    [...meshcoreRepeaterRpcPending.entries()].some(
                      ([id, kinds]) => kinds.has('ping') && id !== node.node_id,
                    );
                  const pingBlockReason = !isConnected
                    ? t('repeatersPanel.connectRadioFirst')
                    : isPingLoading && anyPingPendingElsewhere
                      ? t('repeatersPanel.pingQueuedBehindOther')
                      : isPingLoading
                        ? t('repeatersPanel.pingInProgress')
                        : null;
                  const anyPingPending =
                    meshcoreRepeaterRpcPending &&
                    [...meshcoreRepeaterRpcPending.values()].some((kinds) => kinds.has('ping'));
                  const neighborHopBlocked = isMeshcoreNeighborsHopBlocked(node);
                  const rowDisplayName = resolveNodeDisplayName(
                    node.node_id,
                    node.hw_model === 'Room' ? 'Room' : 'Repeater',
                  );
                  return (
                    <Fragment key={node.node_id}>
                      <tr
                        className="hover:bg-sidebar-active-bg/60 border-ink-800 text-ink-300 border-b"
                        data-index={shouldVirtualizeRepeaterRows ? virtualRow.index : undefined}
                        ref={
                          shouldVirtualizeRepeaterRows
                            ? repeaterRowVirtualizer.measureElement
                            : undefined
                        }
                      >
                        <td className="py-2 pr-4">
                          <span className="flex items-center gap-1.5">
                            <span
                              className={`h-2 w-2 rounded-full ${
                                repeaterStatus === 'online'
                                  ? 'bg-green-500'
                                  : repeaterStatus === 'stale'
                                    ? 'bg-violet-900'
                                    : 'bg-ink-700'
                              }`}
                            />
                            <span
                              className={
                                repeaterStatus === 'online'
                                  ? 'text-xs text-green-400'
                                  : repeaterStatus === 'stale'
                                    ? 'text-xs text-violet-400'
                                    : 'text-ink-400 text-xs'
                              }
                            >
                              {repeaterStatus === 'online'
                                ? t('repeatersPanel.statusOnline')
                                : repeaterStatus === 'stale'
                                  ? t('repeatersPanel.statusStale')
                                  : t('repeatersPanel.statusOffline')}
                            </span>
                          </span>
                        </td>
                        <td className="py-2 pr-4 font-medium text-white">
                          <span className="flex flex-wrap items-center gap-1">
                            {onToggleFavorite ? (
                              <button
                                type="button"
                                onClick={() => {
                                  onToggleFavorite(node.node_id, !node.favorited);
                                }}
                                className="leading-none text-yellow-400/70 hover:text-yellow-400"
                                aria-label={
                                  node.favorited
                                    ? t('repeatersPanel.unfavorite')
                                    : t('repeatersPanel.favorite')
                                }
                                aria-pressed={node.favorited}
                              >
                                <Star
                                  aria-hidden
                                  className="h-4 w-4"
                                  fill={node.favorited ? 'currentColor' : 'none'}
                                />
                              </button>
                            ) : null}
                            <span
                              className={`text-2xs shrink-0 rounded px-1 py-0.5 font-medium ${
                                node.hw_model === 'Room'
                                  ? 'bg-purple-900/50 text-purple-300'
                                  : 'bg-cyan-900/50 text-cyan-300'
                              }`}
                            >
                              {node.hw_model === 'Room'
                                ? t('nodeListPanel.meshcoreTypeRoom')
                                : t('nodeListPanel.meshcoreTypeRepeater')}
                            </span>
                            <button
                              type="button"
                              onClick={() => onSelectRepeater?.(node)}
                              aria-label={node.long_name}
                              className="hover:text-brand-green hover:decoration-brand-green/70 text-white underline decoration-transparent transition-colors disabled:no-underline"
                            >
                              {node.long_name}
                            </button>
                            {savedCredentialEntries.some((e) => e.nodeId === node.node_id) ? (
                              <MeshcoreRepeaterSavedPasswordIndicator />
                            ) : null}
                          </span>
                        </td>
                        <td className="text-ink-400 py-2 pr-4 text-xs">
                          {formatRelativeTime(t, node.last_heard)}
                        </td>
                        <td
                          className="py-2 pr-4"
                          title={
                            status !== undefined
                              ? t('repeatersPanel.snrFromStatusTooltip')
                              : t('repeatersPanel.snrContactTooltip')
                          }
                        >
                          {displayRepeaterSnr(node, status, history, meshcoreContactsDb)}
                        </td>
                        <td
                          className="py-2 pr-4"
                          title={
                            status !== undefined
                              ? t('repeatersPanel.rssiFromStatusTooltip')
                              : t('repeatersPanel.rssiContactTooltip')
                          }
                        >
                          {displayRepeaterRssi(node, status, meshcoreContactsDb)}
                        </td>
                        <td className="py-2 pr-4">
                          {canExpandPath ? (
                            <button
                              type="button"
                              onClick={() => {
                                togglePath(node.node_id);
                              }}
                              className="text-left text-indigo-400 underline decoration-dotted hover:text-indigo-300"
                              title={t('repeatersPanel.hopCountTooltip')}
                              aria-label={t('repeatersPanel.hopCountTooltip')}
                            >
                              {traceResult
                                ? meshcoreTracePathLenToHops(traceResult.pathLen)
                                : (currentRoute?.hopCount ?? node.hops_away ?? '—')}
                            </button>
                          ) : node.hops_away != null ? (
                            <span className="text-ink-300">{node.hops_away}</span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-4">{formatUptime(t, status?.totalUpTimeSecs)}</td>
                        <td className="py-2 pr-4">
                          {airPct != null ? `${airPct.toFixed(1)}%` : '—'}
                        </td>
                        <td className="py-2 pr-4">{reliabilityText}</td>
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-1.5">
                            {pingErrorText ? (
                              <HelpTooltip
                                text={t('repeatersPanel.pingLastFailedTooltip', {
                                  error: pingErrorText,
                                })}
                              >
                                <span className="inline-flex">
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    onClick={() => void handlePing(node.node_id)}
                                    disabled={!isConnected || isPingLoading}
                                    aria-label={t('repeatersPanel.pingError', {
                                      error: pingErrorText,
                                    })}
                                  >
                                    {isPingLoading
                                      ? rowSpinner
                                      : t('repeatersPanel.buttonErrorShort')}
                                  </Button>
                                </span>
                              </HelpTooltip>
                            ) : pingHardDisabled && pingBlockReason ? (
                              <HelpTooltip text={pingBlockReason}>
                                <span className="inline-flex">
                                  <Button
                                    size="sm"
                                    onClick={() => void handlePing(node.node_id)}
                                    disabled
                                    aria-label={t('repeatersPanel.pingTrace')}
                                  >
                                    {isPingLoading ? rowSpinner : t('repeatersPanel.buttonPing')}
                                  </Button>
                                </span>
                              </HelpTooltip>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() => void handlePing(node.node_id)}
                                aria-label={t('repeatersPanel.pingTrace')}
                              >
                                {t('repeatersPanel.buttonPing')}
                              </Button>
                            )}
                            {onOpenRoom && node.hw_model === 'Room' ? (
                              <Button
                                size="sm"
                                onClick={() => {
                                  onOpenRoom(node.node_id);
                                }}
                                disabled={!isConnected}
                                aria-label={t('repeatersPanel.openRoom')}
                              >
                                {t('repeatersPanel.openRoom')}
                              </Button>
                            ) : null}
                            {isDeleteConfirm ? (
                              <Button
                                ref={focusOnMount}
                                variant="danger"
                                size="sm"
                                onClick={() => void handleDelete(node.node_id)}
                                disabled={isDeleteLoading}
                                onBlur={() => {
                                  setDeleteConfirmId(null);
                                }}
                                aria-label={t('repeatersPanel.confirmRemoveAria', {
                                  name: rowDisplayName,
                                })}
                              >
                                {isDeleteLoading
                                  ? rowSpinner
                                  : t('repeatersPanel.buttonConfirmRemove')}
                              </Button>
                            ) : null}
                            {isStatusLoading ||
                            isNeighborsLoading ||
                            isTelemetryLoading ||
                            isCliLoading ||
                            isDeleteLoading ? (
                              <span
                                role="status"
                                aria-label={t('repeatersPanel.rowBusy', { name: rowDisplayName })}
                                className="text-muted inline-flex"
                              >
                                {rowSpinner}
                              </span>
                            ) : null}
                            <MenuButton
                              size="sm"
                              aria-label={t('repeatersPanel.moreActionsFor', {
                                name: rowDisplayName,
                              })}
                              menuLabel={t('repeatersPanel.rowActionsMenu', {
                                name: rowDisplayName,
                              })}
                              icon={<Ellipsis aria-hidden className={ICON_MD} size={16} />}
                              entries={[
                                {
                                  id: 'status',
                                  label: t('repeatersPanel.requestStatus'),
                                  description:
                                    isStatusLoading && anyPingPending
                                      ? t('repeatersPanel.waitForPingBeforeStatus')
                                      : statusErrorText && !isStatusLoading
                                        ? t('repeatersPanel.statusError', {
                                            error: statusErrorText,
                                          })
                                        : undefined,
                                  tone: statusErrorText && !isStatusLoading ? 'danger' : undefined,
                                  disabled: !isConnected || isStatusLoading,
                                  onSelect: () => void handleStatus(node.node_id),
                                },
                                ...(onRequestNeighbors
                                  ? [
                                      {
                                        id: 'neighbors',
                                        label: t('repeatersPanel.repeaterNeighbors'),
                                        description: neighborHopBlocked
                                          ? t('repeatersPanel.neighborsHopTooFar', {
                                              hops: MESHCORE_NEIGHBORS_MAX_RECOMMENDED_HOPS,
                                            })
                                          : neighborErrorText &&
                                              !isNeighborsExpanded &&
                                              !isNeighborsLoading
                                            ? t('repeatersPanel.neighborsError', {
                                                error: neighborErrorText,
                                              })
                                            : isNeighborsExpanded
                                              ? t('repeatersPanel.menuShownBelow')
                                              : undefined,
                                        tone:
                                          neighborErrorText &&
                                          !isNeighborsExpanded &&
                                          !isNeighborsLoading
                                            ? ('danger' as const)
                                            : undefined,
                                        disabled:
                                          !isConnected || isNeighborsLoading || neighborHopBlocked,
                                        onSelect: () => void handleNeighbors(node.node_id),
                                      },
                                    ]
                                  : []),
                                ...(onRequestTelemetry
                                  ? [
                                      {
                                        id: 'telemetry',
                                        label: t('repeatersPanel.sensorTelemetryLpp'),
                                        description:
                                          telemetryErrorText &&
                                          !isTelemetryLoading &&
                                          !isTelemetryExpanded
                                            ? t('repeatersPanel.telemetryError', {
                                                error: telemetryErrorText,
                                              })
                                            : isTelemetryExpanded
                                              ? t('repeatersPanel.menuShownBelow')
                                              : t('repeatersPanel.cayenneLppTooltip'),
                                        tone:
                                          telemetryErrorText &&
                                          !isTelemetryLoading &&
                                          !isTelemetryExpanded
                                            ? ('danger' as const)
                                            : undefined,
                                        disabled: !isConnected || isTelemetryLoading,
                                        onSelect: () => void handleTelemetry(node.node_id),
                                      },
                                    ]
                                  : []),
                                ...(onSendCliCommand
                                  ? [
                                      {
                                        id: 'configure',
                                        label: t('infraConfig.configure'),
                                        disabled: !isConnected || isCliLoading,
                                        onSelect: () => {
                                          setConfigNodeId(node.node_id);
                                        },
                                      },
                                      {
                                        id: 'cli',
                                        label: t('repeatersPanel.cliInterface'),
                                        description:
                                          cliErrorText && !isCliExpanded
                                            ? t('repeatersPanel.actionErrorCli', {
                                                error: cliErrorText,
                                              })
                                            : isCliExpanded
                                              ? t('repeatersPanel.menuShownBelow')
                                              : undefined,
                                        tone:
                                          cliErrorText && !isCliExpanded
                                            ? ('danger' as const)
                                            : undefined,
                                        disabled: !isConnected,
                                        onSelect: () => {
                                          toggleCli(node.node_id);
                                        },
                                      },
                                    ]
                                  : []),
                                'separator' as const,
                                {
                                  id: 'remove',
                                  label: t('repeatersPanel.buttonRemove'),
                                  icon: <Trash2 aria-hidden className={ICON_MD} size={16} />,
                                  tone: 'danger' as const,
                                  disabled: isDeleteLoading,
                                  onSelect: () => void handleDelete(node.node_id),
                                },
                              ]}
                            />
                          </div>
                          {pingErrorText ? (
                            <p className="mt-1 max-w-[18rem] text-xs leading-snug text-red-400">
                              {pingErrorText}
                            </p>
                          ) : null}
                        </td>
                      </tr>

                      {/* Path / current-route detail row */}
                      {isPathExpanded && canExpandPath && (
                        <tr className="bg-app-bg/60 border-ink-800 border-b">
                          <td colSpan={10} className="px-4 py-2">
                            <div className="flex flex-col gap-2">
                              {traceResult ? (
                                <div className="flex flex-wrap items-center gap-1 text-xs">
                                  <span className="text-ink-400 mr-1">
                                    {t('repeatersPanel.pathLabel')}
                                  </span>
                                  <span className="text-brand-green">
                                    {t('repeatersPanel.hopMe')}
                                  </span>
                                  {traceHopRows.map((hop, i) => (
                                    <span key={i} className="flex items-center gap-1">
                                      <span className="text-ink-600">→</span>
                                      <span
                                        className="rounded bg-indigo-900/40 px-1.5 py-0.5 font-mono text-indigo-300"
                                        title={meshcoreHopSegmentTooltip(t, hop)}
                                      >
                                        {hop.label ||
                                          `${hop.snr > 0 ? '+' : ''}${hop.snr.toFixed(2)} dB`}
                                      </span>
                                      <span className="text-muted">
                                        {hop.snr > 0 ? '+' : ''}
                                        {hop.snr.toFixed(2)} dB
                                      </span>
                                    </span>
                                  ))}
                                  <span className="text-ink-600">→</span>
                                  <span className="bg-brand-green/20 text-brand-green rounded px-1.5 py-0.5 font-mono">
                                    {traceResult.lastSnr > 0 ? '+' : ''}
                                    {traceResult.lastSnr.toFixed(2)} dB
                                  </span>
                                  <span className="text-white">▣ {node.long_name}</span>
                                </div>
                              ) : null}
                              {currentRoute && !traceMatchesCurrentRoute ? (
                                <div className="flex flex-wrap items-center gap-1 text-xs">
                                  <span className="text-ink-400 mr-1">
                                    {t('repeatersPanel.currentRouteLabel')}
                                  </span>
                                  <MeshcoreRouteChain
                                    segments={currentRouteSegments}
                                    destLabel={node.long_name}
                                  />
                                </div>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      )}

                      {/* Neighbors detail row */}
                      {isNeighborsExpanded && neighborData && (
                        <tr className="bg-app-bg/60 border-ink-800 border-b">
                          <td colSpan={10} className="px-4 py-2">
                            <p className="text-ink-400 mb-1 text-xs">
                              {t('repeatersPanel.neighborsHeading', {
                                count: neighborData.totalNeighboursCount,
                              })}
                            </p>
                            {neighborData.neighbours.length === 0 ? (
                              <p className="text-ink-600 text-xs">
                                {t('repeatersPanel.noNeighborsReported')}
                              </p>
                            ) : (
                              <div className="flex flex-col gap-1">
                                {neighborData.neighbours.map((nb, i) => {
                                  const name = nb.resolvedNodeId
                                    ? (nodes.get(nb.resolvedNodeId)?.long_name ?? nb.prefixHex)
                                    : nb.prefixHex;
                                  return (
                                    <div key={i} className="flex items-center gap-3 text-xs">
                                      <span className="text-muted font-mono">{nb.prefixHex}</span>
                                      <span className="text-ink-300">[{name}]</span>
                                      <SnrIndicator snr={nb.snr} />
                                      <span className="text-muted">
                                        {t('repeatersPanel.heardPrefix')}
                                        {formatSecondsAgo(nb.heardSecondsAgo, t)}
                                      </span>
                                    </div>
                                  );
                                })}
                                {neighborData.totalNeighboursCount >
                                  neighborData.neighbours.length &&
                                  neighborData.neighbours.length > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => void handleNeighborsLoadMore(node.node_id)}
                                      disabled={
                                        !isConnected || isNeighborsLoading || neighborHopBlocked
                                      }
                                      aria-busy={isNeighborsLoading}
                                      title={
                                        neighborHopBlocked
                                          ? t('repeatersPanel.neighborsHopTooFar', {
                                              hops: MESHCORE_NEIGHBORS_MAX_RECOMMENDED_HOPS,
                                            })
                                          : undefined
                                      }
                                      aria-label={
                                        isNeighborsLoading
                                          ? t('repeatersPanel.neighborsLoadingMore')
                                          : t('repeatersPanel.neighborsLoadMoreAria', {
                                              loaded: neighborData.neighbours.length,
                                              total: neighborData.totalNeighboursCount,
                                            })
                                      }
                                      className="mt-1 self-start rounded border border-purple-700 bg-purple-900/40 px-2 py-0.5 text-xs font-medium text-purple-300 transition-colors hover:bg-purple-800/60 disabled:opacity-40"
                                    >
                                      {isNeighborsLoading
                                        ? t('repeatersPanel.neighborsLoadingMore')
                                        : t('repeatersPanel.neighborsLoadMore', {
                                            loaded: neighborData.neighbours.length,
                                            total: neighborData.totalNeighboursCount,
                                          })}
                                    </button>
                                  )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}

                      {/* Telemetry detail row */}
                      {isTelemetryExpanded && (
                        <tr className="bg-app-bg/60 border-ink-800 border-b">
                          <td colSpan={10} className="px-4 py-2">
                            {isTelemetryLoading ? (
                              <p className="text-muted text-xs">
                                {t('repeatersPanel.fetchingTelemetry')}
                              </p>
                            ) : telemetryData ? (
                              <div className="flex flex-wrap items-center gap-4 text-xs">
                                {telemetryData.voltage != null && (
                                  <span className="text-orange-300">
                                    {t('repeatersPanel.telemetryBattery', {
                                      voltage: telemetryData.voltage.toFixed(2),
                                    })}
                                  </span>
                                )}
                                {telemetryData.temperature != null && (
                                  <span className="text-indigo-300">
                                    {t('repeatersPanel.telemetryTemp', {
                                      temp: telemetryData.temperature.toFixed(1),
                                    })}
                                  </span>
                                )}
                                {telemetryData.relativeHumidity != null && (
                                  <span className="text-cyan-300">
                                    {t('repeatersPanel.telemetryHumidity', {
                                      humidity: telemetryData.relativeHumidity.toFixed(0),
                                    })}
                                  </span>
                                )}
                                {telemetryData.barometricPressure != null && (
                                  <span className="text-ink-300">
                                    {t('repeatersPanel.telemetryPressure', {
                                      pressure: telemetryData.barometricPressure.toFixed(1),
                                    })}
                                  </span>
                                )}
                                {telemetryData.gps && (
                                  <span className="text-green-300">
                                    {t('repeatersPanel.telemetryGps', {
                                      coords: formatCoordPair(
                                        telemetryData.gps.latitude,
                                        telemetryData.gps.longitude,
                                        coordinateFormat,
                                      ),
                                      alt: telemetryData.gps.altitude
                                        ? t('repeatersPanel.telemetryGpsAlt', {
                                            altitude: telemetryData.gps.altitude,
                                          })
                                        : '',
                                    })}
                                  </span>
                                )}
                                {telemetryData.voltage == null &&
                                  telemetryData.temperature == null &&
                                  telemetryData.relativeHumidity == null &&
                                  telemetryData.barometricPressure == null &&
                                  !telemetryData.gps && (
                                    <div className="text-muted flex flex-col gap-1">
                                      <span>{t('repeatersPanel.noLppData')}</span>
                                      {node.latitude != null && node.longitude != null ? (
                                        <span>{t('repeatersPanel.mapPositionFromAdvert')}</span>
                                      ) : null}
                                    </div>
                                  )}
                              </div>
                            ) : (
                              <div className="space-y-1 text-xs">
                                {telemetryErrorRaw ? (
                                  <p className="text-red-400">
                                    {t('nodeDetailModal.telemetryFailed', {
                                      message: translateMeshcoreUserMessage(t, telemetryErrorRaw),
                                    })}
                                  </p>
                                ) : (
                                  <p className="text-muted">
                                    {t('repeatersPanel.noTelemetryResponse')}
                                  </p>
                                )}
                                {node.latitude != null && node.longitude != null ? (
                                  <p className="text-muted">
                                    {t('repeatersPanel.mapPositionFromTelemetry')}
                                  </p>
                                ) : null}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}

                      {/* CLI detail row */}
                      {isCliExpanded && onSendCliCommand && (
                        <tr className="bg-app-bg/60 border-ink-800 border-b">
                          <td colSpan={10} className="px-4 py-2">
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={cliInputValues.get(node.node_id) ?? ''}
                                  onChange={(e) => {
                                    setCliInputValues((prev) => {
                                      const n = new Map(prev);
                                      n.set(node.node_id, e.target.value);
                                      return n;
                                    });
                                  }}
                                  onKeyDown={(e) => {
                                    handleCliKeyDown(e, node.node_id);
                                  }}
                                  placeholder={t('repeatersPanel.enterCommand')}
                                  maxLength={REPEATER_CLI_MAX_COMMAND_LENGTH}
                                  disabled={!isConnected || isCliLoading}
                                  className="bg-app-bg border-secondary-dark placeholder:text-muted focus:border-brand-green text-body text-ink-200 h-8 min-w-50 flex-1 rounded-lg border px-2.5 font-mono focus:outline-none disabled:opacity-40"
                                  aria-label={t('repeatersPanel.cliInput')}
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const cmd = cliInputValues.get(node.node_id) ?? '';
                                    if (cmd.trim()) {
                                      void handleCliCommand(node.node_id, cmd);
                                      setCliInputValues((prev) => {
                                        const n = new Map(prev);
                                        n.delete(node.node_id);
                                        return n;
                                      });
                                    }
                                  }}
                                  disabled={
                                    !isConnected ||
                                    isCliLoading ||
                                    !cliInputValues.get(node.node_id)?.trim()
                                  }
                                  className={buttonClassName('primary', 'sm')}
                                >
                                  {isCliLoading ? rowSpinner : t('repeatersPanel.cliSend')}
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                <span className="text-muted mr-1 text-xs">
                                  {t('repeatersPanel.cliQuick')}
                                </span>
                                {[
                                  ...SHARED_CLI_QUICK_COMMANDS,
                                  ...(node.hw_model === 'Room' ? ROOM_CLI_QUICK_COMMANDS : []),
                                ].map(renderCliQuickPill)}
                              </div>
                              <div className="flex flex-wrap gap-1">
                                <span className="text-muted mr-1 text-xs">
                                  {t('repeatersPanel.cliQuickRadio')}
                                </span>
                                {RADIO_CLI_QUICK_COMMANDS.map(renderCliQuickPill)}
                              </div>
                              {node.hw_model === 'Room' ? (
                                <MeshcoreRoomAclControls
                                  disabled={!isConnected || isCliLoading}
                                  onApply={async (pubkeyHex, level) => {
                                    await handleCliCommand(
                                      node.node_id,
                                      `setperm ${pubkeyHex} ${level}`,
                                    );
                                  }}
                                />
                              ) : null}
                              {showCliMultiHopHint ? (
                                <p className="text-xs text-orange-400/90">
                                  {t('repeatersPanel.cliMultiHopHint')}
                                </p>
                              ) : null}
                              {cliErrorText ? (
                                <p className="text-xs text-red-400">{cliErrorText}</p>
                              ) : null}
                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleCliClear(node.node_id);
                                  }}
                                  className="text-muted hover:text-ink-300 text-xs underline"
                                >
                                  {t('repeatersPanel.cliClearHistory')}
                                </button>
                              </div>
                              <div className="border-ink-700 bg-ink-950/50 max-h-40 overflow-y-auto rounded border">
                                {cliHistory.length === 0 ? (
                                  <div className="text-muted px-2 py-1 text-xs italic">
                                    {t('repeatersPanel.cliNoCommandsYet')}
                                  </div>
                                ) : (
                                  cliHistory.map((entry, idx) => (
                                    <div
                                      key={`${entry.timestamp}-${idx}`}
                                      className={`px-2 py-0.5 font-mono text-xs ${
                                        entry.type === 'sent' ? 'text-cyan-300' : 'text-ink-300'
                                      }`}
                                    >
                                      {entry.type === 'sent' ? '>' : '<'}{' '}
                                      {translateRepeaterCliHistoryText(t, entry.type, entry.text)}
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {shouldVirtualizeRepeaterRows && virtualRepeaterRows.length > 0 && (
                  <tr>
                    <td
                      colSpan={10}
                      style={{
                        height: Math.max(
                          0,
                          repeaterRowVirtualizer.getTotalSize() -
                            virtualRepeaterRows[virtualRepeaterRows.length - 1].end,
                        ),
                        padding: 0,
                        border: 0,
                      }}
                    />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {RemoteAuthModal}
      {cliDangerConfirm ? (
        <ConfirmModal
          title={t('repeatersPanel.cliDangerConfirmTitle')}
          message={t('repeatersPanel.cliDangerConfirmMessage', {
            command: cliDangerConfirm.command,
          })}
          confirmLabel={t('repeatersPanel.cliDangerConfirmAction')}
          danger
          onCancel={() => {
            setCliDangerConfirm(null);
          }}
          onConfirm={() => {
            const pending = cliDangerConfirm;
            setCliDangerConfirm(null);
            void runCliCommand(pending.nodeId, pending.command, { confirmedDanger: true });
          }}
        />
      ) : null}
    </>
  );
}
