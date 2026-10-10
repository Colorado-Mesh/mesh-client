import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { MeshNode } from '../lib/types';

interface RFHistogramsPanelProps {
  nodes: Map<number, MeshNode>;
}

interface BucketDef {
  label: string;
  test: (v: number) => boolean;
}

function buildHistogram(
  values: number[],
  buckets: BucketDef[],
): { label: string; count: number }[] {
  const counts = new Array<number>(buckets.length).fill(0);
  for (const v of values) {
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].test(v)) {
        counts[i]++;
        break;
      }
    }
  }
  return buckets.map((b, i) => ({ label: b.label, count: counts[i] }));
}

const SNR_BUCKETS: BucketDef[] = [
  { label: '<-10', test: (v) => v < -10 },
  { label: '-10–-5', test: (v) => v >= -10 && v < -5 },
  { label: '-5–0', test: (v) => v >= -5 && v < 0 },
  { label: '0–5', test: (v) => v >= 0 && v < 5 },
  { label: '5–10', test: (v) => v >= 5 && v < 10 },
  { label: '≥10', test: (v) => v >= 10 },
];

const RSSI_BUCKETS: BucketDef[] = [
  { label: '<-120', test: (v) => v < -120 },
  { label: '-120–-110', test: (v) => v >= -120 && v < -110 },
  { label: '-110–-100', test: (v) => v >= -110 && v < -100 },
  { label: '-100–-90', test: (v) => v >= -100 && v < -90 },
  { label: '-90–-80', test: (v) => v >= -90 && v < -80 },
  { label: '≥-80', test: (v) => v >= -80 },
];

const HOP_BUCKETS: BucketDef[] = [
  { label: '0', test: (v) => v === 0 },
  { label: '1', test: (v) => v === 1 },
  { label: '2', test: (v) => v === 2 },
  { label: '3', test: (v) => v === 3 },
  { label: '4', test: (v) => v === 4 },
  { label: '5+', test: (v) => v >= 5 },
];

function HistogramChart({
  data,
  xlabel,
  color,
}: {
  data: { label: string; count: number }[];
  xlabel: string;
  color: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#424242" />
        <XAxis
          dataKey="label"
          tick={{ fill: '#a3a3a3', fontSize: 11 }}
          label={{
            value: xlabel,
            position: 'insideBottom',
            offset: -12,
            fill: '#a3a3a3',
            fontSize: 11,
          }}
        />
        <YAxis tick={{ fill: '#a3a3a3', fontSize: 11 }} allowDecimals={false} width={32} />
        <Tooltip
          contentStyle={{
            backgroundColor: '#333333',
            border: '1px solid #424242',
            borderRadius: 6,
          }}
          labelStyle={{ color: '#e0e0e0' }}
          itemStyle={{ color: '#a3a3a3' }}
          formatter={(value) => [value as number, 'Nodes']}
        />
        <Bar dataKey="count" fill={color} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function RFHistogramsPanel({ nodes }: RFHistogramsPanelProps) {
  const { t } = useTranslation();

  const { snrData, rssiData, hopData, nodeCount } = useMemo(() => {
    const snrVals: number[] = [];
    const rssiVals: number[] = [];
    const hopVals: number[] = [];

    for (const node of nodes.values()) {
      if (typeof node.snr === 'number' && node.snr !== 0) snrVals.push(node.snr);
      if (typeof node.rssi === 'number' && node.rssi !== 0) rssiVals.push(node.rssi);
      if (typeof node.hops_away === 'number') hopVals.push(node.hops_away);
    }

    return {
      snrData: buildHistogram(snrVals, SNR_BUCKETS),
      rssiData: buildHistogram(rssiVals, RSSI_BUCKETS),
      hopData: buildHistogram(hopVals, HOP_BUCKETS),
      nodeCount: nodes.size,
    };
  }, [nodes]);

  if (nodeCount === 0) {
    return (
      <div className="text-ink-400 flex h-full items-center justify-center">
        {t('rfHistograms.noNodes')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h2 className="text-ink-200 text-base font-semibold">{t('rfHistograms.title')}</h2>
        <p className="text-ink-400 text-xs">{t('rfHistograms.subtitle', { count: nodeCount })}</p>
      </div>

      <section>
        <h3 className="text-ink-300 mb-1 text-sm font-medium">{t('rfHistograms.snrTitle')}</h3>
        <HistogramChart data={snrData} xlabel={t('rfHistograms.snrAxis')} color="#22c55e" />
      </section>

      <section>
        <h3 className="text-ink-300 mb-1 text-sm font-medium">{t('rfHistograms.rssiTitle')}</h3>
        <HistogramChart data={rssiData} xlabel={t('rfHistograms.rssiAxis')} color="#3b82f6" />
      </section>

      <section>
        <h3 className="text-ink-300 mb-1 text-sm font-medium">{t('rfHistograms.hopTitle')}</h3>
        <HistogramChart data={hopData} xlabel={t('rfHistograms.hopAxis')} color="#f59e0b" />
      </section>
    </div>
  );
}
