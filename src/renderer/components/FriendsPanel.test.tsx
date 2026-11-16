import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage, MeshNode } from '@/renderer/lib/types';
import { resetFriendsStoreForTests, useFriendsStore } from '@/renderer/stores/friendsStore';
import { useWordFilterStore } from '@/renderer/stores/wordFilterStore';

import FriendsPanel from './FriendsPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

function msg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    sender_id: 10,
    sender_name: 'Friend',
    payload: 'hello spam',
    channel: -1,
    timestamp: Date.now(),
    to: 1,
    ...overrides,
  };
}

describe('FriendsPanel unread word filter', () => {
  beforeEach(() => {
    resetFriendsStoreForTests();
    useWordFilterStore.setState({
      enabled: false,
      words: [],
      disabledConversations: new Set(),
    });
    useFriendsStore.getState().addFriend('id-mt', 10);
  });

  it('updates unread when the word filter changes without new messages', () => {
    const nodes = new Map<number, MeshNode>([
      [
        10,
        {
          node_id: 10,
          long_name: 'Friend',
          short_name: 'Fr',
          hw_model: 'TBeam',
          snr: 0,
          battery: 0,
          last_heard: Date.now(),
          latitude: null,
          longitude: null,
        },
      ],
    ]);
    const messages = [msg()];
    const { rerender } = render(
      <FriendsPanel
        protocol="meshtastic"
        identityId="id-mt"
        nodes={nodes}
        messages={messages}
        ownNodeIds={new Set([1])}
        persistedLastRead={{}}
        onOpenDm={() => {}}
      />,
    );
    expect(screen.getByText('1')).toBeInTheDocument();

    act(() => {
      useWordFilterStore.getState().setEnabled(true);
      useWordFilterStore.getState().setWordsText('spam');
    });
    rerender(
      <FriendsPanel
        protocol="meshtastic"
        identityId="id-mt"
        nodes={nodes}
        messages={messages}
        ownNodeIds={new Set([1])}
        persistedLastRead={{}}
        onOpenDm={() => {}}
      />,
    );
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });
});
