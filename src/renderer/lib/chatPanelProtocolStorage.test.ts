import { beforeEach, describe, expect, it } from 'vitest';

import {
  lastReadStorageKey,
  loadOpenDmTabsInitial,
  loadPersistedLastReadInitial,
  openDmTabsStorageKey,
} from './chatPanelProtocolStorage';

describe('chatPanelProtocolStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('migrates legacy openDmTabs only into meshtastic key', () => {
    localStorage.setItem('mesh-client:openDmTabs', JSON.stringify([0xabc]));
    const mt = loadOpenDmTabsInitial('meshtastic');
    expect(mt).toEqual([0xabc]);
    expect(localStorage.getItem(openDmTabsStorageKey('meshtastic'))).toBe(JSON.stringify([0xabc]));

    localStorage.clear();
    localStorage.setItem('mesh-client:openDmTabs', JSON.stringify([0xabc]));
    const mc = loadOpenDmTabsInitial('meshcore');
    expect(mc).toEqual([]);
    expect(localStorage.getItem(openDmTabsStorageKey('meshcore'))).toBeNull();
  });

  it('migrates legacy lastRead only into meshtastic key', () => {
    localStorage.setItem('mesh-client:lastRead', JSON.stringify({ 'ch:0': 1 }));
    const mt = loadPersistedLastReadInitial('meshtastic');
    expect(mt).toEqual({ 'ch:0': 1 });
    expect(localStorage.getItem(lastReadStorageKey('meshtastic'))).toBe(
      JSON.stringify({ 'ch:0': 1 }),
    );

    localStorage.clear();
    localStorage.setItem('mesh-client:lastRead', JSON.stringify({ 'ch:0': 1 }));
    const mc = loadPersistedLastReadInitial('meshcore');
    expect(mc).toEqual({});
    expect(localStorage.getItem(lastReadStorageKey('meshcore'))).toBeNull();
  });
});
