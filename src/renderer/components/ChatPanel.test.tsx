import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import * as chatNotifications from '../lib/chatNotifications';
import { draftsStorageKey, saveDraft } from '../lib/chatPanelProtocolStorage';
import type { ChatMessage, MeshNode } from '../lib/types';
import ChatPanel, { getDistFromChatBottom } from './ChatPanel';
import { ToastProvider } from './Toast';

vi.mock('../lib/chatNotifications', () => ({ playMessageNotification: vi.fn() }));

beforeEach(() => {
  localStorage.clear();
});

describe('ChatPanel accessibility', () => {
  const defaultProps = {
    messages: [],
    channels: [{ index: 0, name: 'General' }],
    myNodeNum: 0,
    onSend: vi.fn().mockResolvedValue(undefined),
    onReact: vi.fn().mockResolvedValue(undefined),
    onResend: vi.fn(),
    onNodeClick: vi.fn(),
    isConnected: false,
    nodes: new Map(),
    isActive: true,
  };

  it('has no axe violations with empty messages', async () => {
    const { container } = render(
      <ToastProvider>
        <ChatPanel {...defaultProps} />
      </ToastProvider>,
    );
    await screen.findByPlaceholderText('Connect to send messages');
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('does not render the top-right globe global-search button', () => {
    render(
      <ToastProvider>
        <ChatPanel {...defaultProps} />
      </ToastProvider>,
    );
    expect(screen.queryByLabelText('Search all channels')).not.toBeInTheDocument();
  });

  it('emoji picker opens for the correct message when messages have no packetId', async () => {
    // Messages without packetId must use timestamp as picker key so re-renders
    // don't shift the picker to a different message (regression: was using -(i+1)).
    const now = Date.now();
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          isConnected
          myNodeNum={999}
          messages={[
            {
              sender_id: 1,
              sender_name: 'A',
              payload: 'first',
              channel: 0,
              timestamp: now - 2000,
              status: 'acked',
            },
            {
              sender_id: 1,
              sender_name: 'A',
              payload: 'second',
              channel: 0,
              timestamp: now - 1000,
              status: 'acked',
            },
          ]}
        />
      </ToastProvider>,
    );
    // Open picker for the second message (Linux default mock → emoji-picker-element)
    const reactButtons = screen.getAllByTitle('React');
    await user.click(reactButtons[1]);
    await waitFor(() => {
      expect(document.querySelector('emoji-picker')).toBeInTheDocument();
    });
  });

  it('displays full hex ID for stub nodes with no short_name', () => {
    // Regression: stub nodes (chat-only, no NodeInfo) were shown with only
    // the last 4 hex chars of their ID (e.g. "4697") instead of the full
    // "!be1f4697". This happened because short_name was set to hex.slice(-4)
    // and ChatPanel preferred short_name over long_name.
    const stubId = 0xbe1f4697;
    const stubNode: MeshNode = {
      node_id: stubId,
      long_name: '!be1f4697',
      short_name: '',
      hw_model: '',
      snr: 0,
      battery: 0,
      last_heard: Date.now(),
      latitude: null,
      longitude: null,
    };
    render(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          myNodeNum={1}
          nodes={new Map([[stubId, stubNode]])}
          messages={[
            {
              sender_id: stubId,
              sender_name: '!be1f4697',
              payload: 'Hello',
              channel: 0,
              timestamp: Date.now(),
              status: 'acked',
            },
          ]}
        />
      </ToastProvider>,
    );
    expect(screen.getByText('!be1f4697')).toBeInTheDocument();
    // The 4-char suffix should not appear as a standalone sender label
    expect(screen.queryByText('4697')).not.toBeInTheDocument();
  });

  it('shows RF transport badge for incoming messages with receivedVia rf', () => {
    render(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          myNodeNum={1}
          messages={[
            {
              sender_id: 2,
              sender_name: 'Other',
              payload: 'Hello',
              channel: 0,
              timestamp: Date.now(),
              status: 'acked',
              receivedVia: 'rf',
            },
          ]}
        />
      </ToastProvider>,
    );
    expect(screen.getByTitle('Received via RF')).toBeInTheDocument();
  });

  it('shows Store & Forward badge alongside RF transport badge', () => {
    render(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          myNodeNum={1}
          messages={[
            {
              sender_id: 2,
              sender_name: 'Other',
              payload: 'Cached hello',
              channel: 0,
              timestamp: Date.now(),
              receivedVia: 'rf',
              viaStoreForward: true,
            },
          ]}
        />
      </ToastProvider>,
    );
    expect(screen.getByTitle('Replayed from Store & Forward')).toBeInTheDocument();
    expect(screen.getByTitle('Received via RF')).toBeInTheDocument();
  });

  it('shows RF transport badge in MeshCore mode', () => {
    render(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          protocol="meshcore"
          myNodeNum={1}
          messages={[
            {
              sender_id: 2,
              sender_name: 'Other',
              payload: 'Hello',
              channel: 0,
              timestamp: Date.now(),
              status: 'acked',
              receivedVia: 'rf',
            },
          ]}
        />
      </ToastProvider>,
    );
    expect(screen.queryByTitle('Received via RF')).toBeInTheDocument();
  });

  it('still shows MQTT transport badge in MeshCore mode when receivedVia is mqtt', () => {
    render(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          protocol="meshcore"
          myNodeNum={1}
          messages={[
            {
              sender_id: 2,
              sender_name: 'Other',
              payload: 'Hello',
              channel: 0,
              timestamp: Date.now(),
              status: 'acked',
              receivedVia: 'mqtt',
            },
          ]}
        />
      </ToastProvider>,
    );
    expect(screen.getByTitle('Received via MQTT')).toBeInTheDocument();
  });

  it('surfaces incoming DM conversations and renders them in DM view', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          protocol="meshtastic"
          isConnected
          myNodeNum={1}
          messages={[
            {
              sender_id: 2,
              sender_name: 'Alice',
              payload: 'Private hello',
              channel: -1,
              timestamp: Date.now(),
              status: 'acked',
              to: 1,
            },
          ]}
          nodes={
            new Map([
              [
                2,
                {
                  node_id: 2,
                  long_name: 'Alice',
                  short_name: '',
                  hw_model: '',
                  snr: 0,
                  battery: 0,
                  last_heard: Date.now(),
                  latitude: null,
                  longitude: null,
                },
              ],
            ])
          }
        />
      </ToastProvider>,
    );

    expect(screen.queryByText('Private hello')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Alice' }));
    await waitFor(() => {
      expect(screen.getByText('Private hello')).toBeInTheDocument();
    });
  });

  it('shows close button for inferred DM tabs in Meshtastic', () => {
    render(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          protocol="meshtastic"
          isConnected
          myNodeNum={1}
          nodes={
            new Map([
              [
                2,
                {
                  node_id: 2,
                  long_name: 'Alice',
                  short_name: 'Alice',
                  hw_model: '',
                  snr: 0,
                  battery: 0,
                  last_heard: Date.now(),
                  latitude: null,
                  longitude: null,
                },
              ],
            ])
          }
          messages={[
            {
              sender_id: 2,
              sender_name: 'Alice',
              payload: 'Private hello',
              channel: -1,
              timestamp: Date.now(),
              status: 'acked',
              to: 1,
            },
          ]}
        />
      </ToastProvider>,
    );

    expect(screen.getByTitle('Close DM')).toBeInTheDocument();
  });

  it('does not infer a DM tab for Meshtastic broadcast (!ffffffff)', () => {
    render(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          protocol="meshtastic"
          isConnected
          myNodeNum={1}
          messages={[
            {
              sender_id: 1,
              sender_name: 'Me',
              payload: 'history request',
              channel: 0,
              timestamp: Date.now(),
              to: 0xffffffff,
            },
          ]}
        />
      </ToastProvider>,
    );

    expect(screen.queryByText('!ffffffff')).not.toBeInTheDocument();
    expect(screen.getByText('No conversations')).toBeInTheDocument();
  });

  it('allows closing inferred DM tab and resurfaces on subsequent message (even if timestamp is stale)', async () => {
    const user = userEvent.setup();
    const firstTs = Date.now();
    const { rerender } = render(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          protocol="meshtastic"
          isConnected
          myNodeNum={1}
          nodes={
            new Map([
              [
                2,
                {
                  node_id: 2,
                  long_name: 'Alice',
                  short_name: 'Alice',
                  hw_model: '',
                  snr: 0,
                  battery: 0,
                  last_heard: Date.now(),
                  latitude: null,
                  longitude: null,
                },
              ],
            ])
          }
          messages={[
            {
              sender_id: 2,
              sender_name: 'Alice',
              payload: 'First DM',
              channel: -1,
              timestamp: firstTs,
              status: 'acked',
              to: 1,
            },
          ]}
        />
      </ToastProvider>,
    );

    expect(screen.getByRole('button', { name: 'Alice' })).toBeInTheDocument();
    await user.click(screen.getByTitle('Close DM'));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Alice' })).not.toBeInTheDocument();
    });

    rerender(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          isConnected
          myNodeNum={1}
          nodes={
            new Map([
              [
                2,
                {
                  node_id: 2,
                  long_name: 'Alice',
                  short_name: 'Alice',
                  hw_model: '',
                  snr: 0,
                  battery: 0,
                  last_heard: Date.now(),
                  latitude: null,
                  longitude: null,
                },
              ],
            ])
          }
          messages={[
            {
              sender_id: 2,
              sender_name: 'Alice',
              payload: 'First DM',
              channel: -1,
              timestamp: firstTs,
              status: 'acked',
              to: 1,
            },
            {
              sender_id: 2,
              sender_name: 'Alice',
              payload: 'Second DM',
              channel: -1,
              // Must resurface even if timestamp is not newer (regression: older/stale timestamps
              // can happen across transports/hydration).
              timestamp: firstTs,
              status: 'acked',
              to: 1,
            },
          ]}
        />
      </ToastProvider>,
    );

    expect(screen.getByRole('button', { name: 'Alice' })).toBeInTheDocument();
  });

  it('shows close button for inferred DM tabs in MeshCore', () => {
    render(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          protocol="meshcore"
          isConnected
          myNodeNum={1}
          nodes={
            new Map([
              [
                2,
                {
                  node_id: 2,
                  long_name: 'Alice',
                  short_name: 'Alice',
                  hw_model: '',
                  snr: 0,
                  battery: 0,
                  last_heard: Date.now(),
                  latitude: null,
                  longitude: null,
                },
              ],
            ])
          }
          messages={[
            {
              sender_id: 2,
              sender_name: 'Alice',
              payload: 'Private hello',
              channel: -1,
              timestamp: Date.now(),
              status: 'acked',
              to: 1,
            },
          ]}
        />
      </ToastProvider>,
    );

    expect(screen.getByTitle('Close DM')).toBeInTheDocument();
  });

  it('allows closing inferred DM tab in MeshCore and does not resurface without new messages', async () => {
    const user = userEvent.setup();
    const ts = Date.now();
    const messages = [
      {
        sender_id: 2,
        sender_name: 'Alice',
        payload: 'Private hello',
        channel: -1,
        timestamp: ts,
        status: 'acked' as const,
        to: 1,
      },
    ];
    const nodes = new Map([
      [
        2,
        {
          node_id: 2,
          long_name: 'Alice',
          short_name: 'Alice',
          hw_model: '',
          snr: 0,
          battery: 0,
          last_heard: Date.now(),
          latitude: null,
          longitude: null,
        },
      ],
    ]);
    const { rerender } = render(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          protocol="meshcore"
          isConnected
          myNodeNum={1}
          nodes={nodes}
          messages={messages}
        />
      </ToastProvider>,
    );

    expect(screen.getByRole('button', { name: 'Alice' })).toBeInTheDocument();
    await user.click(screen.getByTitle('Close DM'));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Alice' })).not.toBeInTheDocument();
    });

    // Re-render with same messages — tab should stay dismissed
    rerender(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          protocol="meshcore"
          isConnected
          myNodeNum={1}
          nodes={nodes}
          messages={messages}
        />
      </ToastProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Alice' })).not.toBeInTheDocument();
  });

  it('shows Jump to Latest when content overflows without manual scroll event', async () => {
    const baseTs = Date.now() - 50_000;
    const longMessages = Array.from({ length: 30 }, (_, idx) => ({
      sender_id: idx % 2 === 0 ? 2 : 1,
      sender_name: idx % 2 === 0 ? 'Alice' : 'Me',
      payload: `message ${idx} `.repeat(20),
      channel: 0,
      timestamp: baseTs + idx * 1000,
      status: 'acked' as const,
    }));

    const { container } = render(
      <ToastProvider>
        <ChatPanel {...defaultProps} isConnected myNodeNum={1} messages={longMessages} />
      </ToastProvider>,
    );

    const scrollContainer = container.querySelector('div.overflow-y-auto')!;
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(scrollContainer, 'scrollTop', {
      value: 0,
      writable: true,
      configurable: true,
    });

    // The useLayoutEffect RAF already fired during render() before mock properties were
    // set. Fire a scroll event so handleScroll re-evaluates with the mocked dimensions.
    fireEvent.scroll(scrollContainer);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Jump to Latest' })).toBeInTheDocument();
    });
  });

  it('shows Jump to Latest when slightly scrolled from bottom', async () => {
    const baseTs = Date.now() - 50_000;
    const longMessages = Array.from({ length: 30 }, (_, idx) => ({
      sender_id: idx % 2 === 0 ? 2 : 1,
      sender_name: idx % 2 === 0 ? 'Alice' : 'Me',
      payload: `message ${idx} `.repeat(20),
      channel: 0,
      timestamp: baseTs + idx * 1000,
      status: 'acked' as const,
    }));

    const { container } = render(
      <ToastProvider>
        <ChatPanel {...defaultProps} isConnected myNodeNum={1} messages={longMessages} />
      </ToastProvider>,
    );

    const scrollContainer = container.querySelector('div.overflow-y-auto')!;
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 400, configurable: true });
    // distFromBottom = 300 → showScrollButton on (>200), label should be "Jump to Latest" (no divider)
    Object.defineProperty(scrollContainer, 'scrollTop', {
      value: 1300,
      writable: true,
      configurable: true,
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Jump to Latest' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Jump to Unread' })).not.toBeInTheDocument();
  });

  it('shows role="alert" when onSend rejects', async () => {
    const user = userEvent.setup();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onSend = vi.fn().mockRejectedValue(new Error('send failed'));
    render(
      <ToastProvider>
        <ChatPanel {...defaultProps} isConnected onSend={onSend} />
      </ToastProvider>,
    );
    const input = screen.getByPlaceholderText('Enter message here');
    await user.type(input, 'hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('send failed');
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[ChatPanel\].*send failed/s),
    );
    consoleErrorSpy.mockRestore();
  });
});

