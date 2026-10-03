import type { SettingSearchEntry, SettingsSearchSurface } from '../settingsSearch';

const statsEntries: readonly SettingSearchEntry[] = [
  {
    id: 'stats.packets.view',
    slot: 'Stats',
    labelKey: 'packetDistribution.distributionByType',
    keywords: ['overall', 'packet types', 'pie chart', 'distribution'],
  },
  {
    id: 'stats.packets.sourceFilter',
    slot: 'Stats',
    labelKey: 'packetDistribution.allSources',
    keywords: ['rf', 'mqtt', 'source', 'filter'],
    // App.tsx mounts the source-filtering variant only for the MQTT-hybrid protocol.
    visible: (ctx) => ctx.capabilities.hasMqttHybrid,
  },
  {
    id: 'stats.packets.timeRange',
    slot: 'Stats',
    labelKey: 'packetDistribution.lastHour',
    keywords: ['time range', '24 hours', 'window', 'period'],
  },
];

export const statsSurface: SettingsSearchSurface = {
  entries: statsEntries,
  files: [{ path: 'src/renderer/components/PacketDistributionPanel.tsx', sweepAllKeys: true }],
  exempt: {
    'packetDistribution.overallDistribution': 'option of the indexed view toggle',
    'packetDistribution.rfOnly': 'option of the indexed source filter',
    'packetDistribution.mqttOnly': 'option of the indexed source filter',
    'packetDistribution.last24Hours': 'option of the indexed time range',
    'packetDistribution.allData': 'option of the indexed time range',
    'packetDistribution.packetsBy*': 'chart titles, not controls',
    'packetDistribution.devicesTransmitting': 'chart caption, not a control',
    'packetDistribution.packets': 'packet count status text',
    'packetDistribution.no*': 'empty-state text or fallback sender label',
    'packetDistribution.other': 'chart slice label',
  },
};
