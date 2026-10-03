import type {
  SettingSearchEntry,
  SettingsSearchContext,
  SettingsSearchSurface,
} from '../settingsSearch';

// SecurityPanel renders private key, admin keys and admin settings for Meshtastic only, and the
// sign/export/import crypto card for MeshCore only (both protocols have hasCryptoOperations).
const hasMeshtasticAdmin = (ctx: SettingsSearchContext) => ctx.capabilities.hasRemoteAdmin;
const hasCompanionCrypto = (ctx: SettingsSearchContext) =>
  ctx.capabilities.hasCryptoOperations && !ctx.capabilities.hasRemoteAdmin;

const DM_KEYS = 'securityPanel.sectionDmKeys';
const ADMIN_SETTINGS = 'securityPanel.sectionAdminSettings';
const CRYPTO = 'securityPanel.sectionMeshcoreCrypto';

const securityEntries: readonly SettingSearchEntry[] = [
  {
    id: 'security.dmKeys.publicKey',
    slot: 'Security',
    labelKey: 'securityPanel.publicKeyLabel',
    sectionKey: DM_KEYS,
    keywords: ['public key', 'pki', 'copy', 'identity'],
  },
  {
    id: 'security.dmKeys.privateKey',
    slot: 'Security',
    labelKey: 'securityPanel.privateKeyLabel',
    sectionKey: DM_KEYS,
    keywords: ['private key', 'pki', 'secret'],
    visible: hasMeshtasticAdmin,
  },
  {
    id: 'security.dmKeys.regenerateKeys',
    slot: 'Security',
    labelKey: 'securityPanel.regenerateKeys',
    sectionKey: DM_KEYS,
    keywords: ['new keys', 'rotate', 'reset keys', 'pki'],
    visible: hasMeshtasticAdmin,
  },
  {
    id: 'security.adminKeys.keys',
    slot: 'Security',
    labelKey: 'securityPanel.sectionAdminKeys',
    keywords: ['remote admin', 'authorized keys', 'public key'],
    visible: hasMeshtasticAdmin,
  },
  {
    id: 'security.adminSettings.managedDevice',
    slot: 'Security',
    labelKey: 'securityPanel.managedDevice',
    sectionKey: ADMIN_SETTINGS,
    keywords: ['managed', 'remote admin', 'lock'],
    visible: hasMeshtasticAdmin,
  },
  {
    id: 'security.adminSettings.serialConsole',
    slot: 'Security',
    labelKey: 'securityPanel.serialConsole',
    sectionKey: ADMIN_SETTINGS,
    keywords: ['serial', 'usb', 'console'],
    visible: hasMeshtasticAdmin,
  },
  {
    id: 'security.adminSettings.debugLogApi',
    slot: 'Security',
    labelKey: 'securityPanel.debugLogApi',
    sectionKey: ADMIN_SETTINGS,
    keywords: ['debug', 'log', 'api'],
    visible: hasMeshtasticAdmin,
  },
  {
    id: 'security.adminSettings.adminChannel',
    slot: 'Security',
    labelKey: 'securityPanel.adminChannel',
    sectionKey: ADMIN_SETTINGS,
    keywords: ['legacy admin', 'admin channel'],
    visible: hasMeshtasticAdmin,
  },
  {
    id: 'security.keyBackup.backupRestore',
    slot: 'Security',
    labelKey: 'securityPanel.sectionKeyBackup',
    keywords: ['backup', 'restore', 'keys', 'safe storage'],
  },
  {
    id: 'security.crypto.signData',
    slot: 'Security',
    labelKey: 'securityPanel.signDataLabel',
    sectionKey: CRYPTO,
    keywords: ['sign', 'signature', 'verify'],
    visible: hasCompanionCrypto,
  },
  {
    id: 'security.crypto.exportPrivateKey',
    slot: 'Security',
    labelKey: 'securityPanel.exportPrivateKeyButton',
    sectionKey: CRYPTO,
    keywords: ['private key', 'export', 'backup'],
    visible: hasCompanionCrypto,
  },
  {
    id: 'security.crypto.importPrivateKey',
    slot: 'Security',
    labelKey: 'securityPanel.importPrivateKeyLabel',
    sectionKey: CRYPTO,
    keywords: ['private key', 'import', 'restore'],
    visible: hasCompanionCrypto,
  },
];

export const securitySurface: SettingsSearchSurface = {
  entries: securityEntries,
  files: [{ path: 'src/renderer/components/SecurityPanel.tsx', sweepAllKeys: true }],
  exempt: {
    'securityPanel.*Desc': 'description text; its control is indexed',
    'securityPanel.*Hint': 'help text under an indexed row',
    'securityPanel.*Placeholder': 'placeholder of an indexed field',
    'securityPanel.*Warning': 'warning text, not a control',
    'securityPanel.*Confirm': 'confirmation dialog copy for an indexed action',
    'securityPanel.*Failed*': 'error toast, not a control',
    'securityPanel.failed': 'error toast, not a control',
    'securityPanel.*Applied': 'success toast, not a control',
    'securityPanel.*Base64Label': 'caption of a result shown after an indexed crypto action',
    'securityPanel.*ingPrivateKey': 'busy label of an indexed private key button',
    'securityPanel.*AdminKey*': 'controls inside the indexed Admin Keys section',
    'securityPanel.adminKey*': 'field labels and intro inside the indexed Admin Keys section',
    'securityPanel.applySettings': 'apply button of the Administration settings section',
    'securityPanel.applying': 'busy label of an apply button',
    'securityPanel.signing': 'busy label of the indexed sign data button',
    'securityPanel.regeneratingKeys': 'busy label of the indexed regenerate keys button',
    'securityPanel.signDataButton': 'button of the indexed sign data row',
    'securityPanel.importPrivateKeyButton': 'button of the indexed import private key row',
    'securityPanel.copyPublicKey': 'copy button of the indexed public key row',
    'securityPanel.connectToManage': 'status text when disconnected',
    'securityPanel.dataSigned': 'success toast, not a control',
    'securityPanel.signNoResult': 'error toast, not a control',
    'securityPanel.exportNoKey': 'error toast, not a control',
    'securityPanel.keyRegenRequested': 'success toast, not a control',
    'securityPanel.privateKeyExported': 'success toast, not a control',
    'securityPanel.privateKeyImported': 'success toast, not a control',
    'securityPanel.publicKeyCopied': 'success toast, not a control',
    'configureNode.loading': 'remote config loading status',
  },
};
