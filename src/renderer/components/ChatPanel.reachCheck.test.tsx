import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hexToBytesExactOrThrow } from '../../shared/hexBytes';
import { setMeshcoreReachCheckServerUrl } from '../lib/appSettingsStorage';
import { meshcoreDeriveChannelKeyHexFromName } from '../lib/meshcoreUtils';
import { useReachCheckStore } from '../lib/reachCheck/reachCheckStore';
import ChatPanel from './ChatPanel';
import { ToastProvider } from './Toast';

const IDENTITY = 'meshcore:aa';

async function cmReachSecret(): Promise<Uint8Array> {
  return hexToBytesExactOrThrow(await meshcoreDeriveChannelKeyHexFromName('#cm-reach'), 16);
}

function renderPanel(overrides: Record<string, unknown> = {}) {
  const onSend = vi.fn(() => 'out:1700000000000:abc');
  const props = {
    messages: [],
    channels: [
      { index: 0, name: 'Public' },
      { index: 2, name: '#cm-reach' },
    ],
    myNodeNum: 7,
    onSend,
    onReact: vi.fn().mockResolvedValue(undefined),
    onResend: vi.fn(),
    onNodeClick: vi.fn(),
    isConnected: true,
    nodes: new Map(),
    isActive: true,
    protocol: 'meshcore' as const,
    identityId: IDENTITY,
    onSetMeshcoreChannel: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  const view = render(
    <ToastProvider>
      <ChatPanel {...(props as Parameters<typeof ChatPanel>[0])} />
    </ToastProvider>,
  );
  const rerenderWith = (more: Record<string, unknown>) => {
    view.rerender(
      <ToastProvider>
        <ChatPanel {...{ ...props, ...more }} />
      </ToastProvider>,
    );
  };
  return { onSend, rerenderWith };
}

beforeEach(() => {
  localStorage.clear();
  useReachCheckStore.setState({ entries: {} });
});

describe('ChatPanel reach check', () => {
  it('has no toolbar button unless reach check is available', async () => {
    renderPanel({
      meshcoreChannelSources: [
        { index: 0, name: 'Public', secret: new Uint8Array(16).fill(1) },
        { index: 2, name: '#cm-reach', secret: await cmReachSecret() },
      ],
    });
    expect(screen.queryByRole('button', { name: 'Reach check' })).toBeNull();
  });

  it('asks for a server first and is busy while the dialog is open', async () => {
    renderPanel({
      reachCheckAvailable: true,
      meshcoreChannelSources: [{ index: 0, name: 'Public', secret: new Uint8Array(16).fill(1) }],
    });
    const button = screen.getByRole('button', { name: 'Reach check' });
    fireEvent.click(button);
    expect(await screen.findByRole('dialog', { name: 'Reach check' })).toBeInTheDocument();
    expect(screen.getByLabelText('Reach check server')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Reach check' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.getByRole('button', { name: 'Reach check' })).not.toHaveAttribute(
      'aria-disabled',
    );
  });

  it('keeps focus on the busy button when a step closes, and ignores clicks while busy', async () => {
    vi.mocked(window.electronAPI.reachCheck.bootstrap).mockClear();
    vi.mocked(window.electronAPI.reachCheck.bootstrap).mockReturnValue(
      new Promise(() => undefined),
    );
    renderPanel({
      reachCheckAvailable: true,
      meshcoreChannelSources: [{ index: 0, name: 'Public', secret: new Uint8Array(16).fill(1) }],
    });
    const button = screen.getByRole('button', { name: 'Reach check' });
    button.focus();
    fireEvent.click(button);
    const field = await screen.findByLabelText('Reach check server');
    fireEvent.change(field, { target: { value: 'https://rangecheck.example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and run' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const busyButton = screen.getByRole('button', { name: 'Reach check' });
    expect(busyButton).toHaveFocus();
    expect(busyButton).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(busyButton);
    expect(window.electronAPI.reachCheck.bootstrap).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes an open step when App hides the panel (composer disabled)', async () => {
    const { rerenderWith } = renderPanel({
      reachCheckAvailable: true,
      meshcoreChannelSources: [{ index: 0, name: 'Public', secret: new Uint8Array(16).fill(1) }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reach check' }));
    expect(await screen.findByRole('dialog', { name: 'Reach check' })).toBeInTheDocument();
    rerenderWith({
      reachCheckAvailable: true,
      meshcoreChannelSources: [{ index: 0, name: 'Public', secret: new Uint8Array(16).fill(1) }],
      composerDisabled: true,
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('sends the code on the test channel and shows the results line', async () => {
    setMeshcoreReachCheckServerUrl('https://rangecheck.example.org');
    vi.mocked(window.electronAPI.reachCheck.bootstrap).mockResolvedValue({
      ok: true,
      value: {
        origin: 'https://rangecheck.example.org',
        channelName: 'cm-reach',
        channelHash: 'd6',
        turnstileRequired: false,
        version: '1.3.8',
      },
    });
    vi.mocked(window.electronAPI.reachCheck.createSession).mockResolvedValue({
      ok: true,
      value: {
        id: 'sess-1',
        code: 'MHC-1A2B3C',
        status: 'waiting',
        expiresAt: Date.now() + 600_000,
        observedCount: 0,
        expectedCount: 10,
        repeaterCount: 0,
        distanceText: '',
        sharePath: '/share/sess-1',
      },
    });
    const { onSend } = renderPanel({
      reachCheckAvailable: true,
      meshcoreChannelSources: [
        { index: 0, name: 'Public', secret: new Uint8Array(16).fill(1) },
        { index: 2, name: '#cm-reach', secret: await cmReachSecret() },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reach check' }));
    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('MHC-1A2B3C', 2, undefined, undefined);
    });
    expect(window.electronAPI.reachCheck.bootstrap).toHaveBeenCalledWith(
      'https://rangecheck.example.org',
    );
    expect(
      useReachCheckStore.getState().entryFor(IDENTITY as never, 'out:1700000000000:abc'),
    ).toMatchObject({ sessionId: 'sess-1', state: 'polling' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