describe('ChatPanel compact mode', () => {
  const defaultProps = {
    messages: [] as ChatMessage[],
    channels: [{ index: 0, name: 'General' }],
    myNodeNum: 1,
    onSend: vi.fn().mockResolvedValue(undefined),
    onReact: vi.fn().mockResolvedValue(undefined),
    onResend: vi.fn(),
    onNodeClick: vi.fn(),
    isConnected: true,
    nodes: new Map(),
    isActive: true,
    compactMode: true,
  };

  it('merges consecutive same-sender channel bubbles and shows only one sender header', () => {
    const base = new Date('2026-05-09T12:00:00').getTime();
    render(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          messages={[
            {
              sender_id: 2,
              sender_name: 'JCR2',
              payload: 'Painting the front door',
              channel: 0,
              timestamp: base,
              status: 'acked',
            },
            {
              sender_id: 2,
              sender_name: 'JCR2',
              payload: 'Test 123',
              channel: 0,
              timestamp: base + 10 * 60 * 1000,
              status: 'acked',
            },
          ]}
        />
      </ToastProvider>,
    );

    expect(screen.getAllByRole('button', { name: 'JCR2' })).toHaveLength(1);
    expect(screen.getByText('Painting the front door')).toBeInTheDocument();
    expect(screen.getByText('Test 123')).toBeInTheDocument();
  });

  it('renders compact continuation segment with flush top border so bubbles visually merge', () => {
    const base = new Date('2026-05-09T12:00:00').getTime();
    render(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          messages={[
            {
              sender_id: 2,
              sender_name: 'JCR2',
              payload: 'first line',
              channel: 0,
              timestamp: base,
              status: 'acked',
            },
            {
              sender_id: 2,
              sender_name: 'JCR2',
              payload: 'second line',
              channel: 0,
              timestamp: base + 60_000,
              status: 'acked',
            },
          ]}
        />
      </ToastProvider>,
    );

    const firstBubble = screen.getByText('first line').closest('.rounded-b-none');
    const secondBubble = screen.getByText('second line').closest('.rounded-t-none');
    expect(firstBubble).not.toBeNull();
    expect(secondBubble).not.toBeNull();
    expect(firstBubble).toHaveClass('border-b-0');
    expect(secondBubble).toHaveClass('border-t-0');
  });
});

