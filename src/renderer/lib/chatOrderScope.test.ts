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
    localStorage.setItem('mesh-client:chatOrder:meshcore:0:dms', JSON.stringify(['9', '8']));
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key) => {
      if (key.includes(':7:dms')) {
        throw new Error('quota');
      }
    });
    try {
      migrateLegacyChatOrderScope('meshcore', '7');
      expect(localStorage.getItem('mesh-client:chatOrder:meshcore:0:dms')).toBe(
        JSON.stringify(['9', '8']),
      );
    } finally {
      setItem.mockRestore();
    }
  });
});
