import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { meshcoreStoredUserMessage } from '../lib/meshcore/meshcoreMessageI18n';
import type { MeshNode } from '../lib/types';
import { computePathHash, usePathHistoryStore } from '../stores/pathHistoryStore';
import RepeatersPanel from './RepeatersPanel';

const mockAddToast = vi.fn();
const VIRTUALIZER_VISIBLE_CAP = 3;

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: Record<string, unknown> & { count: number; enabled?: boolean }) => {
    const enabled = opts.enabled !== false;
    const total = opts.count;
    const visible = enabled && total > 100 ? Math.min(total, VIRTUALIZER_VISIBLE_CAP) : total;
    return {
      getVirtualItems: () =>
        Array.from({ length: visible }, (_, index) => ({
          index,
          start: index * 48,
          end: (index + 1) * 48,
          size: 48,
          key: index,
          lane: 0,
        })),
      getTotalSize: () => total * 48,
      measureElement: vi.fn(),
      measure: vi.fn(),
    };
  },
}));

vi.mock('./Toast', () => ({
  useToast: () => ({
    addToast: mockAddToast,
  }),
}));

vi.mock('../hooks/useMeshcoreRepeaterRemoteAuth', () => ({
  useMeshcoreRepeaterRemoteAuth: () => ({
    ensureRepeaterAuth: vi.fn().mockResolvedValue({ ok: true }),
    promptRepeaterPassword: vi.fn().mockResolvedValue({ ok: true, saved: true }),
    RemoteAuthModal: null,
  }),
}));

function mockRepeaterNode(id: number): MeshNode {
  return {
    node_id: id,
    long_name: 'Test Repeater',
    short_name: 'TR',
    hw_model: 'Repeater',
    snr: 2,
    battery: 100,
    last_heard: Math.floor(Date.now() / 1000),
    latitude: null,
    longitude: null,
  };
}

const repeater = mockRepeaterNode(0xabc);

function mockRepeaterNodeWithFavorited(id: number, favorited: boolean): MeshNode {
  return {
    node_id: id,
    long_name: `Repeater ${id.toString(16)}`,
    short_name: 'TR',
    hw_model: 'Repeater',
    snr: 2,
    battery: 100,
    last_heard: Math.floor(Date.now() / 1000),
    latitude: null,
    longitude: null,
    favorited,
  };
}

function makeBaseProps(): ComponentProps<typeof RepeatersPanel> {
  return {
    nodes: new Map([[repeater.node_id, repeater]]),
    meshcoreNodeStatus: new Map(),
    meshcoreTraceResults: new Map(),
    onRequestRepeaterStatus: vi.fn().mockResolvedValue(undefined),
    onPing: vi.fn().mockResolvedValue(undefined),
    onDeleteRepeater: vi.fn().mockResolvedValue(undefined),
    isConnected: true,
  };
}