describe('getDistFromChatBottom', () => {
  it('uses inner scroller when it overflows', () => {
    const inner = document.createElement('div');
    Object.defineProperty(inner, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(inner, 'clientHeight', { value: 100, configurable: true });
    inner.scrollTop = 50;
    expect(getDistFromChatBottom(inner, null, null)).toBe(350);
  });

  it('uses max of inner and sentinel when inner is at bottom but end is below outer root', () => {
    const inner = document.createElement('div');
    Object.defineProperty(inner, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(inner, 'clientHeight', { value: 100, configurable: true });
    inner.scrollTop = 400;

    const root = document.createElement('div');
    const end = document.createElement('div');
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(end, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      left: 0,
      right: 400,
      bottom: 680,
      width: 400,
      height: 580,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    expect(getDistFromChatBottom(inner, end, root)).toBe(80);
  });

  it('uses message end vs outer root when inner does not overflow', () => {
    const inner = document.createElement('div');
    Object.defineProperty(inner, 'scrollHeight', { value: 400, configurable: true });
    Object.defineProperty(inner, 'clientHeight', { value: 400, configurable: true });

    const root = document.createElement('div');
    const end = document.createElement('div');
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(end, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      left: 0,
      right: 400,
      bottom: 750,
      width: 400,
      height: 650,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    expect(getDistFromChatBottom(inner, end, root)).toBe(150);
  });
});

describe('ChatPanel StatusBadge', () => {
  const baseProps = {
    messages: [],
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

  const failedMsg = {
    sender_id: 1,
    sender_name: 'Me',
    payload: 'Hello',
    channel: 0,
    timestamp: Date.now(),
    status: 'failed' as const,
  };

  it('renders "USB no ACK" with a space (not "USBno ACK") for serial failed messages', () => {
    render(
      <ToastProvider>
        <ChatPanel {...baseProps} connectionType="serial" messages={[failedMsg]} />
      </ToastProvider>,
    );
    expect(screen.getByText('USB no ACK')).toBeInTheDocument();
    expect(screen.queryByText('USBno ACK')).not.toBeInTheDocument();
  });

  it('passes full message to onResend so App can forward replyId', async () => {
    const user = userEvent.setup();
    const onResend = vi.fn();
    const failedWithReply = {
      ...failedMsg,
      replyId: 4242,
      packetId: 99,
    };
    render(
      <ToastProvider>
        <ChatPanel {...baseProps} onResend={onResend} messages={[failedWithReply]} />
      </ToastProvider>,
    );
    await user.click(screen.getByTitle('Resend message'));
    expect(onResend).toHaveBeenCalledTimes(1);
    expect(onResend.mock.calls[0][0]).toMatchObject({
      payload: 'Hello',
      replyId: 4242,
      channel: 0,
    });
  });

  it('renders "BT ✓" with a space for BLE acked messages', () => {
    render(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          connectionType="ble"
          messages={[{ ...failedMsg, status: 'acked' }]}
        />
      </ToastProvider>,
    );
    expect(screen.getByText('BT ✓')).toBeInTheDocument();
  });

  it('shows per-reactor tap-back labels; hides own name on others’ messages', () => {
    const t0 = Date.now() - 10_000;
    const t1 = t0 + 1000;
    const t2 = t0 + 2000;
    render(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          myNodeNum={99}
          messages={[
            {
              sender_id: 2,
              sender_name: 'Alice',
              payload: 'hi',
              channel: 0,
              timestamp: t0,
              packetId: 100,
              status: 'acked',
            },
            {
              sender_id: 3,
              sender_name: 'Bob',
              payload: '👍',
              channel: 0,
              timestamp: t1,
              emoji: 0x1f44d,
              replyId: 100,
              status: 'acked',
            },
            {
              sender_id: 99,
              sender_name: 'Me',
              payload: '❤️',
              channel: 0,
              timestamp: t2,
              emoji: 0x2764,
              replyId: 100,
              status: 'acked',
            },
          ]}
        />
      </ToastProvider>,
    );
    expect(screen.getByLabelText(/Bob reacted with Like/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Your reaction: Love/i)).toBeInTheDocument();
  });

  it('renders US flag tapback from full payload when stored scalar is first regional indicator only', () => {
    const US_FLAG = '\u{1F1FA}\u{1F1F8}';
    const t0 = Date.now() - 10_000;
    const t1 = t0 + 1000;
    render(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          messages={[
            {
              sender_id: 2,
              sender_name: 'Alice',
              payload: 'hello',
              channel: 0,
              timestamp: t0,
              packetId: 200,
              status: 'acked',
            },
            {
              sender_id: 3,
              sender_name: 'Bob',
              payload: US_FLAG,
              channel: 0,
              timestamp: t1,
              emoji: 0x1f1fa,
              replyId: 200,
              status: 'acked',
            },
          ]}
        />
      </ToastProvider>,
    );
    const badge = screen.getByLabelText(`Bob reacted with ${US_FLAG}`);
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain(US_FLAG);
  });

  it('renders quoted reply control with jump label for Meshtastic-style replyId', () => {
    const t0 = Date.now() - 5000;
    const t1 = t0 + 1000;
    render(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          messages={[
            {
              sender_id: 2,
              sender_name: 'Alice',
              payload: 'original',
              channel: 0,
              timestamp: t0,
              packetId: 77,
              status: 'acked',
            },
            {
              sender_id: 3,
              sender_name: 'Bob',
              payload: 'reply text',
              channel: 0,
              timestamp: t1,
              replyId: 77,
              status: 'acked',
            },
          ]}
        />
      </ToastProvider>,
    );
    expect(
      screen.getByRole('button', { name: /Jump to quoted message from Alice/i }),
    ).toBeInTheDocument();
  });

  it('renders quoted preview from stored replyPreview fields when parent is not in messages', () => {
    render(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          messages={[
            {
              sender_id: 3,
              sender_name: 'Bob',
              payload: 'reply text',
              channel: 0,
              timestamp: Date.now(),
              replyId: 424242,
              replyPreviewText: 'Saved parent snippet',
              replyPreviewSender: 'Alice',
              status: 'acked',
            },
          ]}
        />
      </ToastProvider>,
    );
    expect(
      screen.getByRole('button', { name: /Jump to quoted message from Alice/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Saved parent snippet')).toBeInTheDocument();
  });

  it('shows tooltip on hover and does not use a native title attribute', async () => {
    // Regression: StatusBadge previously used `title` which is silently dropped
    // in Electron. It must use HelpTooltip so the tooltip mounts in the DOM.
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ChatPanel {...baseProps} connectionType="serial" messages={[failedMsg]} />
      </ToastProvider>,
    );
    const badge = screen.getByText('USB no ACK').closest('.cursor-help')!;
    expect(badge.getAttribute('title')).toBeNull();
    await user.hover(badge);
    const tooltip = document.querySelector('.pointer-events-none');
    expect(tooltip?.textContent?.trim()).toBeTruthy();
  });
});

describe('ChatPanel unread watermarks', () => {
  const baseProps = {
    messages: [],
    channels: [
      { index: 0, name: 'General' },
      { index: 1, name: 'Ops' },
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

  it('clears a non-primary channel badge after that channel is viewed', async () => {
    const user = userEvent.setup();
    const ts = Date.now();
    render(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          messages={[
            {
              sender_id: 2,
              sender_name: 'Alice',
              payload: 'Ops ping',
              channel: 1,
              timestamp: ts,
              status: 'acked',
            },
          ]}
        />
      </ToastProvider>,
    );

    expect(screen.getByRole('button', { name: 'Ops 1' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ops 1' }));
    await user.click(screen.getByRole('button', { name: 'General' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Ops' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Ops 1' })).not.toBeInTheDocument();
    });
  });

  it('keeps a read channel cleared when delayed history rows are merged later', async () => {
    const user = userEvent.setup();
    const ts = Date.now();
    const { rerender } = render(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          messages={[
            {
              sender_id: 2,
              sender_name: 'Alice',
              payload: 'Ops ping',
              channel: 1,
              timestamp: ts,
              status: 'acked',
            },
          ]}
        />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Ops 1' }));
    await user.click(screen.getByRole('button', { name: 'General' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Ops 1' })).not.toBeInTheDocument();
    });

    rerender(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          messages={[
            {
              sender_id: 2,
              sender_name: 'Alice',
              payload: 'Ops ping',
              channel: 1,
              timestamp: ts,
              status: 'acked',
            },
            {
              sender_id: 2,
              sender_name: 'Alice',
              payload: 'Delayed history replay',
              channel: 1,
              timestamp: ts + 60_000,
              status: 'acked',
              isHistory: true,
            },
          ]}
        />
      </ToastProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Ops' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Ops 1' })).not.toBeInTheDocument();
  });

  it('clears future-dated channel messages once that channel is read', async () => {
    const user = userEvent.setup();
    const futureTs = Date.now() + 300_000;
    render(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          messages={[
            {
              sender_id: 2,
              sender_name: 'Alice',
              payload: 'Clock skewed future message',
              channel: 1,
              timestamp: futureTs,
              status: 'acked',
            },
          ]}
        />
      </ToastProvider>,
    );

    expect(screen.getByRole('button', { name: 'Ops 1' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ops 1' }));
    await user.click(screen.getByRole('button', { name: 'General' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Ops' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Ops 1' })).not.toBeInTheDocument();
    });
  });

  it('does not render the All channel button', () => {
    render(
      <ToastProvider>
        <ChatPanel {...baseProps} />
      </ToastProvider>,
    );
    expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument();
  });

  it('wraps channel pills in a dedicated column so toolbar utilities stay visible', () => {
    const manyChannels = Array.from({ length: 24 }, (_, index) => ({
      index,
      name: `Ch${index}`,
    }));
    render(
      <ToastProvider>
        <ChatPanel {...baseProps} channels={manyChannels} />
      </ToastProvider>,
    );

    const label = screen.getByText('Channels');
    const channelsContainer = label.parentElement;
    expect(channelsContainer?.className).toMatch(/flex-wrap/);
    expect(channelsContainer?.className).not.toMatch(/whitespace-nowrap/);

    const headerRow = channelsContainer?.parentElement;
    expect(headerRow?.className).toMatch(/grid-cols-\[minmax\(0,1fr\)_auto\]/);

    const exportBtn = screen.getByRole('button', { name: 'Export chat' });
    const starredBtn = screen.getByRole('button', { name: 'Starred messages' });
    expect(channelsContainer?.contains(exportBtn)).toBe(false);
    expect(channelsContainer?.contains(starredBtn)).toBe(false);
    expect(headerRow?.contains(exportBtn)).toBe(true);
    expect(headerRow?.contains(starredBtn)).toBe(true);
    expect(screen.getByRole('button', { name: 'Ch23' })).toBeInTheDocument();
  });

  it('clears the unread divider without scrolling when all unread messages are visible', async () => {
    const ts = Date.now();
    // Seed a stored watermark so the component treats the last message as unread.
    localStorage.setItem('mesh-client:lastRead:meshtastic', JSON.stringify({ 'ch:0': ts - 1000 }));

    render(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          messages={[
            {
              sender_id: 2,
              sender_name: 'Alice',
              payload: 'Old message',
              channel: 0,
              timestamp: ts - 2000,
              status: 'acked',
            },
            {
              sender_id: 2,
              sender_name: 'Alice',
              payload: 'Unread message',
              channel: 0,
              timestamp: ts,
              status: 'acked',
            },
          ]}
          isActive={true}
        />
      </ToastProvider>,
    );

    // The divider should disappear via the layout-effect rAF without requiring a scroll event.
    await waitFor(() => {
      expect(screen.queryByText('New messages')).not.toBeInTheDocument();
    });
  });
});

describe('ChatPanel compose emoji picker', () => {
  const defaultProps = {
    messages: [],
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

  beforeEach(() => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
    vi.mocked(window.electronAPI.showEmojiPanel).mockClear().mockResolvedValue(undefined);
  });

  it('shows emoji-picker element on Linux when emoji button is clicked', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ChatPanel {...defaultProps} />
      </ToastProvider>,
    );
    const emojiBtn = screen.getByRole('button', { name: 'Emoji' });
    await user.click(emojiBtn);
    expect(document.querySelector('emoji-picker')).toBeInTheDocument();
    expect(window.electronAPI.showEmojiPanel).not.toHaveBeenCalled();
  });

  it('calls showEmojiPanel and does not render emoji-picker on macOS', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('darwin');
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ChatPanel {...defaultProps} />
      </ToastProvider>,
    );
    const emojiBtn = screen.getByRole('button', { name: 'Emoji' });
    await user.click(emojiBtn);
    expect(window.electronAPI.showEmojiPanel).toHaveBeenCalledOnce();
    expect(document.querySelector('emoji-picker')).not.toBeInTheDocument();
  });

  it('calls showEmojiPanel and does not render emoji-picker on Windows', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('win32');
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ChatPanel {...defaultProps} />
      </ToastProvider>,
    );
    const emojiBtn = screen.getByRole('button', { name: 'Emoji' });
    await user.click(emojiBtn);
    expect(window.electronAPI.showEmojiPanel).toHaveBeenCalledOnce();
    expect(document.querySelector('emoji-picker')).not.toBeInTheDocument();
  });
});

describe('ChatPanel tapback reaction picker', () => {
  const baseMessage = {
    sender_id: 2,
    sender_name: 'Alice',
    payload: 'hello',
    channel: 0,
    timestamp: Date.now() - 1000,
    status: 'acked' as const,
  };

  const defaultProps = {
    messages: [baseMessage],
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

  beforeEach(() => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
    vi.mocked(window.electronAPI.showEmojiPanel).mockClear().mockResolvedValue(undefined);
  });

  it('shows emoji-picker element on Linux when React button is clicked', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ChatPanel {...defaultProps} />
      </ToastProvider>,
    );
    const reactBtn = screen.getByTitle('React');
    await user.click(reactBtn);
    await waitFor(() => {
      expect(document.querySelector('emoji-picker')).toBeInTheDocument();
    });
    expect(window.electronAPI.showEmojiPanel).not.toHaveBeenCalled();
  });

  it('calls onReact with full grapheme when Linux emoji-picker fires emoji-click', async () => {
    const US_FLAG = '\u{1F1FA}\u{1F1F8}';
    const onReact = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          onReact={onReact}
          messages={[{ ...baseMessage, packetId: 42 }]}
        />
      </ToastProvider>,
    );
    await user.click(screen.getByTitle('React'));
    await waitFor(() => {
      expect(document.querySelector('emoji-picker')).toBeInTheDocument();
    });
    const picker = document.querySelector('emoji-picker');
    expect(picker).not.toBeNull();
    picker!.dispatchEvent(
      new CustomEvent('emoji-click', { detail: { emoji: { unicode: US_FLAG } }, bubbles: true }),
    );
    await waitFor(() => {
      expect(onReact).toHaveBeenCalledWith(US_FLAG, 42, 0);
    });
  });

  it.each(['darwin', 'win32'] as const)(
    'calls showEmojiPanel and does not render emoji-picker on %s when React button is clicked',
    async (platform) => {
      vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
      const user = userEvent.setup();
      render(
        <ToastProvider>
          <ChatPanel {...defaultProps} />
        </ToastProvider>,
      );
      const reactBtn = screen.getByTitle('React');
      await user.click(reactBtn);
      expect(window.electronAPI.showEmojiPanel).toHaveBeenCalledOnce();
      expect(document.querySelector('emoji-picker')).not.toBeInTheDocument();
    },
  );
});

describe('ChatPanel RF hop label', () => {
  const defaultProps = {
    messages: [] as ChatMessage[],
    channels: [{ index: 0, name: 'General' }],
    myNodeNum: 99,
    onSend: vi.fn().mockResolvedValue(undefined),
    onReact: vi.fn().mockResolvedValue(undefined),
    onResend: vi.fn(),
    onNodeClick: vi.fn(),
    isConnected: true,
    nodes: new Map(),
    isActive: true,
  };

  it('shows rx hops for MeshCore RF incoming messages', async () => {
    render(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          protocol="meshcore"
          messages={[
            {
              sender_id: 1,
              sender_name: 'Peer',
              payload: 'hello mesh',
              channel: 0,
              timestamp: Date.now(),
              receivedVia: 'rf',
              rxHops: 3,
            },
          ]}
        />
      </ToastProvider>,
    );
    expect(await screen.findByText('3 hops')).toBeInTheDocument();
  });
});

// ─── New feature tests ──────────────────────────────────────────────────────

const baseProps = {
  messages: [] as ChatMessage[],
  channels: [
    { index: 0, name: 'General' },
    { index: 1, name: 'Admin' },
  ],
  myNodeNum: 1,
  onSend: vi.fn().mockResolvedValue(undefined),
  onReact: vi.fn().mockResolvedValue(undefined),
  onResend: vi.fn(),
  onNodeClick: vi.fn(),
  isConnected: true,
  nodes: new Map<number, MeshNode>(),
  isActive: true,
};

function makeMsg(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    sender_id: 2,
    sender_name: 'Alice',
    payload: 'hello',
    channel: 0,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('ChatPanel — copy button', () => {
  it('shows a Copy button on each message and writes payload to clipboard', async () => {
    const user = userEvent.setup();
    const writeText = vi.mocked(window.electronAPI.clipboard.writeText);

    render(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={[makeMsg({ payload: 'copy me' })]} />
      </ToastProvider>,
    );

    const btn = await screen.findByTitle('Copy message');
    await user.click(btn);
    expect(writeText).toHaveBeenCalledWith('copy me');
  });
});

describe('ChatPanel — sender filter', () => {
  it('shows all messages by default, filter banner absent', () => {
    render(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          messages={[
            makeMsg({ sender_id: 2, sender_name: 'Alice', payload: 'from alice' }),
            makeMsg({ sender_id: 3, sender_name: 'Bob', payload: 'from bob' }),
          ]}
        />
      </ToastProvider>,
    );
    expect(screen.getByText('from alice')).toBeInTheDocument();
    expect(screen.getByText('from bob')).toBeInTheDocument();
    expect(screen.queryByText(/Filtering by/)).not.toBeInTheDocument();
  });

  it('filters to sender when filter button is clicked, shows banner', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          messages={[
            makeMsg({ sender_id: 2, sender_name: 'Alice', payload: 'from alice' }),
            makeMsg({ sender_id: 3, sender_name: 'Bob', payload: 'from bob' }),
          ]}
          nodes={
            new Map([
              [
                2,
                {
                  node_id: 2,
                  long_name: 'Alice',
                  short_name: 'A',
                  hw_model: '',
                  snr: 0,
                  battery: 0,
                  last_heard: Date.now(),
                  latitude: null,
                  longitude: null,
                },
              ],
            ])
          }
        />
      </ToastProvider>,
    );
    const filterBtns = screen.getAllByLabelText('Filter by sender');
    await user.click(filterBtns[0]);
    expect(screen.queryByText('from bob')).not.toBeInTheDocument();
    expect(screen.getByText('from alice')).toBeInTheDocument();
    expect(screen.getByText(/Filtering by/)).toBeInTheDocument();
  });

  it('clears filter when × is clicked', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          messages={[
            makeMsg({ sender_id: 2, sender_name: 'Alice', payload: 'from alice' }),
            makeMsg({ sender_id: 3, sender_name: 'Bob', payload: 'from bob' }),
          ]}
          nodes={
            new Map([
              [
                2,
                {
                  node_id: 2,
                  long_name: 'Alice',
                  short_name: 'A',
                  hw_model: '',
                  snr: 0,
                  battery: 0,
                  last_heard: Date.now(),
                  latitude: null,
                  longitude: null,
                },
              ],
            ])
          }
        />
      </ToastProvider>,
    );
    const filterBtns = screen.getAllByLabelText('Filter by sender');
    await user.click(filterBtns[0]);
    await user.click(screen.getByLabelText('Clear filter'));
    expect(screen.getByText('from alice')).toBeInTheDocument();
    expect(screen.getByText('from bob')).toBeInTheDocument();
  });
});

