import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { useRelayCoverageStore } from '../lib/relayCoverage/relayCoverageStore';
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
  });

  it('renders MeshCore singular heard-by with name and SNR in aria', () => {
    useRelayCoverageStore.getState().set(IDENTITY, MSG, {
      protocol: 'meshcore',
      mode: 'confirmed',
      heardRepeaters: [{ nodeId: 1, name: 'Hilltop', snr: 4.5 }],
    });
    render(<RelayCoverageLine protocol="meshcore" messageId={MSG} isOwn identityId={IDENTITY} />);
    expect(screen.getByText('Heard by 1 repeater')).toBeInTheDocument();
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
    expect(screen.getByText('Heard by 2 repeaters')).toBeInTheDocument();
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
        />
      </ToastProvider>,
    );
    expect(screen.getByText('hello channel')).toBeInTheDocument();
    expect(screen.getByText('Heard by network')).toBeInTheDocument();
  });
});
