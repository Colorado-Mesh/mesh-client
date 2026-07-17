import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import {
  isRrcHubDisconnectSuppressed,
  resetRrcHubDisconnectSuppressForTests,
} from '@/renderer/lib/rrcHubDisconnectSuppress';
import { saveRrcHubAutoJoin } from '@/renderer/lib/rrcHubPrefs';
import { useRrcHubStore } from '@/renderer/stores/rrcHubStore';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';

import RrcPanel from './RrcPanel';

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  isReticulumSidecarRunning: vi.fn(() => Promise.resolve(false)),
}));

const hubA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const hubB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('RrcPanel', () => {
  beforeEach(() => {
    useRrcSessionStore.getState().clearSession();
    useRrcHubStore.setState({ hubs: new Map() });
    resetRrcHubDisconnectSuppressForTests();
    hydrateAxeThemeColors(document.documentElement);
    vi.mocked(isReticulumSidecarRunning).mockResolvedValue(false);
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockClear();
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockResolvedValue({ ok: true });
    vi.mocked(window.electronAPI.reticulum.rrc.disconnect).mockReset();
    vi.mocked(window.electronAPI.reticulum.rrc.disconnect).mockResolvedValue({ ok: true });
    localStorage.removeItem('mesh-client:rrc:hubAutoJoin');
  });

  it('renders amber hub chrome and select-hub prompt', async () => {
    const { container } = render(<RrcPanel isActive />);
    expect(screen.getAllByText(/Select an RRC hub/i).length).toBeGreaterThan(0);
    expect(container.querySelector('[class*="border-amber"]')).toBeTruthy();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows Cancel while connecting so a stuck hub connect can be aborted', () => {
    useRrcSessionStore.getState().applyStatus('connecting', hubA, 'Slow Hub');
    render(<RrcPanel isActive />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
  });

  it('keeps sibling hub sessions when focusing another connected hub', () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.roomJoined('#lobby');
    store.setFocusedHub(hubA);
    store.applyStatus('active', hubB, 'Hub B');
    store.setFocusedHub(hubB);

    const state = useRrcSessionStore.getState();
    expect(state.focusedHubHash).toBe(hubB);
    expect(state.sessionsByHub.get(hubA)?.status).toBe('active');
    expect(state.sessionsByHub.get(hubA)?.rooms.has('#lobby')).toBe(true);
    expect(state.sessionsByHub.get(hubB)?.status).toBe('active');
  });

  it('batch-connects auto-join hubs when the sidecar becomes ready', async () => {
    vi.mocked(isReticulumSidecarRunning).mockResolvedValue(true);
    saveRrcHubAutoJoin([hubA, hubB]);

    render(<RrcPanel isActive />);

    await waitFor(() => {
      expect(window.electronAPI.reticulum.rrc.connect).toHaveBeenCalled();
    });
    const hashes = vi
      .mocked(window.electronAPI.reticulum.rrc.connect)
      .mock.calls.map((c) => (c[0] as { dest_hash: string }).dest_hash)
      .sort();
    expect(hashes).toEqual([hubA, hubB]);
  });

  it('skips auto-join connect for hubs already active', async () => {
    vi.mocked(isReticulumSidecarRunning).mockResolvedValue(true);
    saveRrcHubAutoJoin([hubA]);
    useRrcSessionStore.getState().applyStatus('active', hubA, 'Hub A');

    render(<RrcPanel isActive />);

    await waitFor(() => {
      expect(isReticulumSidecarRunning).toHaveBeenCalled();
    });
    // Give the auto-connect effect a tick; it should no-op because hub A is linked.
    await new Promise((r) => setTimeout(r, 20));
    expect(window.electronAPI.reticulum.rrc.connect).not.toHaveBeenCalled();
  });

  it('Cancel disconnects a connecting hub and sets disconnect intent', async () => {
    vi.mocked(window.electronAPI.reticulum.rrc.disconnect).mockResolvedValue({ ok: true });
    useRrcSessionStore.getState().applyStatus('connecting', hubA, 'Slow Hub');
    useRrcHubStore.setState({
      hubs: new Map([
        [
          hubA,
          {
            destination_hash: hubA,
            display_name: 'Slow Hub',
            source: 'manual',
            recommended: false,
          },
        ],
      ]),
    });
    render(<RrcPanel isActive />);
    screen.getByRole('button', { name: 'Cancel' }).click();
    await waitFor(() => {
      expect(window.electronAPI.reticulum.rrc.disconnect).toHaveBeenCalledWith({
        dest_hash: hubA,
      });
    });
    expect(useRrcSessionStore.getState().sessionsByHub.has(hubA)).toBe(false);
  });

  it('resets disconnect intent when disconnect IPC fails', async () => {
    vi.mocked(window.electronAPI.reticulum.rrc.disconnect).mockResolvedValue({
      ok: false,
    });
    useRrcSessionStore.getState().applyStatus('active', hubA, 'Hub A');
    useRrcHubStore.setState({
      hubs: new Map([
        [
          hubA,
          {
            destination_hash: hubA,
            display_name: 'Hub A',
            source: 'manual',
            recommended: false,
          },
        ],
      ]),
    });
    render(<RrcPanel isActive />);
    screen.getByRole('button', { name: /Disconnect/i }).click();
    await waitFor(() => {
      expect(window.electronAPI.reticulum.rrc.disconnect).toHaveBeenCalled();
    });
    expect(useRrcSessionStore.getState().sessionsByHub.get(hubA)?.disconnectIntent).toBe(false);
    expect(useRrcSessionStore.getState().sessionsByHub.has(hubA)).toBe(true);
    expect(isRrcHubDisconnectSuppressed(hubA)).toBe(false);
  });

  it('Disconnect with hub auto-join does not reconnect via rrc.connect', async () => {
    vi.mocked(isReticulumSidecarRunning).mockResolvedValue(true);
    saveRrcHubAutoJoin([hubA]);
    useRrcSessionStore.getState().applyStatus('active', hubA, 'Hub A');
    useRrcHubStore.setState({
      hubs: new Map([
        [
          hubA,
          {
            destination_hash: hubA,
            display_name: 'Hub A',
            source: 'manual',
            recommended: false,
          },
        ],
      ]),
    });
    render(<RrcPanel isActive />);
    // Initial mount may attempt batch for other hubs; clear before Disconnect.
    await waitFor(() => {
      expect(isReticulumSidecarRunning).toHaveBeenCalled();
    });
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockClear();

    screen.getByRole('button', { name: /Disconnect/i }).click();
    await waitFor(() => {
      expect(window.electronAPI.reticulum.rrc.disconnect).toHaveBeenCalledWith({
        dest_hash: hubA,
      });
    });
    expect(useRrcSessionStore.getState().sessionsByHub.has(hubA)).toBe(false);
    expect(isRrcHubDisconnectSuppressed(hubA)).toBe(true);

    await new Promise((r) => setTimeout(r, 50));
    expect(window.electronAPI.reticulum.rrc.connect).not.toHaveBeenCalled();
  });
});
