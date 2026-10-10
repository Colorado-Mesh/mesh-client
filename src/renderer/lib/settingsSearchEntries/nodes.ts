import type {
  SettingSearchEntry,
  SettingsSearchContext,
  SettingsSearchSurface,
} from '../settingsSearch';

// NodeListPanel shows the contact import, refresh, advert and offload controls only with this flag.
const hasContactTools = (ctx: SettingsSearchContext) => ctx.capabilities.hasContactImportExport;
const hasContactGroups = (ctx: SettingsSearchContext) =>
  ctx.capabilities.hasUserManagedContactGroups;

const CONTACTS = 'nodeListPanel.headingContacts';

const nodesEntries: readonly SettingSearchEntry[] = [
  {
    id: 'nodes.filters.searchNodes',
    slot: 'Nodes',
    labelKey: 'nodeListPanel.searchNodesPlaceholder',
    sectionKey: 'nodeListPanel.headingNodeDatabase',
    keywords: ['find', 'filter', 'search', 'node'],
    visible: (ctx) => !ctx.capabilities.nodeListTabUsesContactsLabel,
  },
  {
    id: 'nodes.filters.searchContacts',
    slot: 'Nodes',
    labelKey: 'nodeListPanel.searchContactsPlaceholder',
    sectionKey: CONTACTS,
    keywords: ['find', 'filter', 'search', 'contact'],
    visible: (ctx) => ctx.capabilities.nodeListTabUsesContactsLabel,
  },
  {
    id: 'nodes.filters.contactGroup',
    slot: 'Nodes',
    labelKey: 'nodeListPanel.filterByContactGroup',
    keywords: ['group', 'filter', 'category', 'type'],
    visible: hasContactGroups,
  },
  {
    id: 'nodes.filters.manageGroups',
    slot: 'Nodes',
    labelKey: 'nodeListPanel.manageContactGroups',
    keywords: ['group', 'create group', 'edit groups'],
    visible: hasContactGroups,
  },
  {
    id: 'nodes.contacts.refresh',
    slot: 'Nodes',
    labelKey: 'nodeListPanel.refreshContacts',
    sectionKey: CONTACTS,
    keywords: ['sync', 'reload', 'contacts'],
    visible: hasContactTools,
  },
  {
    id: 'nodes.contacts.floodAdvert',
    slot: 'Nodes',
    labelKey: 'nodeListPanel.sendFloodAdvert',
    sectionKey: CONTACTS,
    keywords: ['advert', 'advertise', 'announce', 'flood'],
    visible: hasContactTools,
  },
  {
    id: 'nodes.contacts.import',
    slot: 'Nodes',
    labelKey: 'nodeListPanel.buttonImportContacts',
    sectionKey: CONTACTS,
    keywords: ['import', 'contacts', 'restore'],
    visible: hasContactTools,
  },
  {
    id: 'nodes.contacts.offload',
    slot: 'Nodes',
    labelKey: 'radioPanel.offloadContacts',
    sectionKey: CONTACTS,
    keywords: ['offload', 'radio full', 'capacity', 'contacts'],
    visible: hasContactTools,
  },
];

const OFFLOAD_STATUS = 'progress or result text of the indexed contact offload';

export const nodesSurface: SettingsSearchSurface = {
  entries: nodesEntries,
  files: [{ path: 'src/renderer/components/NodeListPanel.tsx', sweepAllKeys: true }],
  exempt: {
    'nodeListPanel.column*': 'table column header',
    'nodeListPanel.meshcoreType*': 'contact type cell value',
    'nodeListPanel.*Tooltip': 'table cell or column tooltip',
    'nodeListPanel.*Failed': 'error toast, not a control',
    'nodeListPanel.importResult*': 'result toast of the indexed contact import',
    'nodeListPanel.empty*': 'empty-state text, not a control',
    'nodeListPanel.distanceFilter*': 'banner for the App panel distance filter (indexed there)',
    'nodeListPanel.*Favorites': 'per-row favorite toggle, not a setting',
    'nodeListPanel.status*':
      'status filter segments; transient list view and the shared SegmentedControl takes no anchor',
    'nodeListPanel.tab*':
      'All / History view segments; transient list view and the shared SegmentedControl takes no anchor',
    'nodeListPanel.listViewAria': 'accessible name of the All / History view control',
    'nodeListPanel.buttonExport*': 'node export menu; the shared LabeledMenuButton takes no anchor',
    'nodeListPanel.exportMenuLabel': 'accessible name of the node export menu',
    'nodeListPanel.filterOption*': 'option value of the indexed contact group filter',
    'nodeListPanel.filter*Prefix': 'option value of the indexed contact group filter',
    'nodeListPanel.search*Aria': 'accessible name of the indexed search field',
    'nodeListPanel.manageGroups': 'tooltip of the indexed manage groups button',
    'nodeListPanel.buttonRefresh': 'visible text of the indexed refresh contacts button',
    'nodeListPanel.buttonFloodAdvert': 'visible text of the indexed flood advert button',
    'nodeListPanel.sendFloodAdvertUnavailable': 'tooltip of the indexed flood advert button',
    'nodeListPanel.contactsRefreshed': 'success toast, not a control',
    'nodeListPanel.floodAdvertSent': 'success toast, not a control',
    'nodeListPanel.meshcoreImportedHint': 'help text under the contact filters',
    'nodeListPanel.meshcoreContactType': 'column tooltip',
    'nodeListPanel.favoritesColumn': 'column tooltip',
    'nodeListPanel.hasPublicKeyTitle': 'table cell tooltip',
    'nodeListPanel.healthAriaLabel': 'table cell accessible name',
    'nodeListPanel.showOnMap': 'per-row action, not a setting',
    'nodeListPanel.youBadge': 'badge on your own node row',
    'nodeListPanel.tableCaptionMeshNodes': 'table caption for screen readers',
    'nodeDetailModal.radioCapacityTitle': 'radio capacity warning text beside the indexed offload',
    'radioPanel.offloading': OFFLOAD_STATUS,
    'radioPanel.offloadingProgress': OFFLOAD_STATUS,
    'radioPanel.offloadedContacts': OFFLOAD_STATUS,
    'radioPanel.offloadCancelled': OFFLOAD_STATUS,
    'radioPanel.offloadCancelledPartial': OFFLOAD_STATUS,
    'radioPanel.offloadReconcileStillFull': OFFLOAD_STATUS,
    'radioPanel.offloadReconcileStillNearFull': OFFLOAD_STATUS,
    'radioPanel.offloadReconcileRefreshFailed': OFFLOAD_STATUS,
    'radioPanel.failedOffloadContacts': OFFLOAD_STATUS,
    'appPanel.distanceUnitMiles': 'unit option of the distance column',
    'appPanel.distanceUnitKm': 'unit option of the distance column',
  },
};