describe('ChatPanel — draft persistence', () => {
  it('preserves unsent input when switching channels', async () => {
    const user = userEvent.setup();
    localStorage.clear();
    render(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          protocol="meshtastic"
          channels={[
            { index: 0, name: 'General' },
            { index: 1, name: 'Admin' },
          ]}
        />
      </ToastProvider>,
    );
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'unsent draft');
    expect(textarea).toHaveValue('unsent draft');

    // Switch to channel 1 (second channel button)
    const channelButtons = screen.getAllByRole('button', { name: /General|Admin|ch0|ch1/i });
    const adminBtn = channelButtons.find((b) => /Admin|ch1|1/i.test(b.textContent ?? ''));
    if (adminBtn) {
      await user.click(adminBtn);
      expect(textarea).toHaveValue('');
      // Switch back
      const generalBtn = screen
        .getAllByRole('button')
        .find((b) => /General|ch0/i.test(b.textContent ?? ''));
      if (generalBtn) {
        await user.click(generalBtn);
        expect(textarea).toHaveValue('unsent draft');
      }
    }
  });
});

describe('ChatPanel — DM node info header', () => {
  it('shows battery and signal info when DM tab is active', async () => {
    const dmNode: MeshNode = {
      node_id: 2,
      long_name: 'Alice',
      short_name: 'A',
      hw_model: '',
      snr: 5,
      battery: 72,
      last_heard: Date.now() - 120_000,
      latitude: null,
      longitude: null,
    };
    render(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          protocol="meshtastic"
          nodes={new Map([[2, dmNode]])}
          messages={[makeMsg({ sender_id: 2, sender_name: 'Alice', payload: 'hi', to: 1 })]}
          initialDmTarget={2}
        />
      </ToastProvider>,
    );
    // The DM info bar should be visible once the DM tab auto-opens
    const infoBar = await screen.findByRole('status', { name: 'DM peer info' });
    expect(infoBar).toBeInTheDocument();
    expect(infoBar.textContent).toContain('72%');
    expect(infoBar.textContent).toContain('5');
  });

  it('shows correct last-heard time for meshcore (last_heard in seconds, not ms)', async () => {
    const twoMinutesAgoSec = Math.floor((Date.now() - 120_000) / 1000);
    const dmNode: MeshNode = {
      node_id: 2,
      long_name: 'Bob',
      short_name: 'B',
      hw_model: '',
      snr: 3,
      battery: 50,
      last_heard: twoMinutesAgoSec,
      latitude: null,
      longitude: null,
    };
    render(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          protocol="meshcore"
          nodes={new Map([[2, dmNode]])}
          messages={[makeMsg({ sender_id: 2, sender_name: 'Bob', payload: 'hey', to: 1 })]}
          initialDmTarget={2}
        />
      </ToastProvider>,
    );
    const infoBar = await screen.findByRole('status', { name: 'DM peer info' });
    // Should show "2m ago", not a wildly inflated day count
    expect(infoBar.textContent).toMatch(/\d+m ago/);
    expect(infoBar.textContent).not.toMatch(/\d{4,}d ago/);
  });
});

