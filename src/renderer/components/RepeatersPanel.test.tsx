import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type { MeshNode } from '../lib/types';
import { computePathHash, usePathHistoryStore } from '../stores/pathHistoryStore';
import RepeatersPanel from './RepeatersPanel';

const mockAddToast = vi.fn();

vi.mock('./Toast', () => ({
  useToast: () => ({
    addToast: mockAddToast,
  }),
}));

vi.mock('../hooks/useMeshcoreRepeaterRemoteAuth', () => ({
  MeshcoreRepeaterRemoteAuthBanner: () => null,
  useMeshcoreRepeaterRemoteAuth: () => ({
    ensureConfigured: vi.fn().mockResolvedValue(true),
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

function makeBaseProps() {
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
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('hides CLI interface button when onSendCliCommand is omitted', async () => {
    const { container } = render(<RepeatersPanel {...makeBaseProps()} />);
    expect(screen.queryByRole('button', { name: 'CLI interface' })).not.toBeInTheDocument();
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

  it('shows error toast when ping fails', async () => {
    const props = makeBaseProps();
    props.onPing = vi.fn().mockRejectedValue(new Error('ping timeout'));

    render(<RepeatersPanel {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ping trace' }));

    expect(warnSpy).toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('ping timeout'), 'error');
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

    expect(onSendCliCommand).toHaveBeenCalledWith(repeater.node_id, 'name', false);
  });

  it('calls onSendCliCommand when a quick command button is clicked', async () => {
    const onSendCliCommand = vi.fn().mockResolvedValue('ok');
    render(<RepeatersPanel {...makeBaseProps()} onSendCliCommand={onSendCliCommand} />);

    // Open CLI interface
    await userEvent.click(screen.getByRole('button', { name: 'CLI interface' }));
    await userEvent.click(screen.getByRole('button', { name: 'name' }));

    expect(onSendCliCommand).toHaveBeenCalledWith(repeater.node_id, 'name', false);
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

  it('loads reliability from DB via ensureBestPathLoaded fallback on mount', async () => {
    vi.spyOn(window.electronAPI.db, 'getMeshcorePathHistory').mockResolvedValue([
      {
        id: 1,
        node_id: repeater.node_id,
        path_hash: 'bb',
        hop_count: 1,
        path_bytes: '[187]',
        was_flood_discovery: 0,
        success_count: 3,
        failure_count: 1,
        trip_time_ms: 0,
        route_weight: 1,
        last_success_ts: null,
        created_at: 1,
        updated_at: 2,
      },
    ]);

    render(<RepeatersPanel {...makeBaseProps()} />);

    await waitFor(() => {
      expect(screen.getByText('75%')).toBeInTheDocument();
    });
  });
});