describe('RepeatersPanel', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    usePathHistoryStore.setState({ records: new Map(), lruOrder: [] });
  });

  afterEach(() => {
    warnSpy.mockClear();
  });
  it('shows CLI interface button when onSendCliCommand is provided and connected', async () => {
    const { container } = render(
      <RepeatersPanel {...makeBaseProps()} onSendCliCommand={vi.fn().mockResolvedValue('ok')} />,
    );
    expect(screen.getByRole('button', { name: 'CLI interface' })).toBeInTheDocument();
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('hides CLI interface button when onSendCliCommand is omitted', async () => {
    const { container } = render(<RepeatersPanel {...makeBaseProps()} />);
    expect(screen.queryByRole('button', { name: 'CLI interface' })).not.toBeInTheDocument();
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('shows error toast when requestRepeaterStatus fails', async () => {
    const props = makeBaseProps();
    props.onRequestRepeaterStatus = vi.fn().mockRejectedValue(new Error('radio timeout'));

    render(<RepeatersPanel {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Request status' }));

    expect(warnSpy).toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('radio timeout'), 'error');
  });

  it('shows error toast when requestNeighbors fails', async () => {
    const props = makeBaseProps();
    props.onRequestNeighbors = vi.fn().mockRejectedValue(new Error('neighbors timeout'));

    render(<RepeatersPanel {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Repeater neighbors' }));

    expect(warnSpy).toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.stringContaining('neighbors timeout'),
      'error',
    );
  });

  it('requests next neighbors page with offset on Load more', async () => {
    const onRequestNeighbors = vi.fn().mockResolvedValue(undefined);
    const meshcoreNeighbors = new Map([
      [
        repeater.node_id,
        {
          totalNeighboursCount: 60,
          neighbours: Array.from({ length: 50 }, (_, i) => ({
            publicKeyPrefix: new Uint8Array(6),
            prefixHex: i.toString(16).padStart(12, '0'),
            resolvedNodeId: 0,
            heardSecondsAgo: 1,
            snr: 2,
          })),
          fetchedAt: Date.now(),
        },
      ],
    ]);

    render(
      <RepeatersPanel
        {...makeBaseProps()}
        onRequestNeighbors={onRequestNeighbors}
        meshcoreNeighbors={meshcoreNeighbors}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Repeater neighbors' }));
    expect(onRequestNeighbors).toHaveBeenCalledWith(repeater.node_id);

    const loadMore = await screen.findByRole('button', {
      name: 'Load more neighbors (50 of 60 loaded)',
    });
    await userEvent.click(loadMore);
    expect(onRequestNeighbors).toHaveBeenCalledWith(repeater.node_id, { offset: 50 });
  });

  it('hides Load more when all neighbors are already loaded', async () => {
    const onRequestNeighbors = vi.fn().mockResolvedValue(undefined);
    const meshcoreNeighbors = new Map([
      [
        repeater.node_id,
        {
          totalNeighboursCount: 3,
          neighbours: Array.from({ length: 3 }, (_, i) => ({
            publicKeyPrefix: new Uint8Array(6),
            prefixHex: i.toString(16).padStart(12, '0'),
            resolvedNodeId: 0,
            heardSecondsAgo: 1,
            snr: 2,
          })),
          fetchedAt: Date.now(),
        },
      ],
    ]);

    render(
      <RepeatersPanel
        {...makeBaseProps()}
        onRequestNeighbors={onRequestNeighbors}
        meshcoreNeighbors={meshcoreNeighbors}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Repeater neighbors' }));
    expect(screen.queryByRole('button', { name: /Load more neighbors/i })).not.toBeInTheDocument();
  });

  it('shows error toast when Load more neighbors fails', async () => {
    const onRequestNeighbors = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('neighbors timeout'));
    const meshcoreNeighbors = new Map([
      [
        repeater.node_id,
        {
          totalNeighboursCount: 60,
          neighbours: Array.from({ length: 50 }, (_, i) => ({
            publicKeyPrefix: new Uint8Array(6),
            prefixHex: i.toString(16).padStart(12, '0'),
            resolvedNodeId: 0,
            heardSecondsAgo: 1,
            snr: 2,
          })),
          fetchedAt: Date.now(),
        },
      ],
    ]);

    render(
      <RepeatersPanel
        {...makeBaseProps()}
        onRequestNeighbors={onRequestNeighbors}
        meshcoreNeighbors={meshcoreNeighbors}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Repeater neighbors' }));
    const loadMore = await screen.findByRole('button', {
      name: 'Load more neighbors (50 of 60 loaded)',
    });
    await userEvent.click(loadMore);
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.stringContaining('neighbors timeout'),
        'error',
      );
    });
  });

  it('disables Load more while neighbors RPC is pending', async () => {
    const onRequestNeighbors = vi.fn().mockResolvedValue(undefined);
    const meshcoreNeighbors = new Map([
      [
        repeater.node_id,
        {
          totalNeighboursCount: 60,
          neighbours: Array.from({ length: 50 }, (_, i) => ({
            publicKeyPrefix: new Uint8Array(6),
            prefixHex: i.toString(16).padStart(12, '0'),
            resolvedNodeId: 0,
            heardSecondsAgo: 1,
            snr: 2,
          })),
          fetchedAt: Date.now(),
        },
      ],
    ]);
    const base = {
      ...makeBaseProps(),
      onRequestNeighbors,
      meshcoreNeighbors,
    };

    const { rerender } = render(<RepeatersPanel {...base} />);

    await userEvent.click(screen.getByRole('button', { name: 'Repeater neighbors' }));
    expect(
      await screen.findByRole('button', {
        name: 'Load more neighbors (50 of 60 loaded)',
      }),
    ).toBeEnabled();

    rerender(
      <RepeatersPanel
        {...base}
        meshcoreRepeaterRpcPending={new Map([[repeater.node_id, new Set(['neighbors' as const])]])}
      />,
    );

    const loadMore = await screen.findByRole('button', { name: 'Loading…' });
    expect(loadMore).toBeDisabled();
  });

  it('disables Load more when neighbors hop limit is exceeded', async () => {
    const onRequestNeighbors = vi.fn().mockResolvedValue(undefined);
    const meshcoreNeighbors = new Map([
      [
        repeater.node_id,
        {
          totalNeighboursCount: 60,
          neighbours: Array.from({ length: 50 }, (_, i) => ({
            publicKeyPrefix: new Uint8Array(6),
            prefixHex: i.toString(16).padStart(12, '0'),
            resolvedNodeId: 0,
            heardSecondsAgo: 1,
            snr: 2,
          })),
          fetchedAt: Date.now(),
        },
      ],
    ]);
    const nearNode = { ...repeater, hops_away: 1 };
    const base = {
      ...makeBaseProps(),
      nodes: new Map([[nearNode.node_id, nearNode]]),
      onRequestNeighbors,
      meshcoreNeighbors,
    };

    const { rerender } = render(<RepeatersPanel {...base} />);

    await userEvent.click(screen.getByRole('button', { name: 'Repeater neighbors' }));
    const loadMore = await screen.findByRole('button', {
      name: 'Load more neighbors (50 of 60 loaded)',
    });
    expect(loadMore).toBeEnabled();

    const farNode = { ...repeater, hops_away: 8 };
    rerender(<RepeatersPanel {...base} nodes={new Map([[farNode.node_id, farNode]])} />);

    expect(
      await screen.findByRole('button', {
        name: 'Load more neighbors (50 of 60 loaded)',
      }),
    ).toBeDisabled();
    expect(onRequestNeighbors).toHaveBeenCalledTimes(1);
  });

  it('shows error toast when ping fails', async () => {
    const props = makeBaseProps();
    props.onPing = vi.fn().mockRejectedValue(new Error('ping timeout'));

    render(<RepeatersPanel {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ping trace' }));

    expect(warnSpy).toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('ping timeout'), 'error');
  });

  it('renders translated meshcore action errors instead of raw i18n keys', () => {
    const props = makeBaseProps();
    props.meshcoreStatusErrors = new Map([
      [
        repeater.node_id,
        meshcoreStoredUserMessage({
          key: 'meshcore.errors.requestTimedOutApprox',
          params: { seconds: 45 },
        }),
      ],
    ]);
    props.meshcorePingErrors = new Map([
      [repeater.node_id, meshcoreStoredUserMessage('meshcore.errors.pingNoRoute')],
    ]);

    render(<RepeatersPanel {...props} />);

    expect(
      screen.getByRole('button', { name: /Status error:.*Request timed out/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Ping error:.*No route from radio yet/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText('meshcore.errors.pingNoRoute')).not.toBeInTheDocument();
    expect(screen.queryByText(/MC_I18N:/)).not.toBeInTheDocument();
  });

  it('shows a toast when ping resolves false with a stored meshcore error', async () => {
    const props = makeBaseProps();
    props.onPing = vi.fn().mockResolvedValue(false);
    props.meshcorePingErrors = new Map([
      [repeater.node_id, meshcoreStoredUserMessage('meshcore.errors.pingNoRoute')],
    ]);
    render(<RepeatersPanel {...props} />);

    await userEvent.click(
      screen.getByRole('button', { name: /Ping error:.*No route from radio yet/i }),
    );

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.stringContaining('No route from radio yet'),
        'error',
      );
    });
  });

  it('requires a confirmation click before deleting a repeater', async () => {
    const props = makeBaseProps();
    render(<RepeatersPanel {...props} />);

    const deleteBtn = screen.getByRole('button', { name: /Remove/i });
    // First click shows confirmation
    await userEvent.click(deleteBtn);
    expect(props.onDeleteRepeater).not.toHaveBeenCalled();
    expect(screen.getByText('Confirm?')).toBeInTheDocument();

    // Second click executes the delete
    await userEvent.click(screen.getByText('Confirm?'));
    expect(props.onDeleteRepeater).toHaveBeenCalledWith(repeater.node_id);
  });

  it('does not expand telemetry section when request fails', async () => {
    const props = makeBaseProps();
    const onRequestTelemetry = vi.fn().mockRejectedValue(new Error('telemetry fail'));

    render(<RepeatersPanel {...props} onRequestTelemetry={onRequestTelemetry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sensor telemetry LPP' }));

    expect(warnSpy).toHaveBeenCalled();
    expect(screen.queryByText(/Sensor telemetry/i)).not.toBeInTheDocument();
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('telemetry fail'), 'error');
  });

  it('expands telemetry section when request succeeds', async () => {
    const props = makeBaseProps();
    const telemetryData = { temperature: 25.5, humidity: 60 };
    const onRequestTelemetry = vi.fn().mockResolvedValue(telemetryData);

    render(<RepeatersPanel {...props} onRequestTelemetry={onRequestTelemetry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sensor telemetry LPP' }));

    expect(onRequestTelemetry).toHaveBeenCalledWith(repeater.node_id);
  });

  it('calls onSendCliCommand with trimmed input when Send is clicked', async () => {
    const onSendCliCommand = vi.fn().mockResolvedValue('ok');
    render(<RepeatersPanel {...makeBaseProps()} onSendCliCommand={onSendCliCommand} />);

    // Open CLI interface
    await userEvent.click(screen.getByRole('button', { name: 'CLI interface' }));
    const input = screen.getByRole('textbox', { name: 'CLI command input' });
    await userEvent.type(input, '  name  ');
    await userEvent.click(screen.getByRole('button', { name: /Send/i }));

    expect(onSendCliCommand).toHaveBeenCalledWith(repeater.node_id, 'name', undefined);
  });

  it('calls onSendCliCommand when a quick command button is clicked', async () => {
    const onSendCliCommand = vi.fn().mockResolvedValue('ok');
    render(<RepeatersPanel {...makeBaseProps()} onSendCliCommand={onSendCliCommand} />);

    // Open CLI interface
    await userEvent.click(screen.getByRole('button', { name: 'CLI interface' }));
    await userEvent.click(screen.getByRole('button', { name: 'name' }));

    expect(onSendCliCommand).toHaveBeenCalledWith(repeater.node_id, 'name', undefined);
  });

  it('calls onSendCliCommand for set path.hash.mode quick command', async () => {
    const onSendCliCommand = vi.fn().mockResolvedValue('ok');
    render(<RepeatersPanel {...makeBaseProps()} onSendCliCommand={onSendCliCommand} />);

    await userEvent.click(screen.getByRole('button', { name: 'CLI interface' }));
    await userEvent.click(screen.getByRole('button', { name: 'Set path hash mode 2-byte' }));

    expect(onSendCliCommand).toHaveBeenCalledWith(
      repeater.node_id,
      'set path.hash.mode 1',
      undefined,
    );
  });

  it('exposes clock sync and related safe CLI quick pills', async () => {
    const onSendCliCommand = vi.fn().mockResolvedValue('ok');
    render(<RepeatersPanel {...makeBaseProps()} onSendCliCommand={onSendCliCommand} />);

    await userEvent.click(screen.getByRole('button', { name: 'CLI interface' }));
    expect(screen.getByRole('button', { name: 'clock sync' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'clear stats' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'advert' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'board' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'clock' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'clock sync' }));
    expect(onSendCliCommand).toHaveBeenCalledWith(repeater.node_id, 'clock sync', undefined);
  });

  it('requires confirmation before sending destructive CLI commands', async () => {
    const onSendCliCommand = vi.fn().mockResolvedValue('ok');
    render(<RepeatersPanel {...makeBaseProps()} onSendCliCommand={onSendCliCommand} />);

    await userEvent.click(screen.getByRole('button', { name: 'CLI interface' }));
    const input = screen.getByRole('textbox', { name: 'CLI command input' });
    await userEvent.type(input, 'reboot');
    await userEvent.click(screen.getByRole('button', { name: /Send/i }));

    expect(onSendCliCommand).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Run command' }));
    expect(onSendCliCommand).toHaveBeenCalledWith(repeater.node_id, 'reboot', {
      confirmedDanger: true,
    });
  });

  it('auto-pings before CLI on multi-hop repeaters without a trace this session', async () => {
    const multiHop = { ...repeater, hops_away: 2 };
    const onPing = vi.fn().mockResolvedValue(true);
    const onSendCliCommand = vi.fn().mockResolvedValue('ok');
    render(
      <RepeatersPanel
        {...makeBaseProps()}
        nodes={new Map([[multiHop.node_id, multiHop]])}
        onPing={onPing}
        onSendCliCommand={onSendCliCommand}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'CLI interface' }));
    await userEvent.click(screen.getByRole('button', { name: 'name' }));

    await waitFor(() => {
      expect(onPing).toHaveBeenCalledWith(multiHop.node_id);
      expect(onSendCliCommand).toHaveBeenCalledWith(multiHop.node_id, 'name', undefined);
    });
    expect(onPing.mock.invocationCallOrder[0]).toBeLessThan(
      onSendCliCommand.mock.invocationCallOrder[0],
    );
    expect(mockAddToast).toHaveBeenCalledWith('Establishing route with Ping before CLI…', 'info');
  });

  it('skips auto-ping before CLI for 0-hop repeaters', async () => {
    const onPing = vi.fn().mockResolvedValue(undefined);
    const onSendCliCommand = vi.fn().mockResolvedValue('ok');
    render(
      <RepeatersPanel {...makeBaseProps()} onPing={onPing} onSendCliCommand={onSendCliCommand} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'CLI interface' }));
    await userEvent.click(screen.getByRole('button', { name: 'name' }));

    await waitFor(() => {
      expect(onSendCliCommand).toHaveBeenCalledWith(repeater.node_id, 'name', undefined);
    });
    expect(onPing).not.toHaveBeenCalled();
    expect(mockAddToast).not.toHaveBeenCalledWith(
      'Establishing route with Ping before CLI…',
      'info',
    );
  });

  it('skips auto-ping before CLI when a trace exists this session', async () => {
    const multiHop = { ...repeater, hops_away: 2 };
    const onPing = vi.fn().mockResolvedValue(undefined);
    const onSendCliCommand = vi.fn().mockResolvedValue('ok');
    const meshcoreTraceResults = new Map([
      [
        multiHop.node_id,
        {
          pathLen: 2,
          pathHashes: [0xaa, 0xbb],
          hashSizeBytes: 1 as const,
          pathSnrs: [1, 2],
          lastSnr: 1,
          tag: 0,
        },
      ],
    ]);
    render(
      <RepeatersPanel
        {...makeBaseProps()}
        nodes={new Map([[multiHop.node_id, multiHop]])}
        meshcoreTraceResults={meshcoreTraceResults}
        onPing={onPing}
        onSendCliCommand={onSendCliCommand}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'CLI interface' }));
    await userEvent.click(screen.getByRole('button', { name: 'name' }));

    await waitFor(() => {
      expect(onSendCliCommand).toHaveBeenCalledWith(multiHop.node_id, 'name', undefined);
    });
    expect(onPing).not.toHaveBeenCalled();
    expect(mockAddToast).not.toHaveBeenCalledWith(
      'Establishing route with Ping before CLI…',
      'info',
    );
  });

  it('aborts CLI when auto-ping fails on multi-hop repeaters', async () => {
    const multiHop = { ...repeater, hops_away: 2 };
    const onPing = vi.fn().mockRejectedValue(new Error('ping timeout'));
    const onSendCliCommand = vi.fn().mockResolvedValue('ok');
    render(
      <RepeatersPanel
        {...makeBaseProps()}
        nodes={new Map([[multiHop.node_id, multiHop]])}
        onPing={onPing}
        onSendCliCommand={onSendCliCommand}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'CLI interface' }));
    await userEvent.click(screen.getByRole('button', { name: 'name' }));

    await waitFor(() => {
      expect(onPing).toHaveBeenCalledWith(multiHop.node_id);
      expect(mockAddToast).toHaveBeenCalledWith(
        'Ping failed; run Ping manually before retrying CLI on multi-hop repeaters.',
        'error',
      );
    });
    expect(onSendCliCommand).not.toHaveBeenCalled();
  });

  it('aborts CLI when auto-ping resolves without trace result (pingNoRoute)', async () => {
    const multiHop = { ...repeater, hops_away: 2 };
    const onPing = vi.fn().mockResolvedValue(false);
    const onSendCliCommand = vi.fn().mockResolvedValue('ok');
    render(
      <RepeatersPanel
        {...makeBaseProps()}
        nodes={new Map([[multiHop.node_id, multiHop]])}
        onPing={onPing}
        onSendCliCommand={onSendCliCommand}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'CLI interface' }));
    await userEvent.click(screen.getByRole('button', { name: 'name' }));

    await waitFor(() => {
      expect(onPing).toHaveBeenCalledWith(multiHop.node_id);
      expect(mockAddToast).toHaveBeenCalledWith(
        'Ping failed; run Ping manually before retrying CLI on multi-hop repeaters.',
        'error',
      );
    });
    expect(onSendCliCommand).not.toHaveBeenCalled();
  });

  it('shows cliMultiHopHint for multi-hop repeaters without a trace this session', async () => {
    const multiHop = { ...repeater, hops_away: 2 };
    render(
      <RepeatersPanel
        {...makeBaseProps()}
        nodes={new Map([[multiHop.node_id, multiHop]])}
        meshcoreTraceResults={new Map()}
        onSendCliCommand={vi.fn().mockResolvedValue('ok')}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'CLI interface' }));

    expect(
      screen.getByText(/Multi-hop CLI is more reliable after a successful Ping trace/i),
    ).toBeInTheDocument();
  });

  it('pins favorited repeaters above non-favorites', () => {
    const now = Math.floor(Date.now() / 1000);
    const older = mockRepeaterNodeWithFavorited(0x100, false);
    older.last_heard = now - 1000;
    const newer = mockRepeaterNodeWithFavorited(0x200, false);
    newer.last_heard = now;
    const favOlder = mockRepeaterNodeWithFavorited(0x300, true);
    favOlder.last_heard = now - 100;

    const nodes = new Map([
      [older.node_id, older],
      [newer.node_id, newer],
      [favOlder.node_id, favOlder],
    ]);

    render(<RepeatersPanel {...makeBaseProps()} nodes={nodes} />);

    // Extract text from name buttons (the underline-decorated ones) to check sort order
    const nameLinks = screen
      .getAllByRole('button', { name: /Repeater/ })
      .filter((b) => b.className.includes('underline'));
    const names = nameLinks.map((b) => b.textContent);
    // Favorited repeater should be first even though newer repeater was heard more recently
    expect(names).toHaveLength(3);
    expect(names[0]).toBe('Repeater 300'); // favorited
    expect(names[1]).toBe('Repeater 200'); // most recent non-fav
    expect(names[2]).toBe('Repeater 100'); // oldest non-fav
  });

  it('renders reliability from historical path outcomes at launch', () => {
    usePathHistoryStore.setState({
      records: new Map([
        [
          repeater.node_id,
          [
            {
              nodeId: repeater.node_id,
              pathHash: 'aa',
              hopCount: 1,
              pathBytes: [0xaa],
              wasFloodDiscovery: false,
              successCount: 2,
              failureCount: 1,
              tripTimeMs: 0,
              routeWeight: 1,
              lastSuccessTs: null,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
        ],
      ]),
      lruOrder: [repeater.node_id],
    });

    render(<RepeatersPanel {...makeBaseProps()} />);

    expect(screen.getByText('67%')).toBeInTheDocument();
  });

  it('updates reliability after new outcome and persists outcome to DB', async () => {
    const dbOutcomeSpy = vi.spyOn(window.electronAPI.db, 'recordMeshcorePathOutcome');
    const pathBytes = [0x33, 0x44];
    const pathHash = computePathHash(pathBytes);
    usePathHistoryStore.getState().recordPathUpdated(repeater.node_id, pathBytes, 1, false);

    render(<RepeatersPanel {...makeBaseProps()} />);

    await act(async () => {
      usePathHistoryStore.getState().recordOutcome(repeater.node_id, pathHash, true);
      await Promise.resolve();
    });

    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(dbOutcomeSpy).toHaveBeenCalledWith(repeater.node_id, pathHash, true, undefined);
  });

  it('loads getMeshcoreContacts only once on mount when nodes grow', async () => {
    const contactsSpy = vi.spyOn(window.electronAPI.db, 'getMeshcoreContacts');
    const props = makeBaseProps();
    const { rerender } = render(<RepeatersPanel {...props} />);
    await waitFor(() => {
      expect(contactsSpy).toHaveBeenCalledTimes(1);
    });

    const moreNodes = new Map(props.nodes);
    moreNodes.set(0xdef, mockRepeaterNode(0xdef));
    rerender(<RepeatersPanel {...props} nodes={moreNodes} />);
    expect(contactsSpy).toHaveBeenCalledTimes(1);
  });

  it('virtualizes large repeater lists to a small DOM window', () => {
    const nodes = new Map<number, MeshNode>();
    for (let i = 0; i < 150; i++) {
      nodes.set(i, mockRepeaterNodeWithFavorited(i, false));
    }
    render(<RepeatersPanel {...makeBaseProps()} nodes={nodes} />);

    const nameLinks = screen
      .getAllByRole('button')
      .filter((b) => b.className.includes('underline'));
    expect(nameLinks.length).toBe(VIRTUALIZER_VISIBLE_CAP);
  });

  it('shows resolved repeater names in expanded path trace row', async () => {
    const user = userEvent.setup();
    const destId = 0xcc;
    const relayId = 0xaa;
    const dest = {
      ...mockRepeaterNode(destId),
      long_name: 'Dest Repeater',
      hops_away: 1,
    };
    const relay = {
      ...mockRepeaterNode(relayId),
      long_name: 'Relay Alpha',
    };
    const meshcoreTraceResults = new Map([
      [
        destId,
        {
          pathLen: 2,
          pathHashes: [0xaa, 0xcc],
          hashSizeBytes: 1 as const,
          pathSnrs: [4.5, 3],
          lastSnr: 2.5,
          tag: 1,
        },
      ],
    ]);
    render(
      <RepeatersPanel
        {...makeBaseProps()}
        nodes={
          new Map([
            [destId, dest],
            [relayId, relay],
          ])
        }
        meshcoreTraceResults={meshcoreTraceResults}
      />,
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Hop count from last Ping trace (repeaters between you and this node)',
      }),
    );
    expect(screen.getByTitle('AA → Relay Alpha')).toHaveTextContent('Relay Alpha');
    expect(screen.getByText('Path:')).toBeInTheDocument();
    expect(screen.getByText(/▣\s*Dest Repeater/)).toBeInTheDocument();
  });

  it('shows current route names when no trace result exists', async () => {
    const user = userEvent.setup();
    const destId = 0xdd;
    const relayId = 0xee;
    const dest = {
      ...mockRepeaterNode(destId),
      long_name: 'Dest Node',
      hops_away: 1,
    };
    const relay = {
      ...mockRepeaterNode(relayId),
      long_name: 'Via Relay',
    };
    usePathHistoryStore.getState().recordPathUpdated(destId, [0xee, 0xdd], 1, false);
    render(
      <RepeatersPanel
        {...makeBaseProps()}
        nodes={
          new Map([
            [destId, dest],
            [relayId, relay],
          ])
        }
      />,
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Hop count from last Ping trace (repeaters between you and this node)',
      }),
    );
    expect(screen.getByText('Current route:')).toBeInTheDocument();
    expect(screen.getByTitle('EE → Via Relay')).toHaveTextContent('Via Relay');
    expect(screen.getByText(/▣\s*Dest Node/)).toBeInTheDocument();
  });

  it('disables neighbors for repeaters at or beyond hop threshold', () => {
    const far = { ...repeater, hops_away: 10 };
    render(
      <RepeatersPanel
        {...makeBaseProps()}
        nodes={new Map([[far.node_id, far]])}
        onRequestNeighbors={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Repeater neighbors' })).toBeDisabled();
  });
});
