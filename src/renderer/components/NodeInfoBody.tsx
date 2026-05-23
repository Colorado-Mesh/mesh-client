/* eslint-disable react-hooks/purity */
import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useLatestTrackedPosition } from '../hooks/useLatestTrackedPosition';
import {
  formatCoordPair,
  latestPositionHistoryPoint,
  resolveNodeMapPosition,
} from '../lib/coordUtils';
import {
  diagnosticRowsToRoutingMap,
  getRoutingRowForNode,
} from '../lib/diagnostics/diagnosticRows';
import {
  translateRfConditionLabel,
  translateRFDiagnosisCause,
} from '../lib/diagnostics/diagnosticsLabels';
import {
  meshCongestionDetailLines,
  summarizeMeshCongestionAttribution,
  summarizeRfDuplicateOriginators,
} from '../lib/diagnostics/meshCongestionAttribution';
import { getRecommendedAction } from '../lib/diagnostics/RemediationEngine';
import {
  diagnoseConnectedNode,
  diagnoseOtherNode,
  hasLocalStatsData,
  type RFDiagnosis,
} from '../lib/diagnostics/RFDiagnosticEngine';
import { snrMeaningfulForNodeDiagnostics } from '../lib/diagnostics/snrMeaningfulForNodeDiagnostics';
import { meshtasticHwModelDisplay } from '../lib/hardwareModels';
import { meshcoreTracePathLenToHops } from '../lib/meshcoreUtils';
import {
  MESHTASTIC_HYBRID_MQTT_PATH_ARIA_LABEL,
  MESHTASTIC_HYBRID_MQTT_PATH_TITLE,
  MeshtasticHybridPathIcons,
  MeshtasticMqttPathIcon,
  meshtasticNodeShowsHybridMqttPath,
  MeshtasticRfPathIcon,
} from '../lib/meshtasticSourceIcons';
import { normalizeLastHeardMs } from '../lib/nodeStatus';
import { RoleDisplay } from '../lib/roleInfo';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '../lib/timeConstants';
import type { HopHistoryPoint, MeshNode, MeshProtocol, NodeAnomaly } from '../lib/types';
import { routingRowToNodeAnomaly } from '../lib/types';
import { useCoordFormatStore } from '../stores/coordFormatStore';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';
import MeshCongestionAttributionBlock from './MeshCongestionAttributionBlock';
import SnrIndicator from './SnrIndicator';

export const CATEGORY_STYLES: Record<string, string> = {
  Configuration: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  Physical: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  Hardware: 'bg-purple-500/20 text-purple-400 border border-purple-500/30',
  Software: 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30',
};

const EMPTY_HOP_HISTORY: HopHistoryPoint[] = [];

export function formatTime(ts: number, t: TFunction): string {
  if (!ts) return t('common.never');
  const normalizedTs = normalizeLastHeardMs(ts);
  const diff = Date.now() - normalizedTs;
  if (diff < MS_PER_MINUTE) return t('common.justNow');
  if (diff < MS_PER_HOUR)
    return t('common.minutesAgo', { count: Math.floor(diff / MS_PER_MINUTE) });
  if (diff < MS_PER_DAY) return t('common.hoursAgo', { count: Math.floor(diff / MS_PER_HOUR) });
  return new Date(normalizedTs).toLocaleString();
}

export function formatSecondsAgo(seconds: number, t: TFunction): string {
  if (seconds < 60) return t('common.secondsAgo', { count: seconds });
  if (seconds < 3600) return t('common.minutesAgo', { count: Math.floor(seconds / 60) });
  if (seconds < 86400) return t('common.hoursAgo', { count: Math.floor(seconds / 3600) });
  return t('common.daysAgo', { count: Math.floor(seconds / 86400) });
}

export function InfoRow({
  label,
  value,
  className,
}: {
  label: string;
  value: string | number;
  className?: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-gray-700/50 py-2 last:border-b-0">
      <span className="text-muted text-sm">{label}</span>
      <span className={`text-sm font-medium ${className || 'text-gray-200'}`}>{value}</span>
    </div>
  );
}

function NodeSourceBadge({ node, protocol }: { node: MeshNode; protocol?: MeshProtocol }) {
  const { t } = useTranslation();
  // MeshCore nodes are always RF
  const via: 'rf' | 'mqtt' | 'both' =
    protocol === 'meshcore'
      ? 'rf'
      : node.heard_via_mqtt_only
        ? 'mqtt'
        : meshtasticNodeShowsHybridMqttPath(node)
          ? 'both'
          : 'rf';

  if (via === 'both') {
    return (
      <MeshtasticHybridPathIcons
        title={MESHTASTIC_HYBRID_MQTT_PATH_TITLE}
        ariaLabel={MESHTASTIC_HYBRID_MQTT_PATH_ARIA_LABEL}
      />
    );
  }
  return via === 'rf' ? (
    <span title={t('nodeInfoBody.receivedViaRf')}>
      <MeshtasticRfPathIcon />
    </span>
  ) : (
    <span title={t('nodeInfoBody.receivedViaMqtt')}>
      <MeshtasticMqttPathIcon />
    </span>
  );
}