describe('ChatPanel — @mention autocomplete', () => {
  const aliceNode: MeshNode = {
    node_id: 2,
    long_name: 'Alice',
    short_name: 'Al',
    hw_model: '',
    snr: 0,
    battery: 0,
    last_heard: Date.now(),
    latitude: null,
    longitude: null,
  };

  it('shows autocomplete dropdown when @ is typed', async () => {
    render(
      <ToastProvider>
        <ChatPanel {...baseProps} protocol="meshtastic" nodes={new Map([[2, aliceNode]])} />
      </ToastProvider>,
    );
    const textarea = screen.getByRole('textbox');
    // fireEvent.change gives us reliable selectionStart control
    fireEvent.change(textarea, { target: { value: '@' } });
    // After @ alone, candidates = all nodes; dropdown should appear
    const listbox = await screen.findByRole('listbox', { name: 'Mention suggestions' });
    expect(listbox).toBeInTheDocument();
  });

  it('inserts @[Name] token when dropdown option is clicked', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ChatPanel {...baseProps} protocol="meshtastic" nodes={new Map([[2, aliceNode]])} />
      </ToastProvider>,
    );
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '@Al' } });
    const option = await screen.findByRole('option');
    await user.click(option);
    // Value should contain @[ ... ] mention token (name is short_name for meshtastic)
    expect((textarea as HTMLTextAreaElement).value).toContain('@[');
  });
});

