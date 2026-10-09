import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type { OutboxEntry } from '@/shared/electron-api.types';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import {
  autoResendKey,
  resetAutoResendForTests,
  useAutoResendStore,
} from '../lib/autoResend/autoResendController';
import {
  resetChatOutboxDrainLocksForTests,
  resetOutboxRowSendStateForTests,
} from '../lib/chatOutboxDrain';
import { activeDmStorageKey, openDmTabsStorageKey } from '../lib/chatPanelProtocolStorage';
import { resetMeshtasticTextSendPacingForTests } from '../lib/meshtasticTextSendPacing';
import { addMessage, useMessageStore } from '../stores/messageStore';
import ChatPanel from './ChatPanel';
import { ToastProvider } from './Toast';

const IDENTITY = 'retry-status-test-id';

vi.mock('../lib/identityByProtocol', () => ({
  getIdentityIdForProtocol: () => IDENTITY,
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({
        index,
        key: index,
        start: index * 96,
      })),
    getTotalSize: () => opts.count * 96,
    measureElement: () => {},
    isAtEnd: () => true,
    scrollToEnd: () => {},
    scrollToIndex: () => {},
    scrollDirection: 'forward',
  }),
}));

function baseProps() {
  return {
    channels: [{ index: 0, name: 'General' }],
    myNodeNum: 7,
    onReact: vi.fn().mockResolvedValue(undefined),
    onResend: vi.fn(),
    onNodeClick: vi.fn(),
    nodes: new Map(),
    isActive: true,
    protocol: 'meshtastic' as const,
    identityId: IDENTITY,
  };
}

function emergencyRow(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: 501,
    protocol: 'meshtastic',
    viewKey: 'ch:0',
    channel: 0,
    toNode: null,
    payload: 'MECP/0/M01',
    replyId: null,
    status: 'queued',
    error: null,
    attemptCount: 0,
    nextRetryAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    groupId: null,
    groupIndex: null,
    groupTotal: null,
    priority: 'emergency',
    ...overrides,
  };
}

describe('ChatPanel retry status controls', () => {
  const mockOutbox = window.electronAPI.chat.outbox;

  beforeEach(() => {
    resetAutoResendForTests();
    resetChatOutboxDrainLocksForTests();
    resetOutboxRowSendStateForTests();
    resetMeshtasticTextSendPacingForTests();
    useMessageStore.setState({ messages: {} });
    vi.mocked(mockOutbox.list).mockResolvedValue([]);
    vi.mocked(mockOutbox.updateStatus).mockResolvedValue(undefined);
    vi.mocked(mockOutbox.remove).mockClear();
    vi.mocked(mockOutbox.remove).mockResolvedValue(undefined);
    for (const protocol of ['meshtastic', 'meshcore', 'reticulum'] as const) {
      localStorage.removeItem(openDmTabsStorageKey(protocol));
      localStorage.removeItem(activeDmStorageKey(protocol));
    }
  });

  afterEach(() => {
    resetAutoResendForTests();
    resetOutboxRowSendStateForTests();
    vi.restoreAllMocks();
  });

  it('shows the auto-resend countdown with Cancel retry on a failed bubble', async () => {
    const user = userEvent.setup();
    useAutoResendStore.setState({
      entries: {
        [autoResendKey('meshtastic', '42')]: {
          identityId: IDENTITY,
          protocol: 'meshtastic',
          messageId: '42',
          attempt: 1,
          nextAt: Date.now() + 15_000,
        },
      },
    });
    const { container } = render(
      <ToastProvider>
        <ChatPanel
          {...baseProps()}
          messages={[
            {
              id: 42,
              packetId: 42,
              storeId: '42',
              sender_id: 7,
              sender_name: 'Me',
              payload: 'retry me',
              channel: 0,
              timestamp: Date.now(),
              status: 'failed',
            },
          ]}
          onSend={vi.fn()}
          isConnected
        />
      </ToastProvider>,
    );
    expect(await screen.findByText(/Retrying \(1\/3\) in 0:1\d/)).toBeInTheDocument();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
    await user.click(
      screen.getByRole('button', { name: 'Cancel automatic retry of this message' }),
    );
    expect(useAutoResendStore.getState().entries).toEqual({});
    expect(screen.queryByText(/Retrying \(1\/3\)/)).not.toBeInTheDocument();
  });

  it('shows awaiting-ACK status and Stop retrying for an in-flight emergency row', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(mockOutbox.list).mockResolvedValue([emergencyRow()]);
    const onSend = vi.fn(() => {
      addMessage(IDENTITY, {
        id: '9001',
        from: 7,
        to: 0xffffffff,
        payload: 'MECP/0/M01',
        channelIndex: 0,
        timestamp: Date.now(),
        status: 'sending',
      });
      return Promise.resolve('9001');
    });
    const { container } = render(
      <ToastProvider>
        <ChatPanel {...baseProps()} messages={[]} onSend={onSend} isConnected />
      </ToastProvider>,
    );
    expect(await screen.findByText('Waiting for network acknowledgement…')).toBeInTheDocument();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: /stop retrying/i }));
    await waitFor(() => {
      expect(mockOutbox.remove).toHaveBeenCalledWith(501);
    });
    expect(screen.queryByText('Waiting for network acknowledgement…')).not.toBeInTheDocument();
    expect(mockOutbox.updateStatus).not.toHaveBeenCalledWith(
      501,
      'failed',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });
});
