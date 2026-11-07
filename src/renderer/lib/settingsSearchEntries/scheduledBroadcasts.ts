import type { SettingsSearchSurface } from '../settingsSearch';

export const scheduledBroadcastsSurface: SettingsSearchSurface = {
  entries: [
    {
      id: 'scheduledBroadcasts.enabled',
      slot: 'ScheduledBroadcasts',
      labelKey: 'scheduledBroadcasts.enabled',
      sectionKey: 'scheduledBroadcasts.title',
      keywords: ['broadcast', 'schedule', 'recurring', 'auto'],
    },
  ],
  files: [
    {
      path: 'src/renderer/components/scheduledBroadcasts/ScheduledBroadcastsPanel.tsx',
    },
  ],
  exempt: {},
};
