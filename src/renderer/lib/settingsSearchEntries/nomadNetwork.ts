import type { SettingSearchEntry, SettingsSearchSurface } from '../settingsSearch';

const SERVING = 'nomadNetwork.serving.title';

const nomadNetworkEntries: readonly SettingSearchEntry[] = [
  {
    id: 'nomadNetwork.serving.contentSource',
    slot: 'NomadNetwork',
    labelKey: 'nomadNetwork.serving.contentSource',
    sectionKey: SERVING,
    keywords: ['folder', 'host', 'pages', 'site', 'directory'],
  },
  {
    id: 'nomadNetwork.serving.displayName',
    slot: 'NomadNetwork',
    labelKey: 'nomadNetwork.serving.displayName',
    sectionKey: SERVING,
    keywords: ['node name', 'site name', 'host'],
  },
  {
    id: 'nomadNetwork.serving.startStop',
    slot: 'NomadNetwork',
    labelKey: 'nomadNetwork.serving.enable',
    sectionKey: SERVING,
    keywords: ['serve', 'host', 'publish', 'stop serving'],
  },
  {
    id: 'nomadNetwork.serving.newPage',
    slot: 'NomadNetwork',
    labelKey: 'nomadNetwork.serving.newPage',
    sectionKey: SERVING,
    keywords: ['micron', 'mu', 'page', 'create'],
  },
];

export const nomadNetworkSurface: SettingsSearchSurface = {
  entries: nomadNetworkEntries,
  files: [{ path: 'src/renderer/components/NomadPageServerPanel.tsx', sweepAllKeys: true }],
  exempt: {
    'nomadNetwork.serving.*Aria': 'accessible-name variant of a page server control',
    'nomadNetwork.serving.*Error': 'result toast, not a control',
    'nomadNetwork.serving.contentSourceFailed': 'result toast, not a control',
    'nomadNetwork.serving.contentSourceNone': 'placeholder of the indexed content source',
    'nomadNetwork.serving.chooseFolder': 'button of the indexed content source row',
    'nomadNetwork.serving.folderHint': 'help text under the indexed content source',
    'nomadNetwork.serving.disable': 'running-state label of the indexed enable button',
    'nomadNetwork.serving.sidecarRequired': 'stack-stopped notice, not a control',
    'nomadNetwork.serving.servingChip': 'status chip, not a control',
    'nomadNetwork.serving.stats': 'status text, not a control',
    'nomadNetwork.serving.destinationHash': 'read-only destination readout',
    'nomadNetwork.serving.copyHash': 'copy-to-clipboard button',
    'nomadNetwork.serving.copied': 'result toast, not a control',
    'nomadNetwork.serving.myPages': 'page list heading',
    'nomadNetwork.serving.noPages': 'empty state of the page list',
    'nomadNetwork.serving.newPageName': 'name field of the indexed new page action',
    'nomadNetwork.serving.invalidPageName': 'validation error',
    'nomadNetwork.serving.edit': 'per-page action',
    'nomadNetwork.serving.editPage': 'per-page action',
    'nomadNetwork.serving.delete': 'per-page action',
    'nomadNetwork.serving.deletePage': 'per-page action',
    'nomadNetwork.serving.restrict': 'per-page action',
    'nomadNetwork.serving.previewSite': 'preview action, not a setting',
    'nomadNetwork.serving.reloadFromDisk': 'reload action, not a setting',
  },
};
