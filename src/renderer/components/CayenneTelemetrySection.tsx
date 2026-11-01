import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { formatDisplayTime } from '@/renderer/lib/formatDisplayTime';
import { resolveIdentityIdForProtocol } from '@/renderer/lib/identityByProtocol';
import { getIdentityNode } from '@/renderer/lib/identityStoreReads';
import type { CayenneKind } from '@/renderer/lib/meshtastic/cayenneLpp';
import type { ProtocolCapabilities } from '@/renderer/lib/radio/BaseRadioProvider';
import {
  type CayenneNodeTelemetry,
  type CayenneSeries,
  useCayenneTelemetryStore,
} from '@/renderer/stores/cayenneTelemetryStore';
import { useIdentityStore } from '@/renderer/stores/identityStore';
import { useTimeFormatStore } from '@/renderer/stores/timeFormatStore';

const SERIES_COLORS = ['#3b82f6', '#8b5cf6', '#f97316', '#22c55e', '#ef4444', '#eab308'] as const;
const EMPTY_NODES: ReadonlyMap<number, CayenneNodeTelemetry> = new Map();

interface Props {
  /** Protocol exception: Cayenne LPP arrives on Meshtastic CAYENNE_APP only. */
  capabilities?: ProtocolCapabilities;
}

function nodeLabel(identityId: string | null, nodeNum: number): string {
  const node = getIdentityNode(identityId, nodeNum);
  const name = node?.long_name.trim() || node?.short_name.trim();
  return name || `!${nodeNum.toString(16).padStart(8, '0')}`;
}

function seriesLabel(series: CayenneSeries): string {
  return series.field ? `ch${series.channel}.${series.field}` : `ch${series.channel}`;
}

/**
 * Cayenne LPP sensor charts (Telemetry tab). Renders nothing until a `CAYENNE_APP` packet has been
 * decoded for the active Meshtastic radio.
 */
export default function CayenneTelemetrySection({ capabilities }: Props) {
  const { t } = useTranslation();
  const use24HourTime = useTimeFormatStore((s) => s.use24HourTime);
  const identityId = useIdentityStore((s) =>
    resolveIdentityIdForProtocol(s.identities, s.activeIdentityId, 'meshtastic'),
  );
  const nodes = useCayenneTelemetryStore((s) =>
    identityId ? (s.byIdentity[identityId] ?? EMPTY_NODES) : EMPTY_NODES,
  );
  const [selected, setSelected] = useState<number | null>(null);

  const nodeNums = useMemo(() => [...nodes.keys()].reverse(), [nodes]);
  const activeNodeNum = selected != null && nodes.has(selected) ? selected : (nodeNums[0] ?? null);
  const active = activeNodeNum != null ? nodes.get(activeNodeNum) : undefined;

  const groups = useMemo(() => {
    const byKind = new Map<CayenneKind, CayenneSeries[]>();
    for (const series of active?.series.values() ?? []) {
      const list = byKind.get(series.kind) ?? [];
      list.push(series);
      byKind.set(series.kind, list);
    }
    return [...byKind.entries()];
  }, [active]);

  if (capabilities?.hasCayenneTelemetry !== true || nodeNums.length === 0 || !active) return null;

  return (
    <section
      className="space-y-4"
      aria-label={t('telemetryPanel.cayenne.title')}
      data-testid="cayenne-telemetry-section"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-ink-200 text-lg font-semibold">{t('telemetryPanel.cayenne.title')}</h3>
        <label className="text-muted flex items-center gap-2 text-xs">
          {t('telemetryPanel.cayenne.node')}
          <select
            className="bg-ink-800 text-ink-200 rounded px-2 py-1 text-xs"
            value={activeNodeNum ?? ''}
            onChange={(e) => {
              setSelected(Number(e.target.value));
            }}
            aria-label={t('telemetryPanel.cayenne.node')}
          >
            {nodeNums.map((n) => (
              <option key={n} value={n}>
                {nodeLabel(identityId, n)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-muted text-xs">{t('telemetryPanel.cayenne.hint')}</p>
      {groups.map(([kind, seriesList]) => {
        const kindLabel = t(`telemetryPanel.cayenne.kind.${kind}`);
        if (kind === 'gps')
          return <CayenneGpsRow key={kind} label={kindLabel} series={seriesList} />;
        const times = [
          ...new Set(seriesList.flatMap((s) => s.points.map((p) => p.timestamp))),
        ].sort((a, b) => a - b);
        const data = times.map((ts) => {
          const row: Record<string, number | string | undefined> = {
            time: formatDisplayTime(ts, { withSeconds: true, use24Hour: use24HourTime }),
          };
          for (const s of seriesList) {
            row[s.key] = s.points.find((p) => p.timestamp === ts)?.value;
          }
          return row;
        });
        const unit = seriesList[0]?.unit ?? '';
        return (
          <div key={kind} className="bg-deep-black rounded-lg p-4" data-testid={`cayenne-${kind}`}>
            <h4 className="text-muted mb-3 text-sm font-medium">
              {kindLabel}
              {unit ? ` (${unit})` : ''}
            </h4>
            <div
              role="img"
              aria-label={t('telemetryPanel.cayenne.chartAria', {
                kind: kindLabel,
                count: data.length,
              })}
            >
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#364156" />
                  <XAxis dataKey="time" stroke="#65738c" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#65738c" tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      background: '#19212d',
                      border: '1px solid #364156',
                      borderRadius: '8px',
                    }}
                  />
                  {seriesList.length > 1 && <Legend />}
                  {seriesList.map((s, i) => (
                    <Line
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      name={seriesLabel(s)}
                      stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function CayenneGpsRow({ label, series }: { label: string; series: CayenneSeries[] }) {
  const latest = (field: string): number | undefined =>
    series.find((s) => s.field === field)?.points.at(-1)?.value;
  const lat = latest('lat');
  const lon = latest('lon');
  const alt = latest('alt');
  return (
    <div className="bg-deep-black text-ink-300 rounded-lg p-4 text-sm" data-testid="cayenne-gps">
      <h4 className="text-muted mb-1 text-sm font-medium">{label}</h4>
      <span className="font-mono">
        {lat?.toFixed(4) ?? '—'}, {lon?.toFixed(4) ?? '—'}
        {alt !== undefined ? ` · ${alt.toFixed(1)} m` : ''}
      </span>
    </div>
  );
}
