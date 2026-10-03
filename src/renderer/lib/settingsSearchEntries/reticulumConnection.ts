import type {
  SettingSearchEntry,
  SettingsSearchContext,
  SettingsSearchSurface,
} from '../settingsSearch';

// ConnectionPanel renders ReticulumStackPanel (and its interfaces UI) only behind this flag.
const hasStackPanel = (ctx: SettingsSearchContext) => ctx.capabilities.hasReticulumInterfaceConfig;

const STACK = 'connectionPanel.reticulumStackTitle';
const INTERFACES = 'connectionPanel.reticulumInterfaces.title';

const reticulumConnectionEntries: readonly SettingSearchEntry[] = [
  {
    id: 'connection.reticulumStack.startStop',
    slot: 'Connection',
    labelKey: 'connectionPanel.reticulumStartStack',
    sectionKey: STACK,
    keywords: ['stop stack', 'sidecar', 'rns', 'start'],
    visible: hasStackPanel,
  },
  {
    id: 'connection.reticulumStack.autostart',
    slot: 'Connection',
    labelKey: 'connectionPanel.reticulumAutostart',
    sectionKey: STACK,
    keywords: ['auto start', 'launch', 'startup'],
    visible: hasStackPanel,
  },
  {
    id: 'connection.reticulumStack.autoResendOnAnnounce',
    slot: 'Connection',
    labelKey: 'connectionPanel.reticulumAutoResendOnAnnounce',
    sectionKey: STACK,
    keywords: ['retry', 'resend', 'failed messages', 'announce'],
    visible: hasStackPanel,
  },
  {
    id: 'connection.reticulumInterfaces.profiles',
    slot: 'Connection',
    labelKey: 'connectionPanel.reticulumInterfaces.profilesTitle',
    sectionKey: STACK,
    keywords: ['interface profiles', 'presets', 'save interfaces'],
    visible: hasStackPanel,
  },
  {
    id: 'connection.reticulumInterfaces.list',
    slot: 'Connection',
    labelKey: INTERFACES,
    sectionKey: STACK,
    keywords: ['interfaces', 'enable', 'disable', 'tcp', 'rnode', 'udp', 'i2p', 'serial'],
    visible: hasStackPanel,
  },
  {
    id: 'connection.reticulumInterfaces.addDefaultHubs',
    slot: 'Connection',
    labelKey: 'connectionPanel.reticulumInterfaces.addDefaultHubs',
    sectionKey: INTERFACES,
    keywords: ['backbone', 'hubs', 'default', 'internet', 'tcp'],
    visible: hasStackPanel,
  },
  {
    id: 'connection.reticulumInterfaces.addInterface',
    slot: 'Connection',
    labelKey: 'connectionPanel.reticulumInterfaces.add',
    sectionKey: INTERFACES,
    keywords: ['new interface', 'tcp client', 'rnode', 'serial', 'ble', 'udp', 'i2p', 'pipe'],
    visible: hasStackPanel,
  },
  {
    id: 'connection.reticulumInterfaces.bootstrapOnly',
    slot: 'Connection',
    labelKey: 'connectionPanel.reticulumInterfaces.bootstrapOnly',
    sectionKey: INTERFACES,
    keywords: ['bootstrap', 'discovery', 'temporary'],
    visible: hasStackPanel,
  },
];

