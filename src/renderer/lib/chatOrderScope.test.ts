/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { migrateLegacyChatOrderScope } from './chatOrderScope';

describe('migrateLegacyChatOrderScope', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('copies legacy :0: order to resolved scope and removes legacy key', () => {
    localStorage.setItem('mesh-client:chatOrder:meshtastic:0:channels', JSON.stringify(['2', '1']));
    migrateLegacyChatOrderScope('meshtastic', '42');
    expect(localStorage.getItem('mesh-client:chatOrder:meshtastic:42:channels')).toBe(
      JSON.stringify(['2', '1']),
    );
    expect(localStorage.getItem('mesh-client:chatOrder:meshtastic:0:channels')).toBeNull();
  });

  it('keeps legacy key when destination already exists with different order', () => {
    localStorage.setItem('mesh-client:chatOrder:meshtastic:0:channels', JSON.stringify(['2', '1']));
    localStorage.setItem(
      'mesh-client:chatOrder:meshtastic:42:channels',
      JSON.stringify(['1', '2']),
    );
    migrateLegacyChatOrderScope('meshtastic', '42');
    expect(localStorage.getItem('mesh-client:chatOrder:meshtastic:0:channels')).toBe(
      JSON.stringify(['2', '1']),
    );
    expect(localStorage.getItem('mesh-client:chatOrder:meshtastic:42:channels')).toBe(
      JSON.stringify(['1', '2']),
    );
  });

  it('keeps legacy key when destination write fails', () => {
    const fromKey = 'mesh-client:chatOrder:meshcore:0:dms';
    const toKey = 'mesh-client:chatOrder:meshcore:7:dms';
    localStorage.setItem(fromKey, JSON.stringify(['9', '8']));
    // Spy the instance method — jsdom's localStorage.setItem is not always routed via
    // Storage.prototype, so a prototype-only spy would miss and the migration would succeed.
    const originalSetItem = localStorage.setItem.bind(localStorage);
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === toKey) {
        throw new Error('quota');
      }
      originalSetItem(key, value);
    });
    try {
      migrateLegacyChatOrderScope('meshcore', '7');
      expect(localStorage.getItem(fromKey)).toBe(JSON.stringify(['9', '8']));
      expect(localStorage.getItem(toKey)).toBeNull();
    } finally {
      setItem.mockRestore();
    }
  });
});
