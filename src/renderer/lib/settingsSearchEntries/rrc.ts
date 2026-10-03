import type { SettingSearchEntry, SettingsSearchSurface } from '../settingsSearch';

const rrcEntries: readonly SettingSearchEntry[] = [
  {
    id: 'rrc.hubs.nickname',
    slot: 'RRC',
    labelKey: 'rrc.nickname',
    sectionKey: 'rrc.hubsTitle',
    keywords: ['nick', 'name', 'handle', 'irc'],
  },
  {
    id: 'rrc.hubs.connectManual',
    slot: 'RRC',
    labelKey: 'rrc.connectManual',
    sectionKey: 'rrc.hubsTitle',
    keywords: ['hub hash', 'manual', 'connect', 'irc'],
  },
];

export const rrcSurface: SettingsSearchSurface = {
  entries: rrcEntries,
  files: [{ path: 'src/renderer/components/rrc/RrcHubBrowser.tsx', sweepAllKeys: true }],
  exempt: {
    'rrc.hubMarker.*': 'hub list status marker',
    'rrc.hubs.*': 'hub list group heading',
    'rrc.no*Hubs': 'empty state of a hub list group',
    'rrc.*AutoJoin*': 'per-hub auto-join toggle and its hints',
    'rrc.*favoriteHub': 'per-hub favourite toggle',
    'rrc.autoJoinChip': 'per-hub badge',
    'rrc.hopsAway': 'per-hub status text',
    'rrc.userCount': 'per-hub status text',
    'rrc.hubLegend': 'hub list legend',
    'rrc.searchHubs': 'hub list filter, not a setting',
    'rrc.selectHub': 'per-hub navigation',
    'rrc.selectHubUnread': 'per-hub navigation',
    'rrc.manualHashPlaceholder': 'input placeholder of the indexed manual connect',
    'connectionPanel.reticulumIdentity.startStackFirst': 'status hint while the stack is stopped',
  },
};