function iaqLabel(iaq: number, t: TFunction): string {
  if (iaq <= 50) return t('nodeInfoBody.iaqExcellent');
  if (iaq <= 100) return t('nodeInfoBody.iaqGood');
  if (iaq <= 150) return t('nodeInfoBody.iaqLightlyPolluted');
  if (iaq <= 200) return t('nodeInfoBody.iaqModeratelyPolluted');
  if (iaq <= 300) return t('nodeInfoBody.iaqHeavilyPolluted');
  return t('nodeInfoBody.iaqSeverelyPolluted');
}

export interface NodeInfoBodyProps {
  node: MeshNode;
  homeNode?: MeshNode | null;
  traceRouteHops?: string[];
  /** When set, Mesh Congestion can list originators by name/role (RF duplicate-prone traffic). */
  nodes?: Map<number, MeshNode>;
  useFahrenheit?: boolean;
  /** MeshCore uses contact/advert type (`hw_model`) instead of Meshtastic role; omit short name row. */
  protocol?: MeshProtocol;
  /** MeshCore: local radio model from `deviceQuery` (shown only for our node). */
  meshcoreManufacturerModel?: string;
  /** Optional tracked positions passed from parent to avoid relying on store timing. */
  positionHistory?: Map<number, { t: number; lat: number; lon: number }[]>;
  onShowOnMap?: (nodeId: number, lat: number, lon: number) => void;
}

const SEVERITY_STYLES: Record<RFDiagnosis['severity'], string> = {
  warning: 'text-orange-400',
  info: 'text-blue-400',
};

const SEVERITY_ICON: Record<RFDiagnosis['severity'], string> = {
  warning: '⚠',
  info: 'ℹ',
};

