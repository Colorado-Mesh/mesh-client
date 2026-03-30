import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type { MeshNode } from '../lib/types';
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
});
