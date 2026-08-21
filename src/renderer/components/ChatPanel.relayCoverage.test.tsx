import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { activeDmStorageKey, openDmTabsStorageKey } from '../lib/chatPanelProtocolStorage';
import { useRelayCoverageStore } from '../lib/relayCoverage/relayCoverageStore';
import { addMessage, renameMessageId, useMessageStore } from '../stores/messageStore';
import ChatPanel from './ChatPanel';
import { RelayCoverageLine, relayCoverageMessageKey } from './RelayCoverageLine';
import { ToastProvider } from './Toast';

const IDENTITY = 'relay-cov-test-id';
const MSG = 'msg-coverage-1';

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

describe('RelayCoverageLine / ChatPanel.relayCoverage', () => {
  beforeEach(() => {
    useRelayCoverageStore.setState({ coverage: {} });
    useMessageStore.setState({ messages: {} });
    // ChatPanel persists DM tabs/active peer in localStorage; clear so prior DM-only tests
    // (e.g. axe Reticulum) do not leave the wrong conversation selected.
    for (const protocol of ['meshtastic', 'meshcore', 'reticulum'] as const) {
      localStorage.removeItem(openDmTabsStorageKey(protocol));
      localStorage.removeItem(activeDmStorageKey(protocol));
    }
  });

  it('relayCoverageMessageKey prefers storeId then reticulum hash then id then packetId', () => {
    expect(
      relayCoverageMessageKey({
        storeId: 'store-1',
        reticulum_message_hash: 'hash',
        id: 9,
        packetId: 8,
      } as never),
    ).toBe('store-1');
    expect(
      relayCoverageMessageKey({
        reticulum_message_hash: 'hash',
        id: 9,
        packetId: 8,
      } as never),
    ).toBe('hash');
    expect(relayCoverageMessageKey({ id: 9, packetId: 8 } as never)).toBe('9');
    expect(relayCoverageMessageKey({ packetId: 8 } as never)).toBe('8');
    expect(relayCoverageMessageKey({} as never)).toBeUndefined();
  });

  it('ignores coverage when store protocol does not match UI protocol', () => {
    useRelayCoverageStore.getState().set(IDENTITY, MSG, {
      protocol: 'meshcore',
      mode: 'confirmed',
      heardRepeaters: [{ nodeId: 1, name: 'Hilltop' }],
    });
    const { container } = render(
      <RelayCoverageLine protocol="meshtastic" messageId={MSG} isOwn identityId={IDENTITY} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders MeshCore singular heard-by with name and SNR in aria', () => {
    useRelayCoverageStore.getState().set(IDENTITY, MSG, {
      protocol: 'meshcore',
      mode: 'confirmed',
      heardRepeaters: [{ nodeId: 1, name: 'Hilltop', snr: 4.5 }],
    });
    render(<RelayCoverageLine protocol="meshcore" messageId={MSG} isOwn identityId={IDENTITY} />);
    expect(screen.getByText('Heard by 1')).toBeInTheDocument();
    expect(screen.getByLabelText(/Hilltop \(4\.5 dB\)/)).toBeInTheDocument();
  });

  it('renders MeshCore plural heard-by with names in aria', () => {
    useRelayCoverageStore.getState().set(IDENTITY, MSG, {
      protocol: 'meshcore',
      mode: 'confirmed',
      heardRepeaters: [
        { nodeId: 1, name: 'Alpha' },
        { nodeId: 2, name: 'Beta' },
      ],
    });
    render(<RelayCoverageLine protocol="meshcore" messageId={MSG} isOwn identityId={IDENTITY} />);
    expect(screen.getByText('Heard by 2')).toBeInTheDocument();
    expect(screen.getByLabelText(/Alpha.*Beta/)).toBeInTheDocument();
  });

  it('hides MeshCore line when heardRepeaters empty', () => {
    useRelayCoverageStore.getState().set(IDENTITY, MSG, {
      protocol: 'meshcore',
      mode: 'confirmed',
      heardRepeaters: [],
    });
    const { container } = render(
      <RelayCoverageLine protocol="meshcore" messageId={MSG} isOwn identityId={IDENTITY} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders Meshtastic heard-by network', () => {
    useRelayCoverageStore.getState().set(IDENTITY, MSG, {
      protocol: 'meshtastic',
      mode: 'binary-heard',
      broadcastHeard: true,
    });
    render(<RelayCoverageLine protocol="meshtastic" messageId={MSG} isOwn identityId={IDENTITY} />);
    expect(screen.getByText('Heard by network')).toHaveClass('text-green-400');
  });

  it('renders Meshtastic not-heard timeout', () => {
    useRelayCoverageStore.getState().set(IDENTITY, MSG, {
      protocol: 'meshtastic',
      mode: 'binary-heard',
      broadcastHeard: false,
    });
    render(<RelayCoverageLine protocol="meshtastic" messageId={MSG} isOwn identityId={IDENTITY} />);
    expect(screen.getByText('Not heard (timeout)')).toHaveClass('text-amber-400');
  });

  it('hides Meshtastic line while pending (null)', () => {
    useRelayCoverageStore.getState().set(IDENTITY, MSG, {
      protocol: 'meshtastic',
      mode: 'binary-heard',
      broadcastHeard: null,
    });
    const { container } = render(
      <RelayCoverageLine protocol="meshtastic" messageId={MSG} isOwn identityId={IDENTITY} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders Reticulum predicted route with truncated hop', () => {
    useRelayCoverageStore.getState().set(IDENTITY, MSG, {
      protocol: 'reticulum',
      mode: 'predicted',
      predictedRelayHops: 3,
      predictedFirstHop: 'abcdef0123456789',
    });
    render(<RelayCoverageLine protocol="reticulum" messageId={MSG} isOwn identityId={IDENTITY} />);
    expect(screen.getByText(/Route: ~3 relays via abcdef/)).toBeInTheDocument();
    expect(screen.getByLabelText(/abcdef/)).toBeInTheDocument();
  });

  it('renders Reticulum hops-only route when via is missing', () => {
    useRelayCoverageStore.getState().set(IDENTITY, MSG, {
      protocol: 'reticulum',
      mode: 'predicted',
      predictedRelayHops: 2,
    });
    render(<RelayCoverageLine protocol="reticulum" messageId={MSG} isOwn identityId={IDENTITY} />);
    expect(screen.getByText('Route: ~2 relays')).toBeInTheDocument();
    expect(screen.queryByText(/via$/)).not.toBeInTheDocument();
  });

  it('still shows Reticulum route after pending→hash renameMessageId', () => {
    const pending = 'reticulum-pending-ui';
    const hash = 'ee'.repeat(32);
    addMessage(IDENTITY, {
      id: pending,
      from: 1,
      senderName: 'Me',
      to: 2,
      payload: 'hi',
      channelIndex: 0,
      timestamp: 1,
      status: 'sending',
    });
    useRelayCoverageStore.getState().set(IDENTITY, pending, {
      protocol: 'reticulum',
      mode: 'predicted',
      predictedRelayHops: 2,
      predictedFirstHop: 'abcdef0123456789',
    });
    renameMessageId(IDENTITY, pending, hash);

    render(<RelayCoverageLine protocol="reticulum" messageId={hash} isOwn identityId={IDENTITY} />);
    expect(screen.getByText(/Route: ~2 relays via abcdef/)).toBeInTheDocument();
  });

  it('uses identityId prop when getIdentityIdForProtocol points elsewhere', () => {
    const otherId = 'focused-meshcore-id';
    useRelayCoverageStore.getState().set(otherId, MSG, {
      protocol: 'meshcore',
      mode: 'confirmed',
      heardRepeaters: [{ nodeId: 9, name: 'FocusedRep' }],
    });
    // Mock returns IDENTITY; coverage lives under otherId — prop must win.
    const { rerender } = render(
      <RelayCoverageLine protocol="meshcore" messageId={MSG} isOwn identityId={otherId} />,
    );
    expect(screen.getByText('Heard by 1')).toBeInTheDocument();
    rerender(<RelayCoverageLine protocol="meshcore" messageId={MSG} isOwn />);
    expect(screen.queryByText('Heard by 1')).not.toBeInTheDocument();
  });

  it('hides Reticulum line when hops and via are both missing', () => {
    useRelayCoverageStore.getState().set(IDENTITY, MSG, {
      protocol: 'reticulum',
      mode: 'predicted',
    });
    const { container } = render(
      <RelayCoverageLine protocol="reticulum" messageId={MSG} isOwn identityId={IDENTITY} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders Reticulum via-only route when hops are unknown', () => {
    useRelayCoverageStore.getState().set(IDENTITY, MSG, {
      protocol: 'reticulum',
      mode: 'predicted',
      predictedFirstHop: 'abcdef0123456789',
    });
    render(<RelayCoverageLine protocol="reticulum" messageId={MSG} isOwn identityId={IDENTITY} />);
    expect(screen.getByText(/Route: via abcdef/)).toBeInTheDocument();
  });

  it('hides coverage on incoming messages even when seeded', () => {
    useRelayCoverageStore.getState().set(IDENTITY, MSG, {
      protocol: 'meshcore',
      mode: 'confirmed',
      heardRepeaters: [{ nodeId: 1, name: 'X' }],
    });
    const { container } = render(
      <RelayCoverageLine protocol="meshcore" messageId={MSG} isOwn={false} identityId={IDENTITY} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('has no axe violations for MeshCore coverage line', async () => {
    useRelayCoverageStore.getState().set(IDENTITY, MSG, {
      protocol: 'meshcore',
      mode: 'confirmed',
      heardRepeaters: [{ nodeId: 1, name: 'Hilltop', snr: 4.5 }],
    });
    const { container } = render(
      <div className="bg-slate-900 p-2 text-white">
        <RelayCoverageLine protocol="meshcore" messageId={MSG} isOwn identityId={IDENTITY} />
      </div>,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no axe violations for Meshtastic amber timeout in ChatPanel bubble context', async () => {
    const now = Date.now();
    useRelayCoverageStore.getState().set(IDENTITY, '42', {
      protocol: 'meshtastic',
      mode: 'binary-heard',
      broadcastHeard: false,
    });
    const { container } = render(
      <ToastProvider>
        <ChatPanel
          messages={[
            {
              id: 42,
              packetId: 42,
              storeId: '42',
              sender_id: 7,
              sender_name: 'Me',
              payload: 'timeout bubble',
              channel: 0,
              timestamp: now,
              status: 'failed',
            },
          ]}
          channels={[{ index: 0, name: 'General' }]}
          myNodeNum={7}
          onSend={vi.fn()}
          onReact={vi.fn().mockResolvedValue(undefined)}
          onResend={vi.fn()}
          onNodeClick={vi.fn()}
          isConnected
          nodes={new Map()}
          isActive
          protocol="meshtastic"
          identityId={IDENTITY}
        />
      </ToastProvider>,
    );
    expect(screen.getByText('Not heard (timeout)')).toBeInTheDocument();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no axe violations for Reticulum cyan route in ChatPanel bubble context', async () => {
    const storeId = 'reticulum-axe-route';
    const now = Date.now();
    useRelayCoverageStore.getState().set(IDENTITY, storeId, {
      protocol: 'reticulum',
      mode: 'predicted',
      predictedRelayHops: 2,
      predictedFirstHop: 'abcdef0123456789',
    });
    const { container } = render(
      <ToastProvider>
        <ChatPanel
          messages={[
            {
              storeId,
              sender_id: 1,
              sender_name: 'Me',
              payload: 'route bubble',
              channel: -1,
              timestamp: now,
              status: 'sending',
              to: 99,
            },
          ]}
          channels={[]}
          myNodeNum={1}
          onSend={vi.fn()}
          onReact={vi.fn().mockResolvedValue(undefined)}
          onResend={vi.fn()}
          onNodeClick={vi.fn()}
          isConnected
          nodes={new Map()}
          isActive
          protocol="reticulum"
          identityId={IDENTITY}
          dmOnlyChat
        />
      </ToastProvider>,
    );
    expect(screen.getByText(/Route:/i)).toBeInTheDocument();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows coverage inside ChatPanel own-message status row', () => {
    const now = Date.now();
    useRelayCoverageStore.getState().set(IDENTITY, '42', {
      protocol: 'meshtastic',
      mode: 'binary-heard',
      broadcastHeard: true,
    });
    render(
      <ToastProvider>
        <ChatPanel
          messages={[
            {
              id: 42,
              packetId: 42,
              storeId: '42',
              sender_id: 7,
              sender_name: 'Me',
              payload: 'hello channel',
              channel: 0,
              timestamp: now,
              status: 'acked',
            },
          ]}
          channels={[{ index: 0, name: 'General' }]}
          myNodeNum={7}
          onSend={vi.fn()}
          onReact={vi.fn().mockResolvedValue(undefined)}
          onResend={vi.fn()}
          onNodeClick={vi.fn()}
          isConnected
          nodes={new Map()}
          isActive
          protocol="meshtastic"
          identityId={IDENTITY}
        />
      </ToastProvider>,
    );
    expect(screen.getByText('hello channel')).toBeInTheDocument();
    expect(screen.getByText('Heard by network')).toBeInTheDocument();
  });

  it('shows Reticulum hops-only coverage inside ChatPanel status row', () => {
    const storeId = 'reticulum-pending-chat';
    const now = Date.now();
    useRelayCoverageStore.getState().set(IDENTITY, storeId, {
      protocol: 'reticulum',
      mode: 'predicted',
      predictedRelayHops: 2,
    });
    render(
      <ToastProvider>
        <ChatPanel
          messages={[
            {
              storeId,
              sender_id: 1,
              sender_name: 'Me',
              payload: 'rns dm',
              channel: -1,
              timestamp: now,
              status: 'sending',
              to: 2,
            },
          ]}
          channels={[]}
          myNodeNum={1}
          onSend={vi.fn()}
          onReact={vi.fn().mockResolvedValue(undefined)}
          onResend={vi.fn()}
          onNodeClick={vi.fn()}
          isConnected
          nodes={new Map()}
          isActive
          protocol="reticulum"
          identityId={IDENTITY}
          dmOnlyChat
          showLxmfDeliveryStatus
        />
      </ToastProvider>,
    );
    expect(screen.getByText('Route: ~2 relays')).toBeInTheDocument();
  });

  it('shows MeshCore heard-by inside ChatPanel status row', () => {
    const storeId = 'ch:0:1700000000';
    const now = Date.now();
    useRelayCoverageStore.getState().set(IDENTITY, storeId, {
      protocol: 'meshcore',
      mode: 'confirmed',
      heardRepeaters: [{ nodeId: 3, name: 'Hilltop', snr: 2 }],
    });
    render(
      <ToastProvider>
        <ChatPanel
          messages={[
            {
              storeId,
              sender_id: 7,
              sender_name: 'Me',
              payload: 'mc channel',
              channel: 0,
              timestamp: now,
              status: 'acked',
            },
          ]}
          channels={[{ index: 0, name: 'Public' }]}
          myNodeNum={7}
          onSend={vi.fn()}
          onReact={vi.fn().mockResolvedValue(undefined)}
          onResend={vi.fn()}
          onNodeClick={vi.fn()}
          isConnected
          nodes={new Map()}
          isActive
          protocol="meshcore"
          identityId={IDENTITY}
        />
      </ToastProvider>,
    );
    expect(screen.getByText('Heard by 1')).toBeInTheDocument();
  });
});
