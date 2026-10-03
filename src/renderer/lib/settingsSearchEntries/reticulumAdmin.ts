import type { SettingSearchEntry, SettingsSearchSurface } from '../settingsSearch';

const reticulumAdminEntries: readonly SettingSearchEntry[] = [
  {
    id: 'admin.reticulumFlasher.rnodeFlasher',
    slot: 'Admin',
    labelKey: 'flasher.title',
    keywords: ['rnode', 'firmware', 'flash', 'update', 'bluetooth pairing'],
    visible: (ctx) => ctx.capabilities.hasReticulumAdminPanel && ctx.capabilities.hasRNodeFlasher,
  },
  {
    id: 'admin.reticulumDanger.factoryReset',
    slot: 'Admin',
    labelKey: 'adminPanel.reticulumFactoryReset.button',
    sectionKey: 'radioPanel.dangerZone',
    keywords: ['reset', 'wipe', 'factory', 'stack', 'identity'],
    visible: (ctx) => ctx.capabilities.hasReticulumAdminPanel,
  },
];

export const reticulumAdminSurface: SettingsSearchSurface = {
  entries: reticulumAdminEntries,
  files: [{ path: 'src/renderer/components/ReticulumAdminPanel.tsx', sweepAllKeys: true }],
  exempt: {
    'adminPanel.reticulumFactoryReset.confirm*': 'factory reset confirmation dialog copy',
    'adminPanel.reticulumFactoryReset.title': 'heading inside the indexed danger zone card',
    'adminPanel.reticulumFactoryReset.hint': 'factory reset description',
    'flasher.stackStoppedHint': 'stack-stopped notice, not a control',
    'radioPanel.actionCompleted': 'toast, not a control',
    'radioPanel.actionFailed': 'error toast, not a control',
    'tabs.admin': 'panel heading; the launcher already lists Admin',
    'connectionPanel.reticulumIdentity.startStackFirst': 'status hint while the stack is stopped',
    'radioPanel.dangerZonePermanent': 'warning text in the danger zone',
  },
};
