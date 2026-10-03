import type { SettingSearchEntry, SettingsSearchSurface } from '../settingsSearch';

const INBOUND = 'reticulumRemote.settings.inboundTitle';
const RELIABILITY = 'reticulumRemote.settings.reliabilityTitle';

const remoteEntries: readonly SettingSearchEntry[] = [
  {
    id: 'remote.inbound.mode',
    slot: 'Remote',
    labelKey: INBOUND,
    keywords: ['rncp', 'receive files', 'listener', 'ask', 'off'],
  },
  {
    id: 'remote.inbound.saveDir',
    slot: 'Remote',
    labelKey: 'reticulumRemote.settings.chooseSaveDir',
    sectionKey: INBOUND,
    keywords: ['rncp', 'download folder', 'save directory'],
  },
  {
    id: 'remote.inbound.allowFetch',
    slot: 'Remote',
    labelKey: 'reticulumRemote.settings.allowFetch',
    sectionKey: INBOUND,
    keywords: ['rncp', 'fetch', 'remote download'],
  },
  {
    id: 'remote.inbound.fetchJail',
    slot: 'Remote',
    labelKey: 'reticulumRemote.settings.chooseFetchJail',
    sectionKey: INBOUND,
    keywords: ['rncp', 'fetch', 'jail', 'shared folder'],
  },
  {
    id: 'remote.inbound.overwrite',
    slot: 'Remote',
    labelKey: 'reticulumRemote.settings.overwrite',
    sectionKey: INBOUND,
    keywords: ['rncp', 'replace', 'existing files'],
  },
  {
    id: 'remote.access.allowBlockList',
    slot: 'Remote',
    labelKey: 'reticulumRemote.settings.allowBlockListTitle',
    keywords: ['rncp', 'rnsh', 'allow', 'block', 'allowlist', 'trusted identities'],
  },
  {
    id: 'remote.reliability.autoReconnectShell',
    slot: 'Remote',
    labelKey: 'reticulumRemote.settings.autoReconnectShell',
    sectionKey: RELIABILITY,
    keywords: ['rnsh', 'shell', 'reconnect'],
  },
  {
    id: 'remote.reliability.autoRetryTransfer',
    slot: 'Remote',
    labelKey: 'reticulumRemote.settings.autoRetryTransfer',
    sectionKey: RELIABILITY,
    keywords: ['rncp', 'retry', 'transfer'],
  },
  {
    id: 'remote.identity.announceReceiveDest',
    slot: 'Remote',
    labelKey: 'reticulumRemote.settings.announceReceiveDest',
    sectionKey: 'reticulumRemote.settings.identityTitle',
    keywords: ['rncp', 'announce', 'destination'],
  },
];

export const remoteSurface: SettingsSearchSurface = {
  entries: remoteEntries,
  files: [{ path: 'src/renderer/components/remote/RemoteSettingsSection.tsx', sweepAllKeys: true }],
  exempt: {
    'reticulumRemote.settings.*Aria': 'accessible-name variant of a Remote setting',
    'reticulumRemote.settings.*Failed': 'result toast, not a control',
    'reticulumRemote.settings.*Done': 'result toast, not a control',
    'reticulumRemote.settings.announceReceiveDestListenerOff':
      'result toast of the indexed announce button',
    'reticulumRemote.settings.no*': 'placeholder when no folder has been chosen',
    'reticulumRemote.settings.fetchJailRequired': 'validation error',
    'reticulumRemote.enableRequest.saveDirRequired': 'validation error',
    'reticulumRemote.settings.rechooseSaveDir': 'variant label of the indexed save folder button',
    'reticulumRemote.settings.maxSizeInfo': 'informational text, not a control',
    'reticulumRemote.settings.allowBlockListEmpty': 'empty state of the indexed policy list',
    'reticulumRemote.settings.myIdentity': 'read-only identity readout',
    'reticulumRemote.transfer.myReceiveDest': 'read-only destination readout',
  },
};
