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
      sweepAllKeys: true,
    },
  ],
  exempt: {
    'scheduledBroadcasts.intro': 'panel intro copy, not a control',
    'scheduledBroadcasts.respectWarning': 'airtime courtesy note, not a control',
    'scheduledBroadcasts.enabledHint': 'Switch description of the indexed master switch',
    'scheduledBroadcasts.disabledBySetting': 'status text when master switch is off',
    'scheduledBroadcasts.airtimeWarning': 'conditional airtime warning, not a control',
    'scheduledBroadcasts.add': 'per-slot create action, not a setting',
    'scheduledBroadcasts.edit': 'per-slot edit action, not a setting',
    'scheduledBroadcasts.slotLabel': 'per-slot display title interpolation',
    'scheduledBroadcasts.nextDue': 'per-slot status label',
    'scheduledBroadcasts.never': 'per-slot next-due placeholder',
    'scheduledBroadcasts.sendNow': 'per-slot send action, not a setting',
    'scheduledBroadcasts.delete': 'per-slot delete action, not a setting',
    'scheduledBroadcasts.deleteConfirm': 'window.confirm copy for delete',
  },
};
