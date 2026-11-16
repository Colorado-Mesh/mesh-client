import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadStarred, saveStarred, type StarredMessage } from '../lib/chatPanelProtocolStorage';
import { updateStarred } from '../lib/starredMessageStore';
import type { ChatMessage, MeshProtocol } from '../lib/types';
import ChatPanel, { type ChatPanelProps } from './ChatPanel';
import { ToastProvider } from './Toast';

vi.mock('../lib/chatNotifications', () => ({
  playMessageNotification: vi.fn(),
  playMecpSiren: vi.fn(),
  playMecpEasAttention: vi.fn(),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({ index, key: index, start: index * 96 })),
    getTotalSize: () => opts.count * 96,
    measureElement: () => {},
    resizeItem: () => {},
    containerRef: { current: null },
    isAtEnd: () => true,
    scrollToEnd: vi.fn(),
    scrollToIndex: vi.fn(),
    scrollDirection: 'forward',
    shouldAdjustScrollPositionOnItemSizeChange: undefined,
  }),
}));

function props(protocol: MeshProtocol, messages: ChatMessage[]): ChatPanelProps {
  return {
    protocol,
    messages,
    channels: [{ index: 0, name: 'General' }],
    myNodeNum: 1,
    onSend: vi.fn().mockResolvedValue(undefined),
    onReact: vi.fn().mockResolvedValue(undefined),
    onResend: vi.fn(),
    onNodeClick: vi.fn(),
    isConnected: true,
    nodes: new Map(),
    isActive: true,
  };
}

function channelMessage(payload: string): ChatMessage {
  return {
    id: 7,
    sender_id: 22,
    sender_name: 'Bob',
    payload,
    channel: 0,
    timestamp: Date.now() - 60_000,
  };
}

/** A star written by another view (Rooms panel or inbox) while Chat stays mounted. */
const OTHER_STAR: StarredMessage = {
  starId: '1700000000000-17',
  timestamp: 1_700_000_000_000,
  payload: 'Other keeper',
  sender_name: 'Author',
  sender_id: 0x11,
  viewKey: 'room:8196',
  channel: 0,
  to: null,
  starredAt: 1_700_000_000_500,
};

const payloads = (protocol: MeshProtocol) => loadStarred(protocol).map((s) => s.payload);

/** The message stream stays mounted behind the Starred view with Tailwind `hidden`. */
const visible = (elements: HTMLElement[]) => elements.filter((el) => !el.closest('.hidden'));

// Reticulum chat is DM-only, so this channel-message case runs for the two channel protocols;
// Reticulum's Chat write path is covered by the DM fold test in ChatPanel.test.tsx.
describe.each<MeshProtocol>(['meshtastic', 'meshcore'])(
  'ChatPanel stars shared with other views (%s)',
  (protocol) => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('keeps a star saved while Chat was open when Chat unstars a message', async () => {
      const user = userEvent.setup();
      render(
        <ToastProvider>
          <ChatPanel {...props(protocol, [channelMessage('Channel keeper')])} />
        </ToastProvider>,
      );

      await user.click(screen.getByRole('button', { name: 'Star message' }));
      expect(payloads(protocol)).toEqual(['Channel keeper']);

      saveStarred(protocol, [...loadStarred(protocol), OTHER_STAR]);

      await user.click(screen.getByRole('button', { name: 'Unstar message' }));
      expect(payloads(protocol)).toEqual(['Other keeper']);
    });

    it('lists a star another view saved and unstars from the Starred list', async () => {
      const user = userEvent.setup();
      render(
        <ToastProvider>
          <ChatPanel {...props(protocol, [channelMessage('Channel keeper')])} />
        </ToastProvider>,
      );
      await user.click(screen.getByRole('button', { name: 'Star message' }));
      act(() => {
        updateStarred(protocol, (prev) => [...prev, OTHER_STAR]);
      });

      await user.click(screen.getByRole('button', { name: 'Starred messages' }));
      expect(visible(screen.queryAllByText('Other keeper'))).toHaveLength(1);
      expect(visible(screen.queryAllByText('Channel keeper'))).toHaveLength(1);
      // Only the Starred list's buttons are visible; newest first, so the channel star leads.
      const listUnstar = visible(screen.getAllByRole('button', { name: 'Unstar message' }));
      expect(listUnstar).toHaveLength(2);
      await user.click(listUnstar[0]);

      expect(payloads(protocol)).toEqual(['Other keeper']);
      expect(visible(screen.queryAllByText('Channel keeper'))).toHaveLength(0);
      expect(visible(screen.queryAllByText('Other keeper'))).toHaveLength(1);
    });
  },
);

describe('ChatPanel stars across a protocol switch', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows each protocol its own stars and writes only that protocol', async () => {
    const user = userEvent.setup();
    const message = channelMessage('Shared text');
    saveStarred('meshtastic', [
      { ...OTHER_STAR, starId: '7', payload: 'Shared text', viewKey: 'ch:0', sender_id: 22 },
    ]);
    const view = render(
      <ToastProvider>
        <ChatPanel {...props('meshtastic', [message])} />
      </ToastProvider>,
    );
    expect(screen.getByRole('button', { name: 'Unstar message' })).toBeInTheDocument();

    view.rerender(
      <ToastProvider>
        <ChatPanel {...props('meshcore', [message])} />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Star message' }));

    expect(loadStarred('meshcore').map((s) => s.starId)).toEqual(['7']);
    expect(loadStarred('meshtastic').map((s) => s.starId)).toEqual(['7']);
    expect(screen.getByRole('button', { name: 'Unstar message' })).toBeInTheDocument();

    view.rerender(
      <ToastProvider>
        <ChatPanel {...props('meshtastic', [message])} />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Unstar message' }));
    expect(loadStarred('meshtastic')).toEqual([]);
    expect(loadStarred('meshcore').map((s) => s.starId)).toEqual(['7']);
  });
});
