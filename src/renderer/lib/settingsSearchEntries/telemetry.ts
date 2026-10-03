import type { SettingSearchEntry, SettingsSearchSurface } from '../settingsSearch';

const telemetryEntries: readonly SettingSearchEntry[] = [
  {
    id: 'telemetry.display.temperatureUnit',
    slot: 'Telemetry',
    labelKey: 'telemetryPanel.toggleTempUnit',
    sectionKey: 'telemetryPanel.title',
    keywords: ['fahrenheit', 'celsius', 'temperature', 'units'],
    visible: (ctx) => ctx.capabilities.hasEnvironmentTelemetry,
  },
  {
    id: 'telemetry.data.exportCsv',
    slot: 'Telemetry',
    labelKey: 'telemetryPanel.exportCsvButton',
    sectionKey: 'telemetryPanel.title',
    keywords: ['csv', 'export', 'download', 'battery', 'signal'],
  },
];

export const telemetrySurface: SettingsSearchSurface = {
  entries: telemetryEntries,
  files: [{ path: 'src/renderer/components/TelemetryPanel.tsx', sweepAllKeys: true }],
  exempt: {
    'telemetryPanel.chart*': 'chart accessible summary or missing-value placeholder',
    'telemetryPanel.axis*': 'chart axis label',
    'telemetryPanel.series*': 'chart series legend name',
    'telemetryPanel.section*': 'read-only chart heading, no control',
    'telemetryPanel.stat*': 'read-only packet counter label',
    'telemetryPanel.footer*': 'sample count footer text',
    'telemetryPanel.empty*': 'empty-state text, not a control',
    'telemetryPanel.tempUnit*': 'current value text of the indexed temperature unit toggle',
    'telemetryPanel.exportCsv': 'tooltip of the indexed CSV export button',
  },
};
