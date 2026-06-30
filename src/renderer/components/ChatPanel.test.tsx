import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import * as chatNotifications from '../lib/chatNotifications';
import { draftsStorageKey, lastReadStorageKey, saveDraft } from '../lib/chatPanelProtocolStorage';
import { getDistFromChatBottom, VIRTUALIZER_SCROLL_END_THRESHOLD } from '../lib/chatScrollUtils';
import type { ChatMessage, MeshNode } from '../lib/types';
import ChatPanel from './ChatPanel';
import { ToastProvider } from './Toast';

async function waitForComposer(): Promise<HTMLElement> {
  return screen.findByRole('textbox');
}

vi.mock('../lib/chatNotifications', () => ({ playMessageNotification: vi.fn() }));

let mockIsAtEnd = true;
let mockScrollDirection: 'forward' | 'backward' | null = 'forward';
const mockScrollToEnd = vi.fn();
const mockScrollToIndex = vi.fn();
let lastVirtualizerOptions: Record<string, unknown> | undefined;
let lastVirtualizerInstance: Record<string, unknown> | undefined;

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: Record<string, unknown> & { count: number }) => {
    lastVirtualizerOptions = opts;
    const count = opts.count;
    const instance = {
      getVirtualItems: () =>
        Array.from({ length: count }, (_, index) => ({
          index,
          key: index,
          start: index * 96,
        })),
      getTotalSize: () => count * 96,
      measureElement: () => {},
      containerRef: { current: null },
      isAtEnd: () => mockIsAtEnd,
      scrollToEnd: mockScrollToEnd,
      scrollToIndex: mockScrollToIndex,
      get scrollDirection() {
        return mockScrollDirection;
      },
      shouldAdjustScrollPositionOnItemSizeChange: undefined as
        | ((
            item: { index: number },
            delta: number,
            inst: { scrollDirection: string | null },
          ) => boolean)
        | undefined,
    };
    lastVirtualizerInstance = instance;
    return instance;
  },
}));

