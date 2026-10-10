import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { activeDmStorageKey, openDmTabsStorageKey } from '../lib/chatPanelProtocolStorage';
import { useRelayCoverageStore } from '../lib/relayCoverage/relayCoverageStore';
import { useMessageStore } from '../stores/messageStore';
import ChatPanel from './ChatPanel';
import { RelayCoverageLine } from './RelayCoverageLine';
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
    for (const protocol of ['meshtastic', 'meshcore'] as const) {
      localStorage.removeItem(openDmTabsStorageKey(protocol));
      localStorage.removeItem(activeDmStorageKey(protocol));
    }
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

  it('renders MeshCore additional unidentified forwarders in tooltip', () => {
    useRelayCoverageStore.getState().set(IDENTITY, MSG, {
      protocol: 'meshcore',
      mode: 'confirmed',
      heardRepeaters: [
        { nodeId: 1, name: 'NamedRep' },
        { nodeId: -1234567890, name: '0647' },
      ],
    });
    render(<RelayCoverageLine protocol="meshcore" messageId={MSG} isOwn identityId={IDENTITY} />);
    expect(screen.getByText('Heard by 2')).toBeInTheDocument();
    expect(screen.getByLabelText(/additional unidentified forwarder.*0647/i)).toBeInTheDocument();
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
    expect(screen.getByText('Not heard (timeout)')).toHaveClass('text-orange-400');
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
      <div className="bg-ink-900 p-2 text-white">
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

  it('prefers MeshCore device status badge over MQTT when both are set', () => {
    const now = Date.now();
    render(
      <ToastProvider>
        <ChatPanel
          messages={[
            {
              storeId: 'mc-status-vs-mqtt',
              sender_id: 7,
              sender_name: 'Me',
              payload: 'status check',
              channel: 0,
              timestamp: now,
              status: 'acked',
              mqttStatus: 'acked',
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
          connectionType="ble"
        />
      </ToastProvider>,
    );
    expect(screen.getByLabelText(/Device:.*delivered/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/MQTT:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^MQTT /)).not.toBeInTheDocument();
  });
});
