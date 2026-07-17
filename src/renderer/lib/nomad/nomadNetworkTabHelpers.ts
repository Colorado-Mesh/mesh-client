/** Tab helpers for Nomad Network panel (kept free of nested ternaries for Sonar). */

export type NomadListTab = 'favourites' | 'announces' | 'myPages';

export function nomadNetworkActiveTabCount(
  activeTab: NomadListTab,
  favouritesCount: number,
  announcesCount: number,
): number {
  if (activeTab === 'favourites') return favouritesCount;
  if (activeTab === 'myPages') return 0;
  return announcesCount;
}

export function nomadNetworkActiveTabLabelKey(activeTab: NomadListTab): string {
  if (activeTab === 'favourites') return 'nomadNetwork.favourites';
  if (activeTab === 'myPages') return 'nomadNetwork.myPagesTab';
  return 'nomadNetwork.announces';
}

export function nomadNetworkEmptyListKey(activeTab: NomadListTab): string {
  if (activeTab === 'favourites') return 'nomadNetwork.emptyFavourites';
  return 'nomadNetwork.emptyAnnounces';
}

export function nomadNetworkSearchPlaceholderKey(activeTab: NomadListTab): string {
  if (activeTab === 'favourites') return 'nomadNetwork.searchFavourites';
  return 'nomadNetwork.searchAnnounces';
}
