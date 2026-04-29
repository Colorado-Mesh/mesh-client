import { useMemo, useState } from 'react';
import { Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import type { RxPacketEntry } from '../hooks/useMeshCore';
import type { MeshtasticRawPacketEntry } from '../lib/rawPacketLogConstants';

// ── Types ─────────────────────────────────────────────────────────────────────

type Variant = 'meshtastic' | 'meshcore';

type PacketDistributionPanelProps =
  | {
      variant: 'meshtastic';
      packets: MeshtasticRawPacketEntry[];
      getNodeLabel: (id: number) => string;
    }
  | {
      variant: 'meshcore';
      packets: RxPacketEntry[];
      getNodeLabel: (id: number) => string;
    };

type MainView = 'overall' | 'by-type';
type TimeFilter = 'hour' | 'day' | 'all';
type SourceFilter = 'all' | 'rf' | 'mqtt';

interface NormalizedPacket {
  ts: number;
  fromNodeId: number | null;
  packetType: string;
  viaMqtt: boolean;
  isLocal?: boolean;
}

interface SliceData {
  name: string;
  value: number;
  fill: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const COLORS = [
  '#22d3ee', // cyan-400
  '#4ade80', // green-400
  '#facc15', // yellow-400
  '#fb923c', // orange-400
  '#f87171', // red-400
  '#c084fc', // purple-400
  '#60a5fa', // blue-400
  '#f472b6', // pink-400
];
const OTHER_COLOR = '#6b7280'; // gray-500
const OTHER_THRESHOLD = 0.02; // < 2% → "Other"

const TIME_FILTERS: { label: string; value: TimeFilter }[] = [
  { label: 'Last Hour', value: 'hour' },
  { label: 'Last 24 Hours', value: 'day' },
  { label: 'All Data', value: 'all' },
];

const TOOLTIP_STYLE = {
  backgroundColor: '#0f172a',
  border: '1px solid #334155',
  borderRadius: '6px',
  color: '#e2e8f0',
  fontSize: '12px',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(
  variant: Variant,
  packets: MeshtasticRawPacketEntry[] | RxPacketEntry[],
): NormalizedPacket[] {
  if (variant === 'meshtastic') {
    return (packets as MeshtasticRawPacketEntry[]).map((p) => ({
      ts: p.ts,
      fromNodeId: p.fromNodeId,
      packetType: p.portLabel || 'UNKNOWN',
      viaMqtt: p.viaMqtt,
      isLocal: p.isLocal,
    }));
  }
  return (packets as RxPacketEntry[]).map((p) => ({
    ts: p.ts,
    fromNodeId: p.fromNodeId,
    packetType: p.payloadTypeString || 'UNKNOWN',
    viaMqtt: false,
  }));
}

function applyTimeFilter(packets: NormalizedPacket[], filter: TimeFilter): NormalizedPacket[] {
  if (filter === 'all') return packets;
  const cutoff = filter === 'hour' ? Date.now() - 3_600_000 : Date.now() - 86_400_000;
  return packets.filter((p) => p.ts >= cutoff);
}

function applySourceFilter(
  packets: NormalizedPacket[],
  filter: SourceFilter,
  variant: Variant,
): NormalizedPacket[] {
  if (variant === 'meshcore') return packets;
  const nonLocal = packets.filter((p) => !p.isLocal);
  if (filter === 'all') return nonLocal;
  if (filter === 'rf') return nonLocal.filter((p) => !p.viaMqtt);
  return nonLocal.filter((p) => p.viaMqtt);
}

function buildSlices(
  items: { key: string; count: number }[],
  labelFn: (key: string) => string,
): SliceData[] {
  const total = items.reduce((s, i) => s + i.count, 0);
  if (total === 0) return [];

  const main: SliceData[] = [];
  let otherCount = 0;
  let colorIdx = 0;

  for (const { key, count } of items) {
    if (count / total < OTHER_THRESHOLD) {
      otherCount += count;
    } else {
      main.push({ name: labelFn(key), value: count, fill: COLORS[colorIdx % COLORS.length] });
      colorIdx++;
    }
  }

  if (otherCount > 0) {
    main.push({ name: 'Other', value: otherCount, fill: OTHER_COLOR });
  }

  return main;
}

function countBy(packets: NormalizedPacket[], key: keyof NormalizedPacket): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of packets) {
    const k = String(p[key] ?? 'UNKNOWN');
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return map;
}

function resolveNodeKey(k: string, getNodeLabel: (id: number) => string, variant: Variant): string {
  const id = parseInt(k, 10);
  if (k === 'null' || isNaN(id)) {
    return variant === 'meshcore' ? 'No sender id in raw frame' : 'Unknown';
  }
  return getNodeLabel(id);
}

function tooltipFormatter(value: unknown, total: number): [string, string] {
  const n = typeof value === 'number' ? value : 0;
  const pct = total > 0 ? ((n / total) * 100).toFixed(1) : '0';
  return [`${n.toLocaleString()} (${pct}%)`, ''];
}

// ── Custom Legend ─────────────────────────────────────────────────────────────

interface LegendEntryProps {
  name: string;
  value: number;
  total: number;
  fill: string;
}

function LegendEntry({ name, value, total, fill }: LegendEntryProps) {
  const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: fill }} />
      <span className="text-gray-300">
        {name}:{' '}
        <span className="text-gray-100">
          {pct}% ({value.toLocaleString()})
        </span>
      </span>
    </div>
  );
}

