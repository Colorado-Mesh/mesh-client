import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadStarred } from './chatPanelProtocolStorage';
import type { ChatMessage } from './types';
import { buildUnifiedInboxItems } from './unifiedInbox';
import { starInboxItems, STARRED_EXTERNAL_EVENT } from './unifiedInboxActions';

function msg(id: number, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    sender_id: 10,
    sender_name: 'Alpha',
    payload: `m${id}`,
    channel: 1,
    timestamp: id,
    ...over,
  };
}

describe('starInboxItems', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('writes per-protocol starred documents, dedupes, and notifies ChatPanel', () => {
    const items = buildUnifiedInboxItems({
      enabledProtocols: ['meshtastic', 'meshcore'],
      messagesByProtocol: {
        meshtastic: [msg(1), msg(2, { to: 9 })],
        meshcore: [msg(3)],
        reticulum: [],
      },
    });
    const events: string[] = [];
    const onEvent = (e: Event) =>
      events.push((e as CustomEvent<{ protocol: string }>).detail.protocol);
    window.addEventListener(STARRED_EXTERNAL_EVENT, onEvent);

    expect(starInboxItems(items, 5000)).toBe(3);
    expect(
      loadStarred('meshtastic')
        .map((s) => s.starId)
        .sort(),
    ).toEqual(['1', '2']);
    expect(loadStarred('meshcore')).toHaveLength(1);
    const dm = loadStarred('meshtastic').find((s) => s.starId === '2');
    expect(dm).toMatchObject({ viewKey: 'dm:10', to: 9, starredAt: 5000 });
    expect(events.sort()).toEqual(['meshcore', 'meshtastic']);

    events.length = 0;
    expect(starInboxItems(items)).toBe(0);
    expect(events).toEqual([]);
    window.removeEventListener(STARRED_EXTERNAL_EVENT, onEvent);
  });

  it('keeps pre-existing stars', () => {
    localStorage.setItem(
      'mesh-client:starred:meshtastic',
      JSON.stringify([
        {
          starId: '99',
          timestamp: 1,
          payload: 'x',
          sender_name: 'Z',
          sender_id: 1,
          viewKey: 'ch:0',
          channel: 0,
          to: null,
          starredAt: 1,
        },
      ]),
    );
    const items = buildUnifiedInboxItems({
      enabledProtocols: ['meshtastic'],
      messagesByProtocol: { meshtastic: [msg(1)], meshcore: [], reticulum: [] },
    });
    vi.spyOn(window, 'dispatchEvent');
    expect(starInboxItems(items)).toBe(1);
    expect(loadStarred('meshtastic').map((s) => s.starId)).toEqual(['99', '1']);
  });
});
