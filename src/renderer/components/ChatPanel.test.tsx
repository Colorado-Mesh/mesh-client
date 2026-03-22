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

  it('shows role="alert" when onSend rejects', async () => {
    const user = userEvent.setup();
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