export default function NodeInfoBody({
  node,
  homeNode,
  traceRouteHops,
  nodes,
  useFahrenheit = false,
  protocol = 'meshtastic',
  meshcoreManufacturerModel,
  positionHistory,
  onShowOnMap,
}: NodeInfoBodyProps) {
  const { t } = useTranslation();
  const coordinateFormat = useCoordFormatStore((s) => s.coordinateFormat);
  const diagnosticRows = useDiagnosticsStore((s) => s.diagnosticRows);
  const routingRow = getRoutingRowForNode(diagnosticRows, node.node_id);
  const anomaly: NodeAnomaly | null = routingRow ? routingRowToNodeAnomaly(routingRow) : null;
  const nodePacketStats = useDiagnosticsStore((s) => s.packetStats.get(node.node_id));
  const hopHistory = useDiagnosticsStore(
    (s) => s.hopHistory.get(node.node_id) ?? EMPTY_HOP_HISTORY,
  );
  const nodeRedundancy = useDiagnosticsStore((s) => s.nodeRedundancy.get(node.node_id));
  const meshcoreHopHistory = useDiagnosticsStore((s) => s.meshcoreHopHistory.get(node.node_id));
  const meshcoreTraceHistory = useDiagnosticsStore((s) => s.meshcoreTraceHistory.get(node.node_id));
  const loadMeshcorePathHistory = useDiagnosticsStore((s) => s.loadMeshcorePathHistory);
  const [pathHistoryOpen, setPathHistoryOpen] = useState(false);
  const latestTrackedPositionFromStore = useLatestTrackedPosition(node.node_id);
  const latestTrackedPositionFromProps = latestPositionHistoryPoint(
    positionHistory?.get(node.node_id),
  );
  const latestTrackedPosition = latestTrackedPositionFromProps ?? latestTrackedPositionFromStore;

  const meshcoreTraceFirst = meshcoreTraceHistory?.[0];
  const meshcoreTracePathSnrsSafe =
    meshcoreTraceFirst != null && Array.isArray(meshcoreTraceFirst.pathSnrs)
      ? meshcoreTraceFirst.pathSnrs
      : [];
  const showMeshcoreTraceHistoryBlock =
    meshcoreTraceFirst != null &&
    (meshcoreTraceFirst.pathLen != null || meshcoreTracePathSnrsSafe.length > 0);

  useEffect(() => {
    if (protocol === 'meshcore' && node.node_id) {
      loadMeshcorePathHistory(node.node_id);
    }
  }, [protocol, node.node_id, loadMeshcorePathHistory]);

  const batteryColor =
    node.battery > 50
      ? 'text-bright-green'
      : node.battery > 20
        ? 'text-yellow-400'
        : node.battery > 0
          ? 'text-red-400'
          : 'text-muted';

  const isOurNode = node.node_id === homeNode?.node_id;
  const showSnr = snrMeaningfulForNodeDiagnostics(node) || isOurNode;
  const showLastHopSnr =
    !isOurNode &&
    !node.heard_via_mqtt_only &&
    node.hops_away != null &&
    node.hops_away > 0 &&
    node.snr != null &&
    node.snr !== 0;
  const snrColor =
    node.snr > 5
      ? 'text-bright-green'
      : node.snr > 0
        ? 'text-yellow-400'
        : node.snr !== 0
          ? 'text-red-400'
          : 'text-muted';

  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
  const recentHour = hopHistory.filter((p) => p.t >= oneHourAgo);
  const recentHistory = hopHistory.filter((p) => p.t >= twentyFourHoursAgo);
  const hasSparkline = recentHistory.length >= 2;

  let hopChanges = 0;
  for (let i = 1; i < recentHour.length; i++) {
    if (recentHour[i].h !== recentHour[i - 1].h) hopChanges++;
  }
  const stabilityKey: 'stable' | 'moderate' | 'unstable' | 'unknown' =
    recentHour.length < 2
      ? 'unknown'
      : hopChanges === 0
        ? 'stable'
        : hopChanges <= 2
          ? 'moderate'
          : 'unstable';
  const stabilityColor =
    stabilityKey === 'stable'
      ? 'text-brand-green'
      : stabilityKey === 'moderate'
        ? 'text-yellow-400'
        : stabilityKey === 'unknown'
          ? 'text-muted'
          : 'text-red-400';
  const stabilityLabel = {
    stable: t('nodeInfoBody.stableStability'),
    moderate: t('nodeInfoBody.moderateStability'),
    unstable: t('nodeInfoBody.unstableStability'),
    unknown: t('nodeInfoBody.unknownStability'),
  }[stabilityKey];

  const offenseSummary = anomaly
    ? anomaly.type === 'hop_goblin'
      ? anomaly.confidence === 'heuristic'
        ? t('nodeInfoBody.offenseHeuristic')
        : t('nodeInfoBody.offenseOverhopping')
      : anomaly.type === 'bad_route'
        ? t('nodeInfoBody.offenseRoutingLoop')
        : anomaly.type === 'route_flapping'
          ? t('nodeInfoBody.offenseRouteFlapping')
          : t('nodeInfoBody.offenseZeroHops')
    : null;

  return (
    <>
      {/* Names */}
      {node.long_name && <InfoRow label={t('nodeInfoBody.longName')} value={node.long_name} />}
      {protocol !== 'meshcore' && node.short_name && (
        <InfoRow label={t('nodeInfoBody.shortName')} value={node.short_name} />
      )}

      {protocol === 'meshcore' ? (
        <>
          <InfoRow label={t('nodeInfoBody.type')} value={node.hw_model || '---'} />
          <InfoRow
            label={t('nodeInfoBody.hardware')}
            value={
              isOurNode
                ? (meshcoreManufacturerModel ?? '—')
                : t('nodeInfoBody.notAvailableRemotely')
            }
          />
        </>
      ) : (
        <>
          <div className="flex items-center justify-between border-b border-gray-700/50 py-2">
            <span className="text-muted text-sm">{t('nodeInfoBody.role')}</span>
            <div className="flex items-center gap-2">
              <RoleDisplay role={node.role} />
              {!node.short_name && !node.long_name && node.role === undefined && (
                <span className="text-[10px] text-gray-500" title={t('nodeInfoBody.pendingTitle')}>
                  {t('nodeInfoBody.pending')}
                </span>
              )}
            </div>
          </div>
          <InfoRow
            label={t('nodeInfoBody.hardware')}
            value={meshtasticHwModelDisplay(node.hw_model) ?? '—'}
          />
        </>
      )}

      {/* SNR: direct 0-hop RF or our node; otherwise Last-Hop SNR when multi-hop RF context */}
      {showSnr && (
        <InfoRow
          label={t('nodeInfoBody.snr')}
          value={node.snr != null && node.snr !== 0 ? `${node.snr.toFixed(1)} dB` : '—'}
          className={snrColor}
        />
      )}
      {showLastHopSnr && !showSnr && (
        <InfoRow
          label={t('nodeInfoBody.lastHopSnr')}
          value={`${node.snr?.toFixed(1) ?? '—'} dB`}
          className={snrColor}
        />
      )}

      {/* Battery — Meshtastic % ; MeshCore: voltage from local radio (self) + approximate % bar */}
      {protocol === 'meshcore' ? (
        node.voltage != null && node.voltage > 0 ? (
          <div className="flex items-center justify-between border-b border-gray-700/50 py-2">
            <span className="text-muted text-sm">{t('nodeInfoBody.battery')}</span>
            <div className="flex items-center gap-2">
              {node.battery > 0 && (
                <div className="bg-secondary-dark h-2 w-16 overflow-hidden rounded-full">
                  <div
                    className={`h-full rounded-full transition-all ${
                      node.battery > 50
                        ? 'bg-brand-green'
                        : node.battery > 20
                          ? 'bg-yellow-500'
                          : 'bg-red-500'
                    }`}
                    style={{ width: `${Math.min(node.battery, 100)}%` }}
                  />
                </div>
              )}
              <span className={`text-sm font-medium ${batteryColor}`}>
                {node.voltage.toFixed(2)} V{node.battery > 0 ? ` (${node.battery}%)` : ''}
              </span>
            </div>
          </div>
        ) : node.battery > 0 ? (
          <div className="flex items-center justify-between border-b border-gray-700/50 py-2">
            <span className="text-muted text-sm">{t('nodeInfoBody.battery')}</span>
            <div className="flex items-center gap-2">
              <div className="bg-secondary-dark h-2 w-16 overflow-hidden rounded-full">
                <div
                  className={`h-full rounded-full transition-all ${
                    node.battery > 50
                      ? 'bg-brand-green'
                      : node.battery > 20
                        ? 'bg-yellow-500'
                        : 'bg-red-500'
                  }`}
                  style={{ width: `${Math.min(node.battery, 100)}%` }}
                />
              </div>
              <span className={`text-sm font-medium ${batteryColor}`}>{node.battery}%</span>
            </div>
          </div>
        ) : (
          <InfoRow label={t('nodeInfoBody.battery')} value="—" className="text-muted" />
        )
      ) : (
        <div className="flex items-center justify-between border-b border-gray-700/50 py-2">
          <span className="text-muted text-sm">Battery</span>
          <div className="flex items-center gap-2">
            {node.battery > 0 && (
              <div className="bg-secondary-dark h-2 w-16 overflow-hidden rounded-full">
                <div
                  className={`h-full rounded-full transition-all ${
                    node.battery > 50
                      ? 'bg-brand-green'
                      : node.battery > 20
                        ? 'bg-yellow-500'
                        : 'bg-red-500'
                  }`}
                  style={{ width: `${Math.min(node.battery, 100)}%` }}
                />
              </div>
            )}
            <span className={`text-sm font-medium ${batteryColor}`}>
              {node.battery > 0 ? `${node.battery}%` : '—'}
            </span>
          </div>
        </div>
      )}

      {/* Timing */}
      <InfoRow label={t('nodeInfoBody.lastHeard')} value={formatTime(node.last_heard, t)} />

      {/* Hop count */}
      <InfoRow
        label={t('nodeInfoBody.hops')}
        value={isOurNode ? 0 : (node.hops_away ?? '—')}
        className={(isOurNode ? 0 : node.hops_away) === 0 ? 'text-bright-green' : 'text-gray-300'}
      />

      {/* Channel Utilization — Meshtastic only */}
      {protocol === 'meshtastic' &&
        (node.channel_utilization != null || node.air_util_tx != null) && (
          <div className="flex items-center justify-between border-b border-gray-700/50 py-2">
            <span className="text-muted text-sm">{t('nodeInfoBody.channelUtil')}</span>
            <div className="flex items-center gap-2 font-mono text-sm text-gray-200">
              {node.channel_utilization != null && (
                <span>
                  RX:{' '}
                  <span
                    className={node.channel_utilization > 50 ? 'text-yellow-400' : 'text-gray-200'}
                  >
                    {node.channel_utilization.toFixed(1)}%
                  </span>
                </span>
              )}
              {node.channel_utilization != null && node.air_util_tx != null && (
                <span className="text-gray-600">|</span>
              )}
              {node.air_util_tx != null && (
                <span>
                  TX:{' '}
                  <span className={node.air_util_tx > 50 ? 'text-yellow-400' : 'text-gray-200'}>
                    {node.air_util_tx.toFixed(1)}%
                  </span>
                </span>
              )}
            </div>
          </div>
        )}

      {/* Source (RF / MQTT) — Meshtastic only; MeshCore is always RF */}
      {!isOurNode && (
        <div className="flex items-center justify-between border-b border-gray-700/50 py-2">
          <span className="text-muted text-sm">{t('nodeInfoBody.source')}</span>
          <NodeSourceBadge node={node} protocol={protocol} />
        </div>
      )}

      {/* Location */}
      {(() => {
        const mapPosition = resolveNodeMapPosition(node, latestTrackedPosition);
        if (!mapPosition) return null;
        const hasNodeDbPosition =
          node.latitude != null &&
          node.longitude != null &&
          (node.latitude !== 0 || node.longitude !== 0);
        const label = hasNodeDbPosition
          ? t('nodeInfoBody.position')
          : t('nodeInfoBody.lastTrackedPosition');
        return (
          <div className="flex items-center justify-between gap-2 border-b border-gray-700/50 py-2 last:border-b-0">
            <span className="text-muted shrink-0 text-sm">{label}</span>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              <span className="font-mono text-xs text-gray-300">
                {formatCoordPair(mapPosition.lat, mapPosition.lon, coordinateFormat)}
              </span>
              {onShowOnMap && (
                <button
                  type="button"
                  aria-label={t('nodeDetailModal.showOnMap')}
                  className="bg-secondary-dark shrink-0 rounded-lg border border-gray-600 px-2.5 py-1 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-600"
                  onClick={() => {
                    onShowOnMap(node.node_id, mapPosition.lat, mapPosition.lon);
                  }}
                >
                  {t('nodeDetailModal.showOnMap')}
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* GPS warning */}
      {node.lastPositionWarning && node.latitude === 0 && node.longitude === 0 && (
        <div className="mt-1 flex items-start gap-1.5 rounded border border-yellow-500/30 bg-yellow-500/10 px-2 py-1.5 text-xs text-yellow-400">
          <span>⚠</span>
          <span>
            {t('nodeInfoBody.gpsWarningPrefix')}
            {node.lastPositionWarning}
          </span>
        </div>
      )}

      {/* Routing Health */}
      <div className="bg-primary-dark mt-3 rounded-lg py-3">
        <div className="mb-1.5 text-sm font-medium text-gray-400">
          {t('nodeInfoBody.routingHealth')}
        </div>

        {/* Remedy badge */}
        {(() => {
          const remedy = getRecommendedAction(node, homeNode ?? null, nodePacketStats);
          if (!remedy) return null;
          return (
            <div
              className={`mb-2 flex items-start gap-2 rounded-lg border p-2 text-xs ${CATEGORY_STYLES[remedy.category]}`}
            >
              <span className="shrink-0 font-semibold">{remedy.category}</span>
              <span>{remedy.title}</span>
            </div>
          );
        })()}

        {/* Offense */}
        {anomaly ? (
          <div
            className={`flex items-start gap-1.5 text-xs ${
              anomaly.severity === 'error'
                ? 'text-red-400'
                : anomaly.severity === 'info'
                  ? 'text-blue-400'
                  : 'text-orange-400'
            }`}
          >
            {anomaly.severity === 'info' ? (
              <svg
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            ) : (
              <svg
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            )}
            <div>
              <div className="mb-0.5 font-medium">{offenseSummary}</div>
              <div className="text-gray-400">{anomaly.description}</div>
            </div>
          </div>
        ) : (
          <div className="text-brand-green text-xs">{t('nodeInfoBody.noRoutingIssues')}</div>
        )}

        {/* Stability metric */}
        <div className="mt-2 flex items-center justify-between border-t border-gray-700/50 pt-2">
          <span className="text-[10px] text-gray-500">{t('nodeInfoBody.routeStability')}</span>
          <span className={`text-xs font-medium ${stabilityColor}`}>
            {stabilityLabel}
            {recentHour.length >= 2 && hopChanges > 0 && (
              <span className="ml-1 font-normal text-gray-500">
                ({t('nodeInfoBody.changes', { count: hopChanges })})
              </span>
            )}
          </span>
        </div>

        {hasSparkline &&
          (() => {
            const minH = Math.min(...recentHistory.map((p) => p.h));
            const maxH = Math.max(...recentHistory.map((p) => p.h));
            const range = maxH - minH || 1;
            const minT = recentHistory[0].t;
            const maxT = recentHistory[recentHistory.length - 1].t;
            const timeRange = maxT - minT || 1;
            const points = recentHistory
              .map((p) => {
                const x = ((p.t - minT) / timeRange) * 200;
                const y = 40 - ((p.h - minH) / range) * 36 - 2;
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              })
              .join(' ');
            return (
              <div className="mt-2">
                <div className="mb-0.5 text-[10px] text-gray-500">
                  {t('nodeInfoBody.hopCount24h')}
                </div>
                <svg viewBox="0 0 200 40" className="text-brand-green/60 h-8 w-full">
                  <polyline
                    points={points}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            );
          })()}

        {/* Connection Health (packet redundancy) — only shown once echoes have been observed */}
        {nodeRedundancy && nodeRedundancy.maxPaths > 1 && (
          <div
            className="mt-2 border-t border-gray-700/50 pt-2"
            title={t('nodeInfoBody.connectionHealthTooltip')}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-500">
                {t('nodeInfoBody.connectionHealth')}
              </span>
              <span
                className={`text-xs font-medium ${
                  nodeRedundancy.score >= 67
                    ? 'text-lime-400'
                    : nodeRedundancy.score >= 33
                      ? 'text-yellow-400'
                      : 'text-muted'
                }`}
              >
                {nodeRedundancy.score}%
                {nodeRedundancy.maxPaths >= 3 && (
                  <span className="ml-1 text-[10px] text-lime-400/80">
                    {t('nodeInfoBody.highlyRedundant')}
                  </span>
                )}
              </span>
            </div>

            {/* Path History toggle — only shown when there are echoes to display */}
            {(() => {
              const totalEchoes = nodeRedundancy.recentPackets.reduce(
                (s, r) => s + r.paths.length - 1,
                0,
              );
              const echoPackets = nodeRedundancy.recentPackets.filter((r) => r.paths.length > 1);
              if (totalEchoes === 0) return null;
              return (
                <div className="mt-1.5">
                  <button
                    onClick={() => {
                      setPathHistoryOpen((o) => !o);
                    }}
                    className="flex items-center gap-1 text-[10px] text-gray-500 transition-colors hover:text-gray-300"
                  >
                    <span>{pathHistoryOpen ? '▾' : '▸'}</span>
                    {t('nodeInfoBody.pathHistory')} (
                    {t('nodeInfoBody.echoes', { count: totalEchoes })})
                  </button>

                  {pathHistoryOpen && (
                    <div className="mt-1.5 flex max-h-48 flex-col gap-1.5 overflow-y-auto pr-1">
                      {echoPackets.map((rec) => (
                        <div
                          key={rec.packetId}
                          className="bg-deep-black/50 rounded p-1.5 text-[10px]"
                        >
                          <div className="mb-0.5 font-mono text-gray-400">
                            #{rec.packetId.toString(16).toUpperCase()} —{' '}
                            {t('nodeInfoBody.paths', { count: rec.paths.length })}
                          </div>
                          {rec.paths.map((p, i) => (
                            <div key={i} className="pl-1.5 leading-tight text-gray-500">
                              {i === 0
                                ? t('nodeInfoBody.original')
                                : t('nodeInfoBody.echoN', { n: i })}
                              :{' '}
                              <span
                                className={
                                  p.transport === 'rf' ? 'text-brand-green/80' : 'text-blue-400/80'
                                }
                              >
                                {p.transport.toUpperCase()}
                              </span>
                              {showSnr && p.snr != null && (
                                <span className="ml-1">
                                  SNR {p.snr > 0 ? '+' : ''}
                                  {p.snr.toFixed(1)} dB
                                </span>
                              )}
                              {p.rssi != null && <span className="ml-1">{p.rssi} dBm</span>}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* MeshCore trace history from database */}
        {protocol === 'meshcore' && (meshcoreHopHistory || meshcoreTraceHistory) && (
          <div className="mt-2 border-t border-gray-700/50 pt-2">
            <div className="mb-1 text-[10px] tracking-wide text-gray-500 uppercase">
              {t('nodeInfoBody.meshcorePathHistory')}
            </div>
            {meshcoreHopHistory && (
              <div className="mb-1 text-xs">
                <span className="text-gray-400">{t('nodeInfoBody.hopsLabel')}</span>
                <span className="font-mono text-gray-200">{meshcoreHopHistory.hops ?? '?'}</span>
                {meshcoreHopHistory.snr != null && (
                  <span className="ml-2 text-gray-500">
                    SNR {meshcoreHopHistory.snr > 0 ? '+' : ''}
                    {meshcoreHopHistory.snr.toFixed(1)} dB
                  </span>
                )}
                {meshcoreHopHistory.rssi != null && (
                  <span className="ml-2 text-gray-500">{meshcoreHopHistory.rssi} dBm</span>
                )}
                <span className="ml-2 text-[10px] text-gray-600">
                  {new Date(meshcoreHopHistory.timestamp).toLocaleTimeString()}
                </span>
              </div>
            )}
            {meshcoreTraceHistory &&
              meshcoreTraceHistory.length > 0 &&
              showMeshcoreTraceHistoryBlock &&
              meshcoreTraceFirst != null && (
                <div className="bg-deep-black/50 rounded p-1.5 text-[10px]">
                  <div className="mb-0.5 text-gray-400">
                    {meshcoreTraceFirst.pathLen != null && (
                      <>
                        {t('nodeInfoBody.hopsLabel')}{' '}
                        <span className="font-mono text-gray-200">
                          {meshcoreTracePathLenToHops(meshcoreTraceFirst.pathLen)}
                        </span>{' '}
                      </>
                    )}
                    <span className="text-gray-600">
                      {new Date(meshcoreTraceFirst.timestamp).toLocaleTimeString()}
                      {meshcoreTraceHistory.length > 1 && (
                        <span className="ml-1 text-gray-500">
                          {t('nodeInfoBody.olderCount', { count: meshcoreTraceHistory.length - 1 })}
                        </span>
                      )}
                    </span>
                  </div>
                  {meshcoreTracePathSnrsSafe.map((snr, i) => (
                    <div key={i} className="flex items-center gap-2 pl-1.5">
                      <span className="w-8 text-gray-500">
                        {t('nodeInfoBody.hopN', { n: i + 1 })}
                      </span>
                      <SnrIndicator snr={snr} className="text-[10px]" />
                    </div>
                  ))}
                  {meshcoreTraceFirst.lastSnr != null && (
                    <div className="mt-0.5 flex items-center gap-2 border-t border-gray-700/30 pt-0.5 pl-1.5">
                      <span className="w-8 text-gray-500">{t('nodeInfoBody.dest')}</span>
                      <SnrIndicator snr={meshcoreTraceFirst.lastSnr} className="text-[10px]" />
                    </div>
                  )}
                </div>
              )}
          </div>
        )}
      </div>

      {/* Trace route result */}
      {traceRouteHops && (
        <div className="bg-primary-dark mt-3 rounded-lg p-2">
          <div className="mb-1 text-xs text-gray-400">{t('nodeInfoBody.routePath')}</div>
          <div className="flex flex-wrap items-center gap-1 text-sm text-gray-200">
            {traceRouteHops.map((hop, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-gray-500">→</span>}
                <span
                  className={
                    i === 0 || i === traceRouteHops.length - 1
                      ? 'font-medium text-green-400'
                      : 'text-gray-200'
                  }
                >
                  {hop}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Environment */}
      {(node.env_temperature !== undefined ||
        node.env_humidity !== undefined ||
        node.env_pressure !== undefined ||
        node.env_iaq !== undefined ||
        node.env_lux !== undefined ||
        node.env_wind_speed !== undefined) && (
        <div className="mt-3 border-t border-gray-700 pt-3">
          <div className="mb-1 text-xs font-semibold text-gray-400 uppercase">
            {t('nodeInfoBody.environment')}
          </div>
          {node.env_temperature !== undefined && (
            <InfoRow
              label={t('nodeInfoBody.temperature')}
              value={
                useFahrenheit
                  ? `${((node.env_temperature * 9) / 5 + 32).toFixed(1)}°F`
                  : `${node.env_temperature.toFixed(1)}°C`
              }
            />
          )}
          {node.env_humidity !== undefined && (
            <InfoRow
              label={t('nodeInfoBody.humidity')}
              value={`${node.env_humidity.toFixed(1)}%`}
            />
          )}
          {node.env_pressure !== undefined && (
            <InfoRow
              label={t('nodeInfoBody.pressure')}
              value={`${node.env_pressure.toFixed(1)} hPa`}
            />
          )}
          {node.env_iaq !== undefined && (
            <InfoRow
              label={t('nodeInfoBody.airQuality')}
              value={`${node.env_iaq} – ${iaqLabel(node.env_iaq, t)}`}
            />
          )}
          {node.env_lux !== undefined && (
            <InfoRow label={t('nodeInfoBody.light')} value={`${node.env_lux.toFixed(0)} lux`} />
          )}
          {node.env_wind_speed !== undefined && (
            <InfoRow
              label={t('nodeInfoBody.wind')}
              value={
                node.env_wind_direction !== undefined
                  ? `${node.env_wind_speed.toFixed(1)} m/s @ ${node.env_wind_direction}°`
                  : `${node.env_wind_speed.toFixed(1)} m/s`
              }
            />
          )}
        </div>
      )}

      {/* RF Diagnostics */}
      <RFDiagnosticsSection
        node={node}
        isOurNode={node.node_id === homeNode?.node_id}
        nodes={nodes}
      />
    </>
  );
}

function RFDiagnosticsSection({
  node,
  isOurNode,
  nodes,
}: {
  node: MeshNode;
  isOurNode: boolean;
  nodes?: Map<number, MeshNode>;
}) {
  const { t } = useTranslation();
  const getCuStats24h = useDiagnosticsStore((s) => s.getCuStats24h);
  const packetCache = useDiagnosticsStore((s) => s.packetCache);
  const diagnosticRows = useDiagnosticsStore((s) => s.diagnosticRows);
  const getForeignLoraDetectionsList = useDiagnosticsStore((s) => s.getForeignLoraDetectionsList);
  const anomaliesMap = diagnosticRowsToRoutingMap(diagnosticRows);

  let findings: RFDiagnosis[] | null;
  let totalChecks: number | null = null;
  let noTelemetry = false;

  if (isOurNode) {
    const cuStats24h = getCuStats24h(node.node_id);
    findings = diagnoseConnectedNode(node, {
      cuStats24h: cuStats24h ?? undefined,
    });
    totalChecks = 10;
    // If no LocalStats and no channel_utilization, we have no data at all
    if (!hasLocalStatsData(node) && node.channel_utilization == null) {
      noTelemetry = true;
    }
  } else {
    const cuStatsOther = getCuStats24h(node.node_id);
    findings = diagnoseOtherNode(node, {
      cuStats24h: cuStatsOther ?? undefined,
    });
    if (findings === null) noTelemetry = true;
  }

  // When we have a specific foreign LoRa detection (MeshCore/Meshtastic), don't show the generic "LoRa Collision or Corruption" in the RF list
  const hasForeignLora = getForeignLoraDetectionsList(node.node_id).length > 0;
  const findingsToShow =
    findings != null && hasForeignLora
      ? findings.filter((f) => f.condition !== 'LoRa Collision or Corruption')
      : findings;

  const flagged = findingsToShow?.length ?? 0;
  const meshCongestionFinding =
    isOurNode && findings?.find((f) => f.condition === 'Mesh Congestion');
  const attrForOurNode =
    isOurNode && meshCongestionFinding
      ? summarizeMeshCongestionAttribution(packetCache, anomaliesMap)
      : null;
  const meshCongestionLines =
    attrForOurNode && meshCongestionFinding
      ? meshCongestionDetailLines(attrForOurNode, {
          alwaysIncludeRoutingAnomalies: true,
        })
      : [];
  const rfOriginators =
    meshCongestionFinding && packetCache.size > 0
      ? summarizeRfDuplicateOriginators(packetCache)
      : [];

  return (
    <>
      {(meshCongestionLines.length > 0 || rfOriginators.length > 0) && (
        <MeshCongestionAttributionBlock
          lines={meshCongestionLines}
          originators={rfOriginators}
          nodes={nodes}
        />
      )}

      <div className="bg-primary-dark mt-3 rounded-lg py-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-medium text-gray-400">{t('nodeInfoBody.rfDiagnostics')}</div>
          {!noTelemetry && totalChecks !== null && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                flagged === 0
                  ? 'bg-green-900/40 text-green-400'
                  : 'bg-orange-900/40 text-orange-400'
              }`}
            >
              {t('nodeInfoBody.flagged', { flagged, total: totalChecks })}
            </span>
          )}
        </div>

        {noTelemetry ? (
          <div className="text-muted text-xs">{t('nodeInfoBody.noNodeTelemetry')}</div>
        ) : flagged === 0 ? (
          <div className="text-brand-green text-xs">{t('nodeInfoBody.allRfOk')}</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {findingsToShow!.map((f, i) => (
              <div
                key={i}
                className={`flex items-start gap-1.5 text-xs ${SEVERITY_STYLES[f.severity]}`}
              >
                <span className="mt-0.5 shrink-0">{SEVERITY_ICON[f.severity]}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="font-semibold">
                      {translateRfConditionLabel(t, f.condition)}
                    </span>
                    {f.isLastHop && (
                      <span className="rounded border border-blue-500/30 bg-blue-500/20 px-1 py-0 text-[10px] text-blue-300">
                        {t('nodeInfoBody.lastHopSnrBadge')}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-gray-400">
                    — {translateRFDiagnosisCause(t, f.cause, f.causeI18n)}
                  </div>
                  {(f.hints?.length ?? 0) > 0 && (
                    <ul className="text-muted mt-1.5 list-disc space-y-0.5 pl-3 text-[10px]">
                      {f.hints!.map((h, j) => (
                        <li key={j}>{h}</li>
                      ))}
                    </ul>
                  )}
                  {f.condition === 'LoRa Collision or Corruption' &&
                    isOurNode &&
                    !hasForeignLora && (
                      <p className="text-muted mt-1.5 text-[10px]">
                        {t('nodeInfoBody.loraCollisionNote')}
                      </p>
                    )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