beforeEach(() => {
  localStorage.clear();
  mockIsAtEnd = true;
  mockScrollDirection = 'forward';
  mockScrollToEnd.mockClear();
  mockScrollToIndex.mockClear();
  lastVirtualizerOptions = undefined;
  lastVirtualizerInstance = undefined;
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

  it('clears message filter when search is closed', async () => {
    const now = Date.now();
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          isConnected
          messages={[
            {
              sender_id: 1,
              sender_name: 'A',
              payload: 'alpha message',
              channel: 0,
              timestamp: now - 2000,
              status: 'acked',
            },
            {
              sender_id: 1,
              sender_name: 'A',
              payload: 'beta message',
              channel: 0,
              timestamp: now - 1000,
              status: 'acked',
            },
          ]}
        />
      </ToastProvider>,
    );
    await user.click(screen.getByLabelText('Search messages'));
    const searchInput = screen.getByLabelText('Search messages...');
    await user.type(searchInput, 'alpha');
    await waitFor(() => {
      expect(lastVirtualizerOptions?.count).toBe(1);
    });
    // Search highlight wraps matches in <mark>, so assert the highlighted token.
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.queryByText('beta message')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Search messages'));
    expect(screen.queryByLabelText('Search messages...')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(lastVirtualizerOptions?.count).toBe(2);
    });
    expect(screen.getByText('alpha message')).toBeInTheDocument();
    expect(screen.getByText('beta message')).toBeInTheDocument();
  });

  it('clears message filter via search clear button without closing search', async () => {
    const now = Date.now();
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          isConnected
          messages={[
            {
              sender_id: 1,
              sender_name: 'A',
              payload: 'alpha message',
              channel: 0,
              timestamp: now - 2000,
              status: 'acked',
            },
            {
              sender_id: 1,
              sender_name: 'A',
              payload: 'beta message',
              channel: 0,
              timestamp: now - 1000,
              status: 'acked',
            },
          ]}
        />
      </ToastProvider>,
    );
    await user.click(screen.getByLabelText('Search messages'));
    const searchInput = screen.getByLabelText('Search messages...');
    await user.type(searchInput, 'alpha');
    await waitFor(() => {
      expect(lastVirtualizerOptions?.count).toBe(1);
    });
    await user.click(screen.getByLabelText('Clear'));
    expect(searchInput).toHaveValue('');
    await waitFor(() => {
      expect(lastVirtualizerOptions?.count).toBe(2);
    });
    expect(screen.getByLabelText('Search messages...')).toBeInTheDocument();
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
    expect(screen.getByRole('img', { name: 'Received via RF' })).toBeInTheDocument();
  });

  it('shows hybrid RF + MQTT transport badge for incoming messages with receivedVia both', () => {
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
              receivedVia: 'both',
            },
          ]}
        />
      </ToastProvider>,
    );
    expect(screen.getByTitle('Received via RF + MQTT')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Received via RF + MQTT' })).toBeInTheDocument();
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
    expect(screen.getByRole('img', { name: 'Replayed from Store & Forward' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Received via RF' })).toBeInTheDocument();
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
    expect(screen.getByRole('img', { name: 'Received via RF' })).toBeInTheDocument();
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
    expect(screen.getByRole('img', { name: 'Received via MQTT' })).toBeInTheDocument();
  });

  it('shows Reticulum RF/TCP/network transport badges for incoming messages', () => {
    const { rerender } = render(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          protocol="reticulum"
          dmOnlyChat
          myNodeNum={1}
          messages={[
            {
              sender_id: 2,
              sender_name: 'Peer',
              payload: 'RF hello',
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

    rerender(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          protocol="reticulum"
          dmOnlyChat
          myNodeNum={1}
          messages={[
            {
              sender_id: 2,
              sender_name: 'Peer',
              payload: 'TCP hello',
              channel: 0,
              timestamp: Date.now(),
              status: 'acked',
              receivedVia: 'tcp',
            },
          ]}
        />
      </ToastProvider>,
    );
    expect(screen.getByLabelText('Received via TCP')).toHaveTextContent('TCP');

    rerender(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          protocol="reticulum"
          dmOnlyChat
          myNodeNum={1}
          messages={[
            {
              sender_id: 2,
              sender_name: 'Peer',
              payload: 'Network hello',
              channel: 0,
              timestamp: Date.now(),
              status: 'acked',
              receivedVia: 'network',
            },
          ]}
        />
      </ToastProvider>,
    );
    expect(screen.getByTitle('Received via network')).toBeInTheDocument();
  });

  it('shows Reticulum outbound transport status for own messages', () => {
    render(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          protocol="reticulum"
          dmOnlyChat
          isConnected
          myNodeNum={42}
          messages={[
            {
              sender_id: 42,
              sender_name: 'Self',
              payload: 'Outbound',
              channel: 0,
              timestamp: Date.now(),
              status: 'acked',
              receivedVia: 'tcp',
              to: 2,
            },
          ]}
        />
      </ToastProvider>,
    );
    expect(screen.getByText(/TCP/)).toBeInTheDocument();
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
    expect(screen.getByText('No conversations yet')).toBeInTheDocument();
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
      expect(screen.getByRole('button', { name: 'Alice' })).toBeInTheDocument();
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
    localStorage.setItem('mesh-client:lastRead:meshcore', JSON.stringify({ 'dm:2': ts }));
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
    fireEvent.scroll(scrollContainer);

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
      expect.stringMatching(/\[ChatComposer\].*Send failed/s),
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

describe('ChatPanel scroll pinning', () => {
  const baseProps = {
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

  const makeMsg = (idx: number): ChatMessage => ({
    sender_id: 2,
    sender_name: 'Alice',
    payload: `message ${idx}`,
    channel: 0,
    timestamp: Date.now() - (100 - idx) * 1000,
    status: 'acked',
  });

  it('configures TanStack Virtual with chat scroll contract', () => {
    render(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={[makeMsg(0)]} />
      </ToastProvider>,
    );
    expect(lastVirtualizerOptions?.anchorTo).toBe('end');
    expect(lastVirtualizerOptions?.followOnAppend).toBe(true);
    expect(lastVirtualizerOptions?.scrollEndThreshold).toBe(VIRTUALIZER_SCROLL_END_THRESHOLD);
    expect(lastVirtualizerOptions?.measureElement).toBeTypeOf('function');
    const adjust = lastVirtualizerInstance?.shouldAdjustScrollPositionOnItemSizeChange as (
      item: { index: number },
      delta: number,
      instance: {
        scrollDirection: 'forward' | 'backward' | null;
        isAtEnd: () => boolean;
      },
    ) => boolean;
    expect(adjust).toBeTypeOf('function');
    expect(adjust({ index: 0 }, 0, { scrollDirection: 'forward', isAtEnd: () => true })).toBe(true);
    expect(adjust({ index: 0 }, 0, { scrollDirection: 'backward', isAtEnd: () => true })).toBe(
      false,
    );
    expect(adjust({ index: 0 }, 0, { scrollDirection: 'forward', isAtEnd: () => false })).toBe(
      false,
    );
  });

  it('scrolls to unread via scrollToIndex on view switch, not scrollIntoView', async () => {
    mockIsAtEnd = false;
    const scrollIntoView = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(scrollIntoView);

    const ts = Date.now();
    localStorage.setItem(lastReadStorageKey('meshtastic'), JSON.stringify({ 'ch:0': ts - 5000 }));

    const messages: ChatMessage[] = [
      {
        sender_id: 1,
        sender_name: 'Me',
        payload: 'Old message',
        channel: 0,
        timestamp: ts - 3000,
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
    ];

    render(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={messages} />
      </ToastProvider>,
    );

    await waitFor(() => {
      expect(mockScrollToIndex).toHaveBeenCalledWith(1, { align: 'center' });
    });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('Jump to Unread uses scrollToIndex with align start', async () => {
    mockIsAtEnd = false;
    const user = userEvent.setup();
    const ts = Date.now();
    localStorage.setItem(lastReadStorageKey('meshtastic'), JSON.stringify({ 'ch:0': ts - 5000 }));

    const messages: ChatMessage[] = [
      {
        sender_id: 1,
        sender_name: 'Me',
        payload: 'Old message',
        channel: 0,
        timestamp: ts - 3000,
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
    ];

    const { container } = render(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={messages} />
      </ToastProvider>,
    );

    mockScrollToIndex.mockClear();

    const scrollContainer = container.querySelector('div.overflow-y-auto')!;
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(scrollContainer, 'scrollTop', {
      value: 0,
      writable: true,
      configurable: true,
    });
    fireEvent.scroll(scrollContainer);

    await user.click(await screen.findByRole('button', { name: 'Jump to Unread' }));

    expect(mockScrollToIndex).toHaveBeenCalledWith(1, { align: 'start', behavior: 'smooth' });
  });

  it('dismisses unread divider when scrolled past without marking read until near bottom', async () => {
    mockIsAtEnd = false;
    const ts = Date.now();
    localStorage.setItem(lastReadStorageKey('meshtastic'), JSON.stringify({ 'ch:0': ts - 5000 }));

    const messages: ChatMessage[] = [
      {
        sender_id: 1,
        sender_name: 'Me',
        payload: 'Old message',
        channel: 0,
        timestamp: ts - 3000,
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
    ];

    const { container } = render(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={messages} />
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

    await screen.findByText('New messages');

    Object.defineProperty(scrollContainer, 'scrollTop', {
      value: 1500,
      writable: true,
      configurable: true,
    });

    const divider = container.querySelector('[class*="border-red-500"]')?.parentElement;
    expect(divider).toBeTruthy();
    vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 500,
      left: 0,
      right: 400,
      width: 400,
      height: 400,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    vi.spyOn(divider!, 'getBoundingClientRect').mockReturnValue({
      top: 50,
      bottom: 90,
      left: 0,
      right: 400,
      width: 400,
      height: 40,
      x: 0,
      y: 50,
      toJSON: () => ({}),
    });

    fireEvent.scroll(scrollContainer);

    await waitFor(() => {
      expect(screen.queryByText('New messages')).not.toBeInTheDocument();
    });

    const stored = JSON.parse(
      localStorage.getItem(lastReadStorageKey('meshtastic')) ?? '{}',
    ) as Record<string, number>;
    expect(stored['ch:0']).toBe(ts - 5000);
  });

  it('does not scroll to end when message count increases while reading history', async () => {
    mockIsAtEnd = false;
    const scrollIntoView = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(scrollIntoView);

    const initial = Array.from({ length: 5 }, (_, i) => makeMsg(i));
    const { container, rerender } = render(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={initial} />
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
    fireEvent.scroll(scrollContainer);

    mockScrollToEnd.mockClear();
    scrollIntoView.mockClear();

    const more = [...initial, makeMsg(5), makeMsg(6)];
    rerender(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={more} />
      </ToastProvider>,
    );

    await waitFor(() => {
      expect(mockScrollToEnd).not.toHaveBeenCalled();
    });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('shows Jump to Latest when virtualizer reports not at end', async () => {
    mockIsAtEnd = false;
    const longMessages = Array.from({ length: 20 }, (_, idx) => makeMsg(idx));

    const { container } = render(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={longMessages} />
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

    fireEvent.scroll(scrollContainer);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Jump to Latest' })).toBeInTheDocument();
    });
  });

  it('jumps to quoted parent via scrollToIndex, not scrollIntoView', async () => {
    mockScrollToIndex.mockClear();
    const scrollIntoView = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(scrollIntoView);
    const t0 = Date.now() - 5000;
    const t1 = t0 + 1000;
    const user = userEvent.setup();
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
    await user.click(screen.getByRole('button', { name: /Jump to quoted message from Alice/i }));
    expect(mockScrollToIndex).toHaveBeenCalledWith(0, { align: 'center', behavior: 'smooth' });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('restores scrollTop on tab re-entry instead of leaving it at the value set while hidden', () => {
    mockIsAtEnd = false;
    const { container, rerender } = render(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={[makeMsg(0)]} isActive />
      </ToastProvider>,
    );

    const scrollContainer = container.querySelector('div.overflow-y-auto')!;
    Object.defineProperty(scrollContainer, 'scrollTop', {
      value: 500,
      writable: true,
      configurable: true,
    });
    fireEvent.scroll(scrollContainer);

    rerender(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={[makeMsg(0)]} isActive={false} />
      </ToastProvider>,
    );

    // Simulate the scroll position drifting while the tab is hidden (e.g. a stale
    // virtualizer recalculation against the collapsed 0x0 `display: none` container).
    (scrollContainer as HTMLDivElement).scrollTop = 0;

    rerender(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={[makeMsg(0)]} isActive />
      </ToastProvider>,
    );

    expect((scrollContainer as HTMLDivElement).scrollTop).toBe(500);
  });

  it('scrolls to end on tab re-entry when pinned and messages grew while away', () => {
    mockIsAtEnd = true;
    const initialMessages = Array.from({ length: 5 }, (_, i) => makeMsg(i));
    const { container, rerender } = render(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={initialMessages} isActive />
      </ToastProvider>,
    );

    const scrollContainer = container.querySelector('div.overflow-y-auto')!;
    Object.defineProperty(scrollContainer, 'scrollTop', {
      value: 400,
      writable: true,
      configurable: true,
    });
    fireEvent.scroll(scrollContainer);

    rerender(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={initialMessages} isActive={false} />
      </ToastProvider>,
    );

    mockScrollToEnd.mockClear();
    mockScrollToEnd.mockImplementation(() => {
      (scrollContainer as HTMLDivElement).scrollTop = 900;
    });

    const messagesWhileAway = Array.from({ length: 10 }, (_, i) => makeMsg(i));
    rerender(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={messagesWhileAway} isActive />
      </ToastProvider>,
    );

    expect(mockScrollToEnd).toHaveBeenCalled();
    expect((scrollContainer as HTMLDivElement).scrollTop).toBe(900);
  });

  it('restores raw scrollTop on tab re-entry instead of re-centering on a still-present unread divider', () => {
    mockIsAtEnd = false;
    const ts = Date.now();
    localStorage.setItem(lastReadStorageKey('meshtastic'), JSON.stringify({ 'ch:0': ts - 5000 }));

    const messages: ChatMessage[] = [
      {
        sender_id: 1,
        sender_name: 'Me',
        payload: 'Old message',
        channel: 0,
        timestamp: ts - 3000,
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
    ];

    const { container, rerender } = render(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={messages} isActive />
      </ToastProvider>,
    );

    const scrollContainer = container.querySelector('div.overflow-y-auto')!;
    // Keep distFromBottom large so applyNearBottomReadState doesn't clear the
    // divider via setUnreadDividerTimestamp(0) before the test exercises it.
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(scrollContainer, 'scrollTop', {
      value: 250,
      writable: true,
      configurable: true,
    });
    fireEvent.scroll(scrollContainer);

    mockScrollToIndex.mockClear();

    rerender(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={messages} isActive={false} />
      </ToastProvider>,
    );

    rerender(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={messages} isActive />
      </ToastProvider>,
    );

    // A bare tab return must not re-fire the unread-divider scroll (it would
    // clobber the restored position with a re-center on the divider — the jump).
    expect(mockScrollToIndex).not.toHaveBeenCalled();
    expect((scrollContainer as HTMLDivElement).scrollTop).toBe(250);
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

  it('renders quoted preview from replyPreviewSender without replyId (MeshCore unresolved parent)', () => {
    render(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          protocol="meshcore"
          messages={[
            {
              sender_id: 2,
              sender_name: 'TB-Dek',
              payload: 'agreed, coffee',
              channel: 0,
              timestamp: Date.now(),
              replyPreviewSender: '🛩️ W0STR mobl',
              status: 'acked',
            },
          ]}
        />
      </ToastProvider>,
    );
    expect(screen.getByText(/W0STR mobl/)).toBeInTheDocument();
    expect(screen.getByText('agreed, coffee')).toBeInTheDocument();
    expect(screen.queryByText('@[')).not.toBeInTheDocument();
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
    expect(screen.getByLabelText(/Jump to quoted message from Alice/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Jump to quoted message from Alice/i })).toBeNull();
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

  it('keeps DM tab open after unread clears when conversation was opened via DM tab', async () => {
    const user = userEvent.setup();
    const ts = Date.now();
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
          last_heard: ts,
          latitude: null,
          longitude: null,
        },
      ],
    ]);
    const { rerender } = render(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          protocol="meshcore"
          myNodeNum={0x12345678}
          ownNodeIds={[0x12345678]}
          nodes={nodes}
          messages={[
            {
              sender_id: 2,
              sender_name: 'Alice',
              payload: 'DM ping',
              channel: 0,
              timestamp: ts,
              status: 'acked',
              to: 0x12345678,
            },
          ]}
        />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Alice' }));

    rerender(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          protocol="meshcore"
          myNodeNum={0x12345678}
          ownNodeIds={[0x12345678]}
          nodes={nodes}
          messages={[
            {
              sender_id: 0x12345678,
              sender_name: 'Me',
              payload: 'My reply',
              channel: 0,
              timestamp: ts + 1,
              status: 'acked',
              to: 2,
            },
          ]}
        />
      </ToastProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Alice' })).toBeInTheDocument();
    });
  });

  it('shows MeshCore inbound DM with to:0 in thread and clears DM unread when opened', async () => {
    const user = userEvent.setup();
    const ts = Date.now();
    const selfId = 0x12345678;
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
          last_heard: ts,
          latitude: null,
          longitude: null,
        },
      ],
    ]);
    render(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          protocol="meshcore"
          myNodeNum={selfId}
          ownNodeIds={[selfId]}
          nodes={nodes}
          messages={[
            {
              sender_id: 2,
              sender_name: 'Alice',
              payload: 'orphan DM',
              channel: -1,
              timestamp: ts,
              status: 'acked',
              to: 0,
            },
          ]}
        />
      </ToastProvider>,
    );

    expect(screen.getByRole('button', { name: 'Alice' })).toBeInTheDocument();
    const aliceTab = screen.getByRole('button', { name: 'Alice' }).closest('.relative');
    expect(aliceTab?.querySelector('.bg-red-600')?.textContent).toBe('1');

    await user.click(screen.getByRole('button', { name: 'Alice' }));
    expect(screen.getByText('orphan DM')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'General' }));

    await waitFor(() => {
      expect(aliceTab?.querySelector('.bg-red-600')).toBeNull();
    });
  });

  it('keeps dismissed DM tab visible while unread remains', async () => {
    const user = userEvent.setup();
    const ts = Date.now();
    render(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          protocol="meshcore"
          myNodeNum={0x12345678}
          ownNodeIds={[0x12345678]}
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
                  last_heard: ts,
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
              payload: 'DM ping',
              channel: 0,
              timestamp: ts,
              status: 'acked',
              to: 0x12345678,
            },
          ]}
        />
      </ToastProvider>,
    );

    expect(screen.getByRole('button', { name: 'Alice' })).toBeInTheDocument();
    await user.click(screen.getByTitle('Close DM'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Alice' })).toBeInTheDocument();
    });
  });

  it('does not count MeshCore unread on unconfigured zero-PSK channel slots', () => {
    const ts = Date.now();
    render(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          protocol="meshcore"
          myNodeNum={0x12345678}
          ownNodeIds={[0x12345678]}
          channels={[{ index: 0, name: 'General' }]}
          meshcoreChannelSources={[
            { index: 0, name: 'General', secret: new Uint8Array(16).fill(0x11) },
            { index: 1, name: 'Unset', secret: new Uint8Array(16) },
          ]}
          messages={[
            {
              sender_id: 2,
              sender_name: 'Alice',
              payload: 'Stale channel 1',
              channel: 1,
              timestamp: ts,
              status: 'acked' as const,
            },
          ]}
        />
      </ToastProvider>,
    );

    expect(screen.getByRole('button', { name: 'General' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /General 1/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Unset/ })).not.toBeInTheDocument();
  });

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

  it.each(['meshtastic', 'meshcore'] as const)(
    'keeps unread badge on another channel when isActive becomes true (%s)',
    (protocol) => {
      const ts = Date.now();
      const unreadMsg = {
        sender_id: 2,
        sender_name: 'Alice',
        payload: 'Ops ping',
        channel: 1,
        timestamp: ts,
        status: 'acked' as const,
      };
      const { rerender } = render(
        <ToastProvider>
          <ChatPanel {...baseProps} protocol={protocol} isActive={false} messages={[unreadMsg]} />
        </ToastProvider>,
      );
      expect(screen.getByRole('button', { name: 'Ops 1' })).toBeInTheDocument();

      rerender(
        <ToastProvider>
          <ChatPanel {...baseProps} protocol={protocol} isActive messages={[unreadMsg]} />
        </ToastProvider>,
      );
      expect(screen.getByRole('button', { name: 'Ops 1' })).toBeInTheDocument();
    },
  );

  it.each(['meshtastic', 'meshcore'] as const)(
    'does not advance last-read when isActive toggles on the same view (%s)',
    (protocol) => {
      const ts = Date.now();
      localStorage.removeItem(`mesh-client:lastRead:${protocol}`);
      const unreadMsg = {
        sender_id: 2,
        sender_name: 'Alice',
        payload: 'General ping',
        channel: 0,
        timestamp: ts,
        status: 'acked' as const,
      };
      const { rerender } = render(
        <ToastProvider>
          <ChatPanel {...baseProps} protocol={protocol} isActive={false} messages={[unreadMsg]} />
        </ToastProvider>,
      );

      rerender(
        <ToastProvider>
          <ChatPanel {...baseProps} protocol={protocol} isActive messages={[unreadMsg]} />
        </ToastProvider>,
      );

      const stored = JSON.parse(
        localStorage.getItem(`mesh-client:lastRead:${protocol}`) ?? '{}',
      ) as Record<string, number>;
      expect(stored['ch:0']).toBeUndefined();
    },
  );

  it('does not mark channel read while hidden when a new message arrives on another channel', () => {
    const ts = Date.now();
    const { rerender } = render(
      <ToastProvider>
        <ChatPanel {...baseProps} isActive={false} messages={[]} />
      </ToastProvider>,
    );

    const newMsg = {
      sender_id: 2,
      sender_name: 'Alice',
      payload: 'New while away',
      channel: 1,
      timestamp: ts,
      status: 'acked' as const,
    };
    rerender(
      <ToastProvider>
        <ChatPanel {...baseProps} isActive={false} messages={[newMsg]} />
      </ToastProvider>,
    );
    expect(screen.getByRole('button', { name: 'Ops 1' })).toBeInTheDocument();

    rerender(
      <ToastProvider>
        <ChatPanel {...baseProps} isActive messages={[newMsg]} />
      </ToastProvider>,
    );
    expect(screen.getByRole('button', { name: 'Ops 1' })).toBeInTheDocument();
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
    const ts = 1_781_469_336_193;
    // Seed a stored watermark so the component treats the last message as unread.
    localStorage.setItem(lastReadStorageKey('meshtastic'), JSON.stringify({ 'ch:0': ts - 1000 }));

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

    // Persist runs in a useEffect after setPersistedLastRead — wait for localStorage on slow CI.
    await waitFor(() => {
      const stored = JSON.parse(
        localStorage.getItem(lastReadStorageKey('meshtastic')) ?? '{}',
      ) as Record<string, number>;
      expect(stored['ch:0']).toBe(ts);
    });
  });

  it('marks MeshCore DM read when opened with all messages visible', async () => {
    const user = userEvent.setup();
    const ts = Date.now();
    const selfId = 0x12345678;
    const peerId = 2;
    localStorage.removeItem('mesh-client:lastRead:meshcore');
    const nodes = new Map([
      [
        peerId,
        {
          node_id: peerId,
          long_name: 'Alice',
          short_name: 'Alice',
          hw_model: '',
          snr: 0,
          battery: 0,
          last_heard: ts,
          latitude: null,
          longitude: null,
        },
      ],
    ]);
    render(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          protocol="meshcore"
          myNodeNum={selfId}
          ownNodeIds={[selfId]}
          nodes={nodes}
          messages={[
            {
              sender_id: peerId,
              sender_name: 'Alice',
              payload: 'DM ping',
              channel: -1,
              timestamp: ts,
              status: 'acked',
              to: selfId,
            },
          ]}
        />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Alice' }));

    await waitFor(() => {
      const stored = JSON.parse(
        localStorage.getItem('mesh-client:lastRead:meshcore') ?? '{}',
      ) as Record<string, number>;
      expect(stored[`dm:${peerId}`]).toBe(ts);
    });
  });

  it('marks active MeshCore DM read when a new inbound message arrives near the bottom', async () => {
    const user = userEvent.setup();
    const ts = Date.now();
    const selfId = 0x12345678;
    const peerId = 2;
    localStorage.removeItem('mesh-client:lastRead:meshcore');
    const nodes = new Map([
      [
        peerId,
        {
          node_id: peerId,
          long_name: 'Alice',
          short_name: 'Alice',
          hw_model: '',
          snr: 0,
          battery: 0,
          last_heard: ts,
          latitude: null,
          longitude: null,
        },
      ],
    ]);
    const firstMsg = {
      sender_id: peerId,
      sender_name: 'Alice',
      payload: 'first',
      channel: -1,
      timestamp: ts,
      status: 'acked' as const,
      to: selfId,
    };
    const { rerender } = render(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          protocol="meshcore"
          myNodeNum={selfId}
          ownNodeIds={[selfId]}
          nodes={nodes}
          messages={[firstMsg]}
        />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Alice' }));
    await waitFor(() => {
      expect(screen.getByText('first')).toBeInTheDocument();
    });

    const secondTs = ts + 5000;
    rerender(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          protocol="meshcore"
          myNodeNum={selfId}
          ownNodeIds={[selfId]}
          nodes={nodes}
          messages={[
            firstMsg,
            {
              sender_id: peerId,
              sender_name: 'Alice',
              payload: 'second',
              channel: -1,
              timestamp: secondTs,
              status: 'acked' as const,
              to: selfId,
            },
          ]}
        />
      </ToastProvider>,
    );

    await waitFor(() => {
      const stored = JSON.parse(
        localStorage.getItem('mesh-client:lastRead:meshcore') ?? '{}',
      ) as Record<string, number>;
      expect(stored[`dm:${peerId}`]).toBe(secondTs);
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

  it.each(['meshtastic', 'meshcore'] as const)(
    'shows emoji-picker element on Linux when React button is clicked (%s)',
    async (protocol) => {
      vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
      const user = userEvent.setup();
      render(
        <ToastProvider>
          <ChatPanel {...defaultProps} protocol={protocol} />
        </ToastProvider>,
      );
      const reactBtn = screen.getByTitle('React');
      await user.click(reactBtn);
      await waitFor(() => {
        expect(document.querySelector('emoji-picker')).toBeInTheDocument();
      });
      expect(window.electronAPI.showEmojiPanel).not.toHaveBeenCalled();
    },
  );

  it.each(['meshtastic', 'meshcore'] as const)(
    'calls onReact with full grapheme when Linux emoji-picker fires emoji-click (%s)',
    async (protocol) => {
      const US_FLAG = '\u{1F1FA}\u{1F1F8}';
      const onReact = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(
        <ToastProvider>
          <ChatPanel
            {...defaultProps}
            protocol={protocol}
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
    },
  );

  it.each([
    ['darwin', 'meshtastic'] as const,
    ['darwin', 'meshcore'] as const,
    ['win32', 'meshtastic'] as const,
    ['win32', 'meshcore'] as const,
  ])(
    'calls showEmojiPanel and does not render emoji-picker on %s when React button is clicked (%s)',
    async (platform, protocol) => {
      vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
      const user = userEvent.setup();
      render(
        <ToastProvider>
          <ChatPanel {...defaultProps} protocol={protocol} />
        </ToastProvider>,
      );
      const reactBtn = screen.getByTitle('React');
      await user.click(reactBtn);
      expect(window.electronAPI.showEmojiPanel).toHaveBeenCalledOnce();
      expect(document.querySelector('emoji-picker')).not.toBeInTheDocument();
    },
  );

  function reactionHiddenInput(): HTMLInputElement {
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-hidden="true"][tabindex="-1"]',
    );
    expect(input).not.toBeNull();
    return input!;
  }

  function composeTextarea(): HTMLTextAreaElement {
    return screen.getByPlaceholderText('Enter message here');
  }

  it.each(['linux', 'darwin', 'win32'] as const)(
    'clears replyTo when React is clicked (%s)',
    async (platform) => {
      vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
      const user = userEvent.setup();
      render(
        <ToastProvider>
          <ChatPanel {...defaultProps} />
        </ToastProvider>,
      );
      await user.click(screen.getByTitle('Reply'));
      expect(screen.getByText(/Replying to/)).toBeInTheDocument();
      await user.click(screen.getByTitle('React'));
      expect(screen.queryByText(/Replying to/)).not.toBeInTheDocument();
    },
  );

  it.each(['darwin', 'win32'] as const)(
    'calls onReact when native panel inserts emoji into hidden input (%s)',
    async (platform) => {
      vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
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
      const hidden = reactionHiddenInput();
      hidden.value = '👍';
      fireEvent.input(hidden);
      await waitFor(() => {
        expect(onReact).toHaveBeenCalledWith('👍', 42, 0);
      });
      expect(onReact).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['darwin', 'win32'] as const)(
    'refocuses composer after native emoji reaction (%s)',
    async (platform) => {
      vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
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
      const hidden = reactionHiddenInput();
      hidden.value = '👍';
      fireEvent.input(hidden);
      await waitFor(() => {
        expect(onReact).toHaveBeenCalledWith('👍', 42, 0);
      });
      expect(composeTextarea()).toBe(document.activeElement);
    },
  );

  it.each(['darwin', 'win32'] as const)(
    'does not send plain keystrokes as reactions after emoji reaction (%s)',
    async (platform) => {
      vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
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
      const hidden = reactionHiddenInput();
      hidden.value = '👍';
      fireEvent.input(hidden);
      await waitFor(() => {
        expect(onReact).toHaveBeenCalledWith('👍', 42, 0);
      });
      hidden.value = 'j';
      fireEvent.input(hidden);
      await waitFor(() => {
        expect(onReact).toHaveBeenCalledTimes(1);
      });
    },
  );

  it.each(['darwin', 'win32'] as const)(
    'redirects printable keys from hidden input to composer while capture is pending (%s)',
    async (platform) => {
      vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
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
      const hidden = reactionHiddenInput();
      fireEvent.keyDown(hidden, { key: 'g' });
      await waitFor(() => {
        expect(onReact).not.toHaveBeenCalled();
        expect(composeTextarea()).toHaveValue('g');
        expect(composeTextarea()).toBe(document.activeElement);
      });
    },
  );

  it.each(['darwin', 'win32'] as const)(
    'clears capture on window focus and refocuses composer (%s)',
    async (platform) => {
      vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
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
      fireEvent.focus(window);
      const hidden = reactionHiddenInput();
      hidden.value = 'a';
      fireEvent.input(hidden);
      await waitFor(() => {
        expect(onReact).not.toHaveBeenCalled();
        expect(composeTextarea()).toBe(document.activeElement);
      });
    },
  );

  it('does not send keystrokes as reactions after dismissing native panel without selection', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('win32');
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
    const hidden = reactionHiddenInput();
    fireEvent.blur(hidden);
    hidden.value = 'a';
    fireEvent.input(hidden);
    await waitFor(() => {
      expect(onReact).not.toHaveBeenCalled();
    });
  });

  it('does not send a second Linux emoji-click after reaction without re-opening React', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
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
    picker!.dispatchEvent(
      new CustomEvent('emoji-click', { detail: { emoji: { unicode: '👍' } }, bubbles: true }),
    );
    await waitFor(() => {
      expect(onReact).toHaveBeenCalledTimes(1);
    });
  });

  it('clears Linux capture on window focus while inline picker is open', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
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
    fireEvent.focus(window);
    const picker = document.querySelector('emoji-picker');
    expect(picker).not.toBeNull();
    picker!.dispatchEvent(
      new CustomEvent('emoji-click', { detail: { emoji: { unicode: '👍' } }, bubbles: true }),
    );
    await waitFor(() => {
      expect(onReact).not.toHaveBeenCalled();
      expect(composeTextarea()).toBe(document.activeElement);
    });
  });
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

  it('scrolls to matching day via scrollToIndex, not scrollIntoView', async () => {
    mockScrollToIndex.mockClear();
    const scrollIntoView = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(scrollIntoView);
    const day = new Date(2026, 5, 10, 14, 0, 0);
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ChatPanel
          {...baseProps}
          messages={[
            {
              sender_id: 2,
              sender_name: 'Alice',
              payload: 'June tenth',
              channel: 0,
              timestamp: day.getTime(),
              status: 'acked',
            },
          ]}
        />
      </ToastProvider>,
    );
    await user.click(screen.getByLabelText('Jump to date'));
    const input = screen.getByLabelText('Jump to date', { selector: 'input' });
    fireEvent.change(input, { target: { value: '2026-06-10' } });
    expect(mockScrollToIndex).toHaveBeenCalledWith(0, { align: 'start', behavior: 'smooth' });
    expect(scrollIntoView).not.toHaveBeenCalled();
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

    const textarea = await waitForComposer();
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

    await waitForComposer();
    expect(playMock).not.toHaveBeenCalled();
  });

  it('does not play sound when not on the chat panel (App owns that case)', async () => {
    const { rerender } = render(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={[]} isActive={false} />
      </ToastProvider>,
    );

    await waitForComposer();
    playMock.mockClear();

    const newMsg = makeMsg({ sender_id: 2, channel: 0, isHistory: undefined });
    rerender(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={[newMsg]} isActive={false} />
      </ToastProvider>,
    );

    await waitForComposer();
    expect(playMock).not.toHaveBeenCalled();
  });

  it('plays channel sound when active on a different channel view', async () => {
    const { rerender } = render(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={[]} isActive />
      </ToastProvider>,
    );

    await waitForComposer();
    playMock.mockClear();

    const newMsg = makeMsg({ sender_id: 2, channel: 1, isHistory: undefined });
    rerender(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={[newMsg]} isActive />
      </ToastProvider>,
    );

    await waitForComposer();
    expect(playMock).toHaveBeenCalledOnce();
    expect(playMock).toHaveBeenCalledWith('channel');
  });

  it('plays dm sound for incoming direct messages on another view', async () => {
    const { rerender } = render(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={[]} isActive />
      </ToastProvider>,
    );

    await waitForComposer();
    playMock.mockClear();

    const newMsg = makeMsg({ sender_id: 2, to: 1, channel: 0, isHistory: undefined });
    rerender(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={[newMsg]} isActive />
      </ToastProvider>,
    );

    await waitForComposer();
    expect(playMock).toHaveBeenCalledOnce();
    expect(playMock).toHaveBeenCalledWith('dm');
  });

  it('plays reply sound when a reply targets your message on another view', async () => {
    const user = userEvent.setup();
    const parent = makeMsg({ sender_id: 1, channel: 0, packetId: 100, timestamp: 500 });
    const { rerender } = render(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={[parent]} isActive />
      </ToastProvider>,
    );

    await waitForComposer();
    const channelButtons = screen.getAllByRole('button', { name: /General|Admin|ch0|ch1/i });
    const adminBtn = channelButtons.find((b) => /Admin|ch1|1/i.test(b.textContent ?? ''));
    expect(adminBtn).toBeDefined();
    await user.click(adminBtn!);
    playMock.mockClear();

    const reply = makeMsg({ sender_id: 2, channel: 0, replyId: 100, timestamp: 1000 });
    rerender(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={[parent, reply]} isActive />
      </ToastProvider>,
    );

    await waitForComposer();
    expect(playMock).toHaveBeenCalledOnce();
    expect(playMock).toHaveBeenCalledWith('reply');
  });

  it('does not play sound when notifMuted=1 in localStorage (global setting from AppPanel)', async () => {
    localStorage.setItem('mesh-client:notifMuted', '1');

    const { rerender } = render(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={[]} isActive={false} />
      </ToastProvider>,
    );

    await waitForComposer();
    playMock.mockClear();

    const newMsg = makeMsg({ sender_id: 2, channel: 0, isHistory: undefined });
    rerender(
      <ToastProvider>
        <ChatPanel {...baseProps} messages={[newMsg]} isActive={false} />
      </ToastProvider>,
    );

    await waitForComposer();
    expect(playMock).not.toHaveBeenCalled();
  });
});

describe('ChatPanel reticulum dm-only chat', () => {
  const reticulumProps = {
    messages: [] as ChatMessage[],
    channels: [{ index: 0, name: 'General' }],
    myNodeNum: 1,
    onSend: vi.fn().mockResolvedValue(undefined),
    onReact: vi.fn().mockResolvedValue(undefined),
    onResend: vi.fn(),
    onNodeClick: vi.fn(),
    isConnected: true,
    nodes: new Map<number, MeshNode>(),
    isActive: true,
    protocol: 'reticulum' as const,
    dmOnlyChat: true,
  };

  it('lists LXMF contacts as DM tabs and sends to auto-selected peer', async () => {
    const user = userEvent.setup();
    const peerId = 0xabc123;
    const onSend = vi.fn().mockResolvedValue(undefined);
    const nodes = new Map<number, MeshNode>([
      [
        peerId,
        {
          node_id: peerId,
          reticulum_destination_hash: 'deadbeef',
          long_name: 'Peer One',
          short_name: 'P1',
          hw_model: 'Reticulum',
          snr: 0,
          battery: 0,
          last_heard: Date.now(),
          latitude: null,
          longitude: null,
          favorited: false,
          source: 'rf',
        },
      ],
    ]);
    render(
      <ToastProvider>
        <ChatPanel {...reticulumProps} nodes={nodes} onSend={onSend} />
      </ToastProvider>,
    );
    expect(screen.getByRole('button', { name: 'Peer One' })).toBeInTheDocument();
    const input = await waitForComposer();
    await user.type(input, 'hello');
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('hello', 0, peerId, undefined);
    });
  });

  it('prompts to select a DM when no contacts are known', async () => {
    render(
      <ToastProvider>
        <ChatPanel {...reticulumProps} />
      </ToastProvider>,
    );
    expect(
      screen.getByText('No conversations yet — open a contact from the Nodes tab.'),
    ).toBeInTheDocument();
    const input = await waitForComposer();
    expect(input).toBeDisabled();
    expect(
      screen.getByPlaceholderText('Select a contact above to start a DM…'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Reticulum chat is direct message only. Pick a contact above or open one from the Nodes tab.',
      ),
    ).toBeInTheDocument();
  });
});
