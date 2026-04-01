import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type { MeshNode } from '../lib/types';
import ChatPanel from './ChatPanel';
import { ToastProvider } from './Toast';

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
    const results = await axe(container);
    expect(results).toHaveNoViolations();
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
    // Open picker for the second message
    const reactButtons = screen.getAllByTitle('React');
    await user.click(reactButtons[1]);
    // Picker should be visible — emoji buttons are titled 'Like', 'Love', etc.
    expect(screen.getByTitle('Like')).toBeInTheDocument();
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

  it('hides RF-only transport badge in MeshCore mode (RF is the default path)', () => {
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
    expect(screen.queryByTitle('Received via RF')).not.toBeInTheDocument();
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
    expect(screen.getByText('Private hello')).toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: 'Alice' })).not.toBeInTheDocument();

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
    expect(screen.queryByRole('button', { name: 'Alice' })).not.toBeInTheDocument();

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

  it('shows role="alert" when onSend rejects', async () => {
    const user = userEvent.setup();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onSend = vi.fn().mockRejectedValue(new Error('send failed'));
    render(
      <ToastProvider>
        <ChatPanel {...defaultProps} isConnected onSend={onSend} />
      </ToastProvider>,
    );
    const input = screen.getByPlaceholderText('Type a message...');
    await user.type(input, 'hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('send failed');
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ChatPanel]'),
      expect.any(Error),
    );
    consoleErrorSpy.mockRestore();
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
    await user.hover(badge as HTMLElement);
    const tooltip = document.querySelector('.pointer-events-none');
    expect(tooltip?.textContent?.trim()).toBeTruthy();
  });
});