describe('ChatPanel — jump to date', () => {
  it('shows date input when calendar button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ChatPanel {...baseProps} />
      </ToastProvider>,
    );
    const calBtn = screen.getByLabelText('Jump to date');
    expect(screen.queryByLabelText('Jump to date', { selector: 'input' })).not.toBeInTheDocument();
    await user.click(calBtn);
    expect(screen.getByLabelText('Jump to date', { selector: 'input' })).toBeInTheDocument();
  });
});

describe('ChatPanel — export chat', () => {
  it('calls window.electronAPI.chat.export with current messages', async () => {
    const user = userEvent.setup();
    const exportFn = vi.fn().mockResolvedValue({ success: true, path: '/tmp/chat.txt' });
    (window.electronAPI as any).chat = {
      export: exportFn,
      linkPreview: { fetch: vi.fn().mockResolvedValue(null) },
      outbox: {
        list: vi.fn().mockResolvedValue([]),
        add: vi.fn().mockResolvedValue(null),
        updateStatus: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    };

    render(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={[makeMsg({ payload: 'exported message' })]} />
      </ToastProvider>,
    );
    const exportBtn = screen.getByRole('button', { name: 'Export chat' });
    await user.click(exportBtn);
    expect(exportFn).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ payload: 'exported message' })]),
    );
  });
});

