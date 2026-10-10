import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { protocolRecord } from '@/renderer/lib/appProtocolSelect';
import type * as FirmwareCheck from '@/renderer/lib/firmwareCheck';
import {
  MESHCORE_CAPABILITIES,
  MESHTASTIC_CAPABILITIES,
} from '@/renderer/lib/radio/BaseRadioProvider';
import type { DeviceState } from '@/renderer/lib/types';

import { FirmwareUpdateNotifier } from './FirmwareUpdateNotifier';
import { ToastProvider } from './Toast';

const { fetchMeshcoreRelease, fetchMeshtasticRelease } = vi.hoisted(() => ({
  fetchMeshcoreRelease: vi.fn(),
  fetchMeshtasticRelease: vi.fn(),
}));

vi.mock('@/renderer/lib/firmwareCheck', async (importOriginal) => {
  const actual = await importOriginal<typeof FirmwareCheck>();
  return {
    ...actual,
    fetchLatestMeshCoreRelease: fetchMeshcoreRelease,
    fetchLatestMeshtasticRelease: fetchMeshtasticRelease,
  };
});

const DISMISS_KEY = 'mesh-client:firmwareUpdateDismissed:meshcore';

function renderNotifier(onResult = vi.fn()) {
  const idle = { status: 'disconnected' } as unknown as DeviceState;
  // MeshCoMod reports its own version, one behind upstream MeshCore (#1097).
  const meshcore = { status: 'configured', firmwareVersion: '1.17.0.4' } as unknown as DeviceState;
  render(
    <ToastProvider>
      <FirmwareUpdateNotifier
        deviceStateByProtocol={protocolRecord(idle, meshcore)}
        capabilitiesByProtocol={protocolRecord(MESHTASTIC_CAPABILITIES, MESHCORE_CAPABILITIES)}
        activeProtocol="meshcore"
        onResult={onResult}
      />
    </ToastProvider>,
  );
  return onResult;
}

describe('FirmwareUpdateNotifier', () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMeshcoreRelease.mockReset();
    fetchMeshtasticRelease.mockReset();
    fetchMeshcoreRelease.mockResolvedValue({
      version: '1.17.1',
      publishedAt: new Date(Date.UTC(2026, 8, 20)),
      releaseUrl: 'https://github.com/meshcore-dev/MeshCore/releases/tag/companion-v1.17.1',
    });
  });

  it("offers Don't remind me on the update toast and remembers the version", async () => {
    const user = userEvent.setup();
    renderNotifier();
    expect(await screen.findByText('Firmware update available: v1.17.1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: "Don't remind me" }));
    expect(localStorage.getItem(DISMISS_KEY)).toBe('1.17.1');
  });

  it('stays quiet for a release the user dismissed, but still reports it', async () => {
    localStorage.setItem(DISMISS_KEY, '1.17.1');
    const onResult = renderNotifier();
    await waitFor(() => {
      expect(onResult).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'update-available', latestVersion: '1.17.1' }),
      );
    });
    expect(screen.queryByText('Firmware update available: v1.17.1')).toBeNull();
  });

  it('toasts again when a newer release ships', async () => {
    localStorage.setItem(DISMISS_KEY, '1.17.0');
    renderNotifier();
    expect(await screen.findByText('Firmware update available: v1.17.1')).toBeInTheDocument();
  });
});
