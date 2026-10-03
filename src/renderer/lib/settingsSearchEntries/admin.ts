import type {
  SettingSearchEntry,
  SettingsSearchContext,
  SettingsSearchSurface,
} from '../settingsSearch';

// App.tsx renders ReticulumAdminPanel instead of AdminPanel when this flag is set.
const hasAdminPanel = (ctx: SettingsSearchContext) => !ctx.capabilities.hasReticulumAdminPanel;

const COMMANDS = 'radioPanel.deviceCommands';
const DANGER = 'radioPanel.dangerZone';

const adminEntries: readonly SettingSearchEntry[] = [
  {
    id: 'admin.deviceCommands.enterDfu',
    slot: 'Admin',
    labelKey: 'radioPanel.enterDfuButton',
    sectionKey: COMMANDS,
    keywords: ['dfu', 'firmware', 'bootloader', 'flash'],
    visible: hasAdminPanel,
  },
  {
    id: 'admin.deviceCommands.reboot',
    slot: 'Admin',
    labelKey: 'radioPanel.rebootButton',
    sectionKey: COMMANDS,
    keywords: ['restart', 'reboot', 'power cycle'],
    visible: hasAdminPanel,
  },
  {
    id: 'admin.deviceCommands.rebootOta',
    slot: 'Admin',
    labelKey: 'radioPanel.rebootOtaButton',
    sectionKey: COMMANDS,
    keywords: ['ota', 'firmware', 'update', 'wifi'],
    visible: hasAdminPanel,
  },
  {
    id: 'admin.deviceCommands.resetNodeDb',
    slot: 'Admin',
    labelKey: 'radioPanel.resetNodeDbButton',
    sectionKey: COMMANDS,
    keywords: ['nodedb', 'clear nodes', 'node database'],
    visible: (ctx) => hasAdminPanel(ctx) && ctx.capabilities.hasNodeDbReset,
  },
  {
    id: 'admin.deviceCommands.shutdown',
    slot: 'Admin',
    labelKey: 'radioPanel.shutdownButton',
    sectionKey: COMMANDS,
    keywords: ['power off', 'turn off', 'shutdown'],
    visible: (ctx) => hasAdminPanel(ctx) && ctx.capabilities.hasShutdown,
  },
  {
    id: 'admin.dangerZone.factoryResetConfig',
    slot: 'Admin',
    labelKey: 'radioPanel.factoryResetConfigButton',
    sectionKey: DANGER,
    keywords: ['factory reset', 'wipe', 'config', 'defaults'],
    visible: (ctx) => hasAdminPanel(ctx) && ctx.capabilities.hasFactoryReset,
  },
  {
    id: 'admin.dangerZone.factoryReset',
    slot: 'Admin',
    labelKey: 'radioPanel.factoryResetButton',
    sectionKey: DANGER,
    keywords: ['factory reset', 'wipe', 'erase', 'defaults'],
    visible: (ctx) => hasAdminPanel(ctx) && ctx.capabilities.hasFactoryReset,
  },
];

const DIALOG = 'confirmation dialog copy for an indexed device command';

export const adminSurface: SettingsSearchSurface = {
  entries: adminEntries,
  files: [{ path: 'src/renderer/components/AdminPanel.tsx', sweepAllKeys: true }],
  exempt: {
    'tabs.admin': 'panel heading; the launcher already lists the Admin panel',
    'radioPanel.actionCompleted': 'success toast, not a control',
    'radioPanel.actionFailed': 'error toast, not a control',
    'radioPanel.connectToConfigure': 'disconnected banner, not a control',
    'radioPanel.deviceCommandsImmediateWarning': 'warning prose under the Device Commands heading',
    'radioPanel.dangerZonePermanent': 'warning prose under the Danger Zone heading',
    'radioPanel.enterDfuName': DIALOG,
    'radioPanel.enterDfuTitle': DIALOG,
    'radioPanel.enterDfuMessage': DIALOG,
    'radioPanel.enterDfuConfirm': DIALOG,
    'radioPanel.rebootName': DIALOG,
    'radioPanel.rebootTitle': DIALOG,
    'radioPanel.rebootMessageMeshcore': DIALOG,
    'radioPanel.rebootMessageMeshtastic': DIALOG,
    'radioPanel.rebootConfirm': DIALOG,
    'radioPanel.rebootOtaName': DIALOG,
    'radioPanel.rebootOtaTitle': DIALOG,
    'radioPanel.rebootOtaMessage': DIALOG,
    'radioPanel.rebootOtaConfirm': DIALOG,
    'radioPanel.resetNodeDbName': DIALOG,
    'radioPanel.resetNodeDbTitle': DIALOG,
    'radioPanel.resetNodeDbMessage': DIALOG,
    'radioPanel.resetNodeDbConfirm': DIALOG,
    'radioPanel.shutdownName': DIALOG,
    'radioPanel.shutdownTitle': DIALOG,
    'radioPanel.shutdownMessage': DIALOG,
    'radioPanel.shutdownConfirm': DIALOG,
    'radioPanel.factoryResetConfigName': DIALOG,
    'radioPanel.factoryResetConfigTitle': DIALOG,
    'radioPanel.factoryResetConfigMessage': DIALOG,
    'radioPanel.factoryResetConfigConfirm': DIALOG,
    'radioPanel.factoryResetName': DIALOG,
    'radioPanel.factoryResetTitle': DIALOG,
    'radioPanel.factoryResetMessage': DIALOG,
    'radioPanel.factoryResetConfirm': DIALOG,
  },
};
