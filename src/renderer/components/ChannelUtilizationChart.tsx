import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { formatMeshtasticNodeId } from '@/shared/nodeNameUtils';

import type { MeshNode } from '../lib/types';

interface ChannelUtilizationChartProps {
  nodes: Map<number, MeshNode>;
}

export default function ChannelUtilizationChart({ nodes }: ChannelUtilizationChartProps) {
  const { t } = useTranslation();

  const rows = useMemo(() => {
    const out: { name: string; pct: number }[] = [];
    for (const node of nodes.values()) {
      if (typeof node.channel_utilization === 'number' && node.channel_utilization > 0) {
        const pct = Math.min(100, Math.round(node.channel_utilization * 10) / 10);
        const name = node.long_name || node.short_name || formatMeshtasticNodeId(node.node_id);
        out.push({ name, pct });
      }
    }
    return out.sort((a, b) => b.pct - a.pct).slice(0, 30);
  }, [nodes]);

  if (rows.length === 0) {
    return (
      <div className="mt-6 rounded border border-slate-700 bg-slate-800/50 p-4">
        <h3 className="mb-1 text-sm font-medium text-slate-300">{t('channelUtilization.title')}</h3>
        <p className="text-xs text-slate-500">{t('channelUtilization.noData')}</p>
      </div>
    );
  }

  const chartHeight = Math.max(160, rows.length * 28);

  return (
    <div className="mt-6 rounded border border-slate-700 bg-slate-800/50 p-4">
      <h3 className="mb-1 text-sm font-medium text-slate-300">{t('channelUtilization.title')}</h3>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 48, left: 0, bottom: 0 }}>
          <XAxis
            type="number"
            domain={[0, 100]}
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickFormatter={(v) => `${v}%`}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={120}
            tick={{ fill: '#94a3b8', fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 6,
            }}
            labelStyle={{ color: '#e2e8f0' }}
            itemStyle={{ color: '#94a3b8' }}
            formatter={(value) => [`${value}%`, t('channelUtilization.tooltipLabel')]}
          />
          <Bar dataKey="pct" radius={[0, 3, 3, 0]} fill="#4ade80">
            <LabelList
              dataKey="pct"
              position="right"
              style={{ fill: '#94a3b8', fontSize: 11 }}
              formatter={(v: unknown) => `${v}%`}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