export const reticulumConnectionSurface: SettingsSearchSurface = {
  entries: reticulumConnectionEntries,
  files: [
    { path: 'src/renderer/components/ReticulumStackPanel.tsx', sweepAllKeys: true },
    { path: 'src/renderer/components/reticulum/ReticulumInterfacesPanel.tsx', sweepAllKeys: true },
    {
      path: 'src/renderer/components/reticulum/ReticulumInterfaceProfilesSection.tsx',
      sweepAllKeys: true,
    },
  ],
  exempt: {
    'connectionPanel.reticulumStopStack': 'running-state label of the indexed start/stop button',
    'connectionPanel.reticulumStackRunningAs': 'status tile detail, not a control',
    'app.deviceStatus.connecting': 'status tile text, not a control',
    'connectionPanel.reticulumInterfaces.restartStackUnavailable':
      'setup guide restart error, not a control',
    'connectionPanel.reticulumInterfaces.*Aria': 'accessible-name variant of an interface control',
    'connectionPanel.reticulumInterfaces.*Success': 'result toast, not a control',
    'connectionPanel.reticulumInterfaces.addDefaultHubsAllPresent':
      'result toast of the indexed Add default backbones button',
    'connectionPanel.reticulumInterfaces.*Confirm*': 'interface delete confirmation dialog copy',
    'connectionPanel.reticulumInterfaces.*Required': 'add-interface validation error',
    'connectionPanel.reticulumInterfaces.invalid*': 'add/edit interface validation error',
    'connectionPanel.reticulumInterfaces.localOfflineRow*': 'per-row offline status text',
    'connectionPanel.reticulumInterfaces.backbone*':
      'guidance and directory link beside the indexed Add default backbones button',
    'connectionPanel.reticulumInterfaces.rfProfile.*': 'per-row RF profile badge',
    'connectionPanel.reticulumInterfaces.rnodeTransport*':
      'RNode transport picker inside the indexed add-interface form',
    'connectionPanel.reticulumInterfaces.rnodeWifi*':
      'RNode Wi-Fi fields inside the indexed add-interface form',
    'connectionPanel.reticulumInterfaces.effectiveMode*': 'per-row effective mode badge',
    'connectionPanel.reticulumInterfaces.decommissioned*': 'decommissioned hub badge and notice',
    'connectionPanel.reticulumInterfaces.audit*': 'per-row config audit fix action or result',
    'connectionPanel.reticulumInterfaces.rmapDiscoverableShort': 'per-row RMAP discoverable toggle',
    'connectionPanel.reticulumInterfaces.selectAll': 'bulk-selection toolbar for interface rows',
    'connectionPanel.reticulumInterfaces.clearSelection':
      'bulk-selection toolbar for interface rows',
    'connectionPanel.reticulumInterfaces.deleteSelected':
      'bulk delete for interface rows in the indexed list',
    'connectionPanel.reticulumInterfaces.delete': 'per-row action in the indexed interfaces list',
    'connectionPanel.reticulumInterfaces.edit': 'per-row action in the indexed interfaces list',
    'connectionPanel.reticulumInterfaces.enable': 'per-row action in the indexed interfaces list',
    'connectionPanel.reticulumInterfaces.disable': 'per-row action in the indexed interfaces list',
    'connectionPanel.reticulumInterfaces.setPrimaryLocal':
      'per-row action in the indexed interfaces list',
    'connectionPanel.reticulumInterfaces.editTitle': 'per-row interface editor heading',
    'connectionPanel.reticulumInterfaces.saveEdit': 'per-row interface editor button',
    'connectionPanel.reticulumInterfaces.cancelEdit': 'per-row interface editor button',
    'connectionPanel.reticulumInterfaces.name': 'field of the per-row interface editor',
    'connectionPanel.reticulumInterfaces.mode': 'field of the add-interface form and row editor',
    'connectionPanel.reticulumInterfaces.type': 'field of the indexed add-interface form',
    'connectionPanel.reticulumInterfaces.blePeerType': 'option value of the interface type picker',
    'connectionPanel.reticulumInterfaces.host': 'field of the add-interface form and row editor',
    'connectionPanel.reticulumInterfaces.port': 'field of the add-interface form and row editor',
    'connectionPanel.reticulumInterfaces.serialPort':
      'field of the add-interface form and row editor',
    'connectionPanel.reticulumInterfaces.preset': 'field of the add-interface form and row editor',
    'connectionPanel.reticulumInterfaces.callsign':
      'field of the add-interface form and row editor',
    'connectionPanel.reticulumInterfaces.seedAddresses':
      'field of the add-interface form and row editor',
    'connectionPanel.reticulumInterfaces.pipeCommand': 'field of the indexed add-interface form',
    'connectionPanel.reticulumInterfaces.flowControl':
      'field of the add-interface form and row editor',
    'connectionPanel.reticulumInterfaces.pickDevice': 'device picker of the add-interface form',
    'connectionPanel.reticulumInterfaces.networkName': 'IFAC field of the add/edit interface form',
    'connectionPanel.reticulumInterfaces.passphrase': 'IFAC field of the add/edit interface form',
    'connectionPanel.reticulumInterfaces.showPassphrase': 'reveal toggle of the IFAC passphrase',
    'connectionPanel.reticulumInterfaces.hidePassphrase': 'reveal toggle of the IFAC passphrase',
    'connectionPanel.reticulumInterfaces.advanced': 'advanced key/value block of the row editor',
    'connectionPanel.reticulumInterfaces.advancedKeyReserved': 'row editor validation error',
    'connectionPanel.reticulumInterfaces.defaultHubsLabel':
      'caption above the indexed Add default backbones button',
    'connectionPanel.reticulumInterfaces.bleAvailable': 'status text under the add-interface form',
    'connectionPanel.reticulumInterfaces.primaryLocalSummary': 'status text, not a control',
    'connectionPanel.reticulumInterfaces.primaryLocalBadge': 'per-row badge',
    'connectionPanel.reticulumInterfaces.runtimeBadge': 'per-row badge',
    'connectionPanel.reticulumNetworkEmpty': 'empty state of the indexed interfaces list',
    'connectionPanel.hostSignal': 'per-row link quality readout',
    'connectionPanel.hostSignalUnavailable': 'per-row link quality readout',
    'connectionPanel.linkQuality': 'per-row link quality readout',
    'connectionPanel.linkQualityMs': 'per-row link quality readout',
    'connectionPanel.linkQualityUnavailable': 'per-row link quality readout',
    'connectionPanel.reticulumRmap.syncSuccess': 'result toast, not a control',
    'diagnosticsPanel.reticulum.action.disable_share_instance': 'per-row audit fix button label',
    'reticulumRmapDiscovery.gpsMissingWarning': 'warning toast for the per-row RMAP toggle',
    'reticulumRmapDiscovery.restart*': 'restart dialog after a per-row RMAP toggle',
    'connectionPanel.reticulumInterfaces.profiles*':
      'profile rows and actions inside the indexed Interface profiles card',
    'connectionPanel.reticulumInterfaces.restartStackFailed': 'error toast, not a control',
    'connectionPanel.tiles.stopped': 'stack status tile text',
    'connectionPanel.tiles.running': 'stack status tile text',
    'connectionPanel.tiles.stack': 'stack status tile label',
    'connectionPanel.connecting': 'busy label, not a control',
    'connectionPanel.reticulumStackHint': 'help text under the indexed stack card',
    'connectionPanel.reticulumInterfaces.deleteSelectedPartialFailed': 'error toast, not a control',
    'connectionPanel.reticulumRmap.syncFailed': 'error toast, not a control',
    'connectionPanel.reticulumInterfaces.rmapToggleFailed': 'error toast, not a control',
    'connectionPanel.reticulumInterfaces.restartStackHint': 'help text for the restart prompt',
    'connectionPanel.reticulumInterfaces.networkNamePlaceholder':
      'placeholder of an interface field',
    'connectionPanel.reticulumInterfaces.passphrasePlaceholder':
      'placeholder of an interface field',
    'connectionPanel.reticulumInterfaces.modeHint': 'help text inside the interface editor',
    'connectionPanel.reticulumLocalInterfaces.stalePortHint':
      'status hint for a missing serial port',
    'connectionPanel.reticulumInterfaces.flowControlBleHint':
      'help text inside the interface editor',
    'connectionPanel.reticulumInterfaces.callsignPlaceholder': 'placeholder of an interface field',
    'connectionPanel.reticulumInterfaces.seedAddressesPlaceholder':
      'placeholder of an interface field',
    'connectionPanel.reticulumInterfaces.bootstrapOnlyHint':
      'help text inside the interface editor',
    'connectionPanel.reticulumInterfaces.advancedHint': 'help text inside the interface editor',
    'connectionPanel.reticulumInterfaces.identityRequiredHint': 'status hint, not a control',
    'connectionPanel.bleRssiDbm': 'signal strength readout, not a control',
    'connectionPanel.reticulumInterfaces.rmapFullModeHint':
      'help text for the indexed RMAP section',
  },
};
