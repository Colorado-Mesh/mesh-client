import { describe, expect, it } from 'vitest';

import {
  nomadNetworkActiveTabCount,
  nomadNetworkActiveTabLabelKey,
  nomadNetworkEmptyListKey,
  nomadNetworkSearchPlaceholderKey,
} from './nomadNetworkTabHelpers';

describe('nomadNetworkTabHelpers', () => {
  it('resolves active tab counts without nested ternaries', () => {
    expect(nomadNetworkActiveTabCount('favourites', 3, 10)).toBe(3);
    expect(nomadNetworkActiveTabCount('announces', 3, 10)).toBe(10);
    expect(nomadNetworkActiveTabCount('myPages', 3, 10)).toBe(0);
  });

  it('resolves label / empty / search keys per tab', () => {
    expect(nomadNetworkActiveTabLabelKey('favourites')).toBe('nomadNetwork.favourites');
    expect(nomadNetworkActiveTabLabelKey('myPages')).toBe('nomadNetwork.myPagesTab');
    expect(nomadNetworkActiveTabLabelKey('announces')).toBe('nomadNetwork.announces');
    expect(nomadNetworkEmptyListKey('favourites')).toBe('nomadNetwork.emptyFavourites');
    expect(nomadNetworkEmptyListKey('announces')).toBe('nomadNetwork.emptyAnnounces');
    expect(nomadNetworkSearchPlaceholderKey('favourites')).toBe('nomadNetwork.searchFavourites');
    expect(nomadNetworkSearchPlaceholderKey('announces')).toBe('nomadNetwork.searchAnnounces');
  });
});