describe('ChatPanel — draft restored on initial mount', () => {
  it('loads a previously saved draft for the initial view on mount', async () => {
    localStorage.clear();
    saveDraft('meshtastic', 'ch:0', 'persisted draft');

    render(
      <ToastProvider>
        <ChatPanel {...baseProps} protocol="meshtastic" />
      </ToastProvider>,
    );

    const textarea = await screen.findByRole('textbox');
    expect(textarea).toHaveValue('persisted draft');

    localStorage.setItem(draftsStorageKey('meshtastic'), '{}');
  });
});

describe('ChatPanel — notification sound on new messages', () => {
  const playMock = vi.mocked(chatNotifications.playMessageNotification);

  beforeEach(() => {
    playMock.mockClear();
    localStorage.removeItem('mesh-client:notifMuted');
  });

  afterEach(() => {
    localStorage.removeItem('mesh-client:notifMuted');
  });

  it('does not play sound for messages already present at mount (e.g. after protocol switch)', async () => {
    // Message is in channel 1, but the default view starts on channel 0 — this is
    // exactly the case that would trigger the erroneous sound before the fix.
    const existingMsg = makeMsg({ sender_id: 2, channel: 1, isHistory: undefined });

    render(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={[existingMsg]} isActive />
      </ToastProvider>,
    );

    await screen.findByRole('textbox');
    expect(playMock).not.toHaveBeenCalled();
  });

  it('plays sound for a new message when not on the chat panel (isActive=false)', async () => {
    const { rerender } = render(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={[]} isActive={false} />
      </ToastProvider>,
    );

    await screen.findByRole('textbox');
    playMock.mockClear();

    const newMsg = makeMsg({ sender_id: 2, channel: 0, isHistory: undefined });
    rerender(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={[newMsg]} isActive={false} />
      </ToastProvider>,
    );

    await screen.findByRole('textbox');
    expect(playMock).toHaveBeenCalledOnce();
  });

  it('does not play sound when notifMuted=1 in localStorage (global setting from AppPanel)', async () => {
    localStorage.setItem('mesh-client:notifMuted', '1');

    const { rerender } = render(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={[]} isActive={false} />
      </ToastProvider>,
    );

    await screen.findByRole('textbox');
    playMock.mockClear();

    const newMsg = makeMsg({ sender_id: 2, channel: 0, isHistory: undefined });
    rerender(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={[newMsg]} isActive={false} />
      </ToastProvider>,
    );

    await screen.findByRole('textbox');
    expect(playMock).not.toHaveBeenCalled();
  });
});