// ── Donut Chart ───────────────────────────────────────────────────────────────

interface DonutProps {
  title: string;
  slices: SliceData[];
}

function DonutChart({ title, slices }: DonutProps) {
  const total = slices.reduce((s, d) => s + d.value, 0);

  if (slices.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <p className="text-sm font-medium text-gray-400">{title}</p>
        <p className="text-xs text-gray-600">No data</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      <p className="text-center text-sm font-medium text-gray-300">{title}</p>
      <div className="flex flex-col items-center gap-4 md:flex-row md:items-start">
        <div className="h-44 w-44 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                cx="50%"
                cy="50%"
                innerRadius="50%"
                outerRadius="80%"
                dataKey="value"
                strokeWidth={0}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value) => tooltipFormatter(value, total)}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-col gap-1.5 overflow-auto">
          {slices.map((s) => (
            <LegendEntry key={s.name} name={s.name} value={s.value} total={total} fill={s.fill} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function PacketDistributionPanel({
  variant,
  packets,
  getNodeLabel,
}: PacketDistributionPanelProps) {
  const [mainView, setMainView] = useState<MainView>('overall');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [selectedType, setSelectedType] = useState<string>('');

  const normalized = useMemo(() => normalize(variant, packets as never), [variant, packets]);

  const filtered = useMemo(() => {
    let result = applyTimeFilter(normalized, timeFilter);
    result = applySourceFilter(result, sourceFilter, variant);
    return result;
  }, [normalized, timeFilter, sourceFilter, variant]);

  // ── Overall Distribution data ─────────────────────────────────────────────

  const deviceSlices = useMemo(() => {
    const counts = countBy(filtered, 'fromNodeId');
    const sorted = [...counts.entries()]
      .map(([k, count]) => ({ key: k, count }))
      .sort((a, b) => b.count - a.count);
    return buildSlices(sorted, (k) => resolveNodeKey(k, getNodeLabel, variant));
  }, [filtered, getNodeLabel, variant]);

  const typeSlices = useMemo(() => {
    const counts = countBy(filtered, 'packetType');
    const sorted = [...counts.entries()]
      .map(([k, count]) => ({ key: k, count }))
      .sort((a, b) => b.count - a.count);
    return buildSlices(sorted, (k) => k);
  }, [filtered]);

  // ── Distribution by Type data ─────────────────────────────────────────────

  const typeOptions = useMemo(() => {
    const counts = countBy(normalized, 'packetType');
    return [...counts.entries()]
      .map(([k, count]) => ({ value: k, label: `${k} (${count.toLocaleString()})` }))
      .sort((a, b) => b.label.localeCompare(a.label));
  }, [normalized]);

  const effectiveType =
    selectedType && typeOptions.some((o) => o.value === selectedType)
      ? selectedType
      : (typeOptions[0]?.value ?? '');

  const typeDeviceSlices = useMemo(() => {
    if (!effectiveType) return [];
    const subset = filtered.filter((p) => p.packetType === effectiveType);
    const counts = countBy(subset, 'fromNodeId');
    const sorted = [...counts.entries()]
      .map(([k, count]) => ({ key: k, count }))
      .sort((a, b) => b.count - a.count);
    return buildSlices(sorted, (k) => resolveNodeKey(k, getNodeLabel, variant));
  }, [filtered, effectiveType, getNodeLabel, variant]);

  const typeDeviceTotal = typeDeviceSlices.reduce((s, d) => s + d.value, 0);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="bg-deep-black flex h-full flex-col gap-4 overflow-auto p-4">
      {/* ── Top controls ── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Main view toggle */}
        <div className="flex rounded border border-gray-700 text-xs">
          {(
            [
              { value: 'overall', label: 'Overall Distribution' },
              { value: 'by-type', label: 'Distribution by Type' },
            ] as const
          ).map(({ value, label }) => (
            <button
              key={value}
              onClick={() => {
                setMainView(value);
              }}
              className={`px-3 py-1.5 transition-colors ${
                mainView === value
                  ? 'bg-gray-700 text-gray-100'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Source filter — Meshtastic only */}
        {variant === 'meshtastic' && (
          <select
            value={sourceFilter}
            onChange={(e) => {
              setSourceFilter(e.target.value as SourceFilter);
            }}
            className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-300 focus:outline-none"
          >
            <option value="all">All Sources</option>
            <option value="rf">RF Only</option>
            <option value="mqtt">MQTT Only</option>
          </select>
        )}

        {/* Time filter — Overall view only */}
        {mainView === 'overall' && (
          <div className="flex rounded border border-gray-700 text-xs">
            {TIME_FILTERS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => {
                  setTimeFilter(value);
                }}
                className={`px-3 py-1.5 transition-colors ${
                  timeFilter === value
                    ? 'bg-gray-700 text-gray-100'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Type picker — by-type view only */}
        {mainView === 'by-type' && (
          <select
            value={effectiveType}
            onChange={(e) => {
              setSelectedType(e.target.value);
            }}
            className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-300 focus:outline-none"
          >
            {typeOptions.length === 0 ? (
              <option value="">No data</option>
            ) : (
              typeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))
            )}
          </select>
        )}

        <span className="text-muted ml-auto text-xs">
          {filtered.length.toLocaleString()} packet{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Views ── */}
      {mainView === 'overall' ? (
        <div className="flex min-h-0 flex-1 flex-wrap gap-6">
          <DonutChart title="Packets by Device" slices={deviceSlices} />
          <DonutChart title="Packets by Type" slices={typeSlices} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          {effectiveType ? (
            <>
              <p className="text-sm text-gray-400">
                Devices transmitting{' '}
                <span className="font-mono text-gray-200">{effectiveType}</span>
                {' — '}
                <span className="text-gray-300">{typeDeviceTotal.toLocaleString()} packets</span>
              </p>
              <div className="flex flex-1 items-start justify-center">
                <div className="flex flex-col items-center gap-4 md:flex-row md:items-start">
                  <div className="h-64 w-64 shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={typeDeviceSlices}
                          cx="50%"
                          cy="50%"
                          innerRadius="45%"
                          outerRadius="80%"
                          dataKey="value"
                          strokeWidth={0}
                        />
                        <Tooltip
                          contentStyle={TOOLTIP_STYLE}
                          formatter={(value) => tooltipFormatter(value, typeDeviceTotal)}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-col gap-1.5 overflow-auto pt-2">
                    {typeDeviceSlices.map((s) => (
                      <LegendEntry
                        key={s.name}
                        name={s.name}
                        value={s.value}
                        total={typeDeviceTotal}
                        fill={s.fill}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-600">No packets captured yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
