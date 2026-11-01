import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OutboxEntry } from '@/shared/electron-api.types';

import { conversationPrefsStorageKey } from '../lib/conversationPinStorage';
import type { MeshProtocol } from '../lib/types';
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
    containerRef: { current: null },
    isAtEnd: () => true,
    scrollToEnd: vi.fn(),
    scrollToIndex: vi.fn(),
    scrollDirection: 'forward',
    shouldAdjustScrollPositionOnItemSizeChange: undefined,
  }),
}));

const HOUR = 60 * 60 * 1000;

function props(protocol: MeshProtocol): ChatPanelProps {
  return {
    protocol,
    messages: [],
    channels: [
      { index: 0, name: 'General' },
      { index: 1, name: 'Ops' },
      { index: 2, name: 'Alerts' },
    ],
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

function channelOrder(): string[] {
  return screen
    .getAllByRole('button', { pressed: undefined })
    .map((b) => b.getAttribute('aria-label'))
    .filter((l): l is string => l === 'General' || l === 'Ops' || l === 'Alerts');
}

function scheduledRow(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: 501,
    protocol: 'meshtastic',
    viewKey: 'ch:0',
    channel: 0,
    toNode: null,
    payload: 'send me later',
    replyId: null,
    status: 'queued',
    error: null,
    attemptCount: 0,
    nextRetryAt: Date.now() + 2 * HOUR,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    groupId: null,
    groupIndex: null,
    groupTotal: null,
    priority: 'normal',
    ...overrides,
  };
}

describe.each<MeshProtocol>(['meshtastic', 'meshcore', 'reticulum'])(
  'ChatPanel conversation pin/archive (%s)',
  (protocol) => {
    beforeEach(() => {
      localStorage.clear();
      vi.mocked(window.electronAPI.chat.outbox.list).mockResolvedValue([]);
    });

    it('pins a channel to the front and persists per protocol', async () => {
      const user = userEvent.setup();
      render(
        <ToastProvider>
          <ChatPanel {...props(protocol)} />
        </ToastProvider>,
      );
      expect(channelOrder()).toEqual(['General', 'Ops', 'Alerts']);
      await user.click(screen.getByRole('button', { name: 'Ops' }));
      await user.click(screen.getByRole('button', { name: 'Pin this conversation' }));
      await waitFor(() => {
        expect(channelOrder()).toEqual(['Ops', 'General', 'Alerts']);
      });
      expect(
        JSON.parse(localStorage.getItem(conversationPrefsStorageKey(protocol, null)) ?? '{}'),
      ).toEqual({ pinned: ['ch:1'], archived: [] });
      expect(screen.getByRole('button', { name: 'Unpin this conversation' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('archives a channel, hides it, and shows it again on demand', async () => {
      const user = userEvent.setup();
      render(
        <ToastProvider>
          <ChatPanel {...props(protocol)} />
        </ToastProvider>,
      );
      await user.click(screen.getByRole('button', { name: 'Alerts' }));
      await user.click(screen.getByRole('button', { name: 'Archive this conversation' }));
      // Open conversation stays visible so it can be unarchived.
      expect(channelOrder()).toContain('Alerts');
      await user.click(screen.getByRole('button', { name: 'General' }));
      await waitFor(() => {
        expect(channelOrder()).toEqual(['General', 'Ops']);
      });
      await user.click(screen.getByRole('button', { name: 'Show archived conversations (1)' }));
      expect(channelOrder()).toEqual(['General', 'Ops', 'Alerts']);
      await user.click(screen.getByRole('button', { name: 'Hide archived conversations' }));
      expect(channelOrder()).toEqual(['General', 'Ops']);
      // Message starring storage is untouched.
      expect(localStorage.getItem(`mesh-client:starred:${protocol}`) ?? '[]').toBe('[]');
    });
  },
);

describe.each<MeshProtocol>(['meshtastic', 'meshcore', 'reticulum'])(
  'ChatPanel scheduled send (%s)',
  (protocol) => {
    beforeEach(() => {
      localStorage.clear();
      vi.mocked(window.electronAPI.chat.outbox.list).mockResolvedValue([]);
      vi.mocked(window.electronAPI.chat.outbox.add).mockReset();
      vi.mocked(window.electronAPI.chat.outbox.remove).mockReset().mockResolvedValue(undefined);
    });

    it('queues the draft in the durable outbox for the chosen time', async () => {
      const user = userEvent.setup();
      vi.mocked(window.electronAPI.chat.outbox.add).mockImplementation((entry) =>
        Promise.resolve({
          ...scheduledRow(),
          ...(entry as Partial<OutboxEntry>),
          protocol,
        } as OutboxEntry),
      );
      render(
        <ToastProvider>
          <ChatPanel {...props(protocol)} />
        </ToastProvider>,
      );
      expect(screen.getByRole('button', { name: 'Schedule send' })).toBeDisabled();
      const composer = (await screen.findAllByRole('textbox')).find(
        (el): el is HTMLTextAreaElement => el.tagName === 'TEXTAREA',
      );
      if (!composer) throw new Error('composer not found');
      await user.type(composer, 'remind the net');
      await user.click(screen.getByRole('button', { name: 'Schedule send' }));
      const dialog = await screen.findByRole('dialog', { name: 'Schedule message' });
      await user.click(within(dialog).getByRole('button', { name: 'Schedule' }));
      await waitFor(() => {
        expect(window.electronAPI.chat.outbox.add).toHaveBeenCalledTimes(1);
      });
      const entry = vi.mocked(window.electronAPI.chat.outbox.add).mock.calls[0][0];
      expect(entry).toMatchObject({
        protocol,
        viewKey: 'ch:0',
        payload: 'remind the net',
        status: 'queued',
      });
      expect(entry.nextRetryAt).toBeGreaterThan(Date.now() + HOUR / 2);
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Schedule message' })).toBeNull();
      });
      expect(composer).toHaveValue('');
    });

    it('shows a persisted scheduled row with edit / send now / cancel', async () => {
      const user = userEvent.setup();
      vi.mocked(window.electronAPI.chat.outbox.list).mockResolvedValue([
        scheduledRow({ protocol }),
      ]);
      render(
        <ToastProvider>
          <ChatPanel {...props(protocol)} />
        </ToastProvider>,
      );
      expect(await screen.findByText('send me later')).toBeInTheDocument();
      expect(screen.getByText(/^Scheduled for /)).toBeInTheDocument();
      expect(screen.queryByText(/Retrying in/)).toBeNull();
      expect(
        screen.getByRole('button', { name: 'Send scheduled message now' }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Edit scheduled message' }));
      const dialog = await screen.findByRole('dialog', { name: 'Edit scheduled message' });
      expect(within(dialog).getByRole('textbox', { name: 'Message' })).toHaveValue('send me later');
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Edit scheduled message' })).toBeNull();
      });

      await user.click(screen.getByRole('button', { name: 'Cancel outbox message' }));
      await waitFor(() => {
        expect(window.electronAPI.chat.outbox.remove).toHaveBeenCalledWith(501);
      });
    });
  },
);
