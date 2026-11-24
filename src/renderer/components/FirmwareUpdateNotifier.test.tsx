import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { protocolRecord } from '@/renderer/lib/appProtocolSelect';
import type * as FirmwareCheck from '@/renderer/lib/firmwareCheck';
import {
  MESHCOM_CAPABILITIES,
  MESHCORE_CAPABILITIES,
  MESHTASTIC_CAPABILITIES,
  RETICULUM_CAPABILITIES,
} from '@/renderer/lib/radio/BaseRadioProvider';
import type { DeviceState } from '@/renderer/lib/types';

import { FirmwareUpdateNotifier } from './FirmwareUpdateNotifier';
import { ToastProvider } from './Toast';

const { fetchMeshcomRelease, fetchMeshcoreRelease, fetchMeshtasticRelease } = vi.hoisted(() => ({
  fetchMeshcomRelease: vi.fn(),
  fetchMeshcoreRelease: vi.fn(),
  fetchMeshtasticRelease: vi.fn(),
}));

vi.mock('@/renderer/lib/firmwareCheck', async (importOriginal) => {
  const actual = await importOriginal<typeof FirmwareCheck>();
  return {
    ...actual,
    fetchLatestMeshComRelease: fetchMeshcomRelease,
    fetchLatestMeshCoreRelease: fetchMeshcoreRelease,
    fetchLatestMeshtasticRelease: fetchMeshtasticRelease,
  };
});

const DISMISS_KEY = 'mesh-client:firmwareUpdateDismissed:meshcore';
const MESHCOM_DISMISS_KEY = 'mesh-client:firmwareUpdateDismissed:meshcom';

function renderNotifier(onResult = vi.fn()) {
  const idle = { status: 'disconnected' } as unknown as DeviceState;
  // MeshCoMod reports its own version, one behind upstream MeshCore (#1097).
  const meshcore = { status: 'configured', firmwareVersion: '1.17.0.4' } as unknown as DeviceState;
  render(
    <ToastProvider>
      <FirmwareUpdateNotifier
        deviceStateByProtocol={protocolRecord(idle, meshcore, idle, idle)}
        capabilitiesByProtocol={protocolRecord(
          MESHTASTIC_CAPABILITIES,
          MESHCORE_CAPABILITIES,
          RETICULUM_CAPABILITIES,
          MESHCOM_CAPABILITIES,
        )}
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
    fetchMeshcomRelease.mockReset();
    fetchMeshcoreRelease.mockReset();
    fetchMeshtasticRelease.mockReset();
    fetchMeshcoreRelease.mockResolvedValue({
      version: '1.17.1',
      publishedAt: new Date(Date.UTC(2026, 8, 20)),
      releaseUrl: 'https://github.com/meshcore-dev/MeshCore/releases/tag/companion-v1.17.1',
    });
    fetchMeshcomRelease.mockResolvedValue({
      version: '4.40a.11.14',
      releaseUrl: 'https://github.com/icssw-org/MeshCom-Firmware/releases/tag/v4.40a.11.14',
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

  it('toasts the other protocol when the active protocol changes', async () => {
    fetchMeshtasticRelease.mockResolvedValue({
      version: '2.6.0',
      releaseUrl: 'https://github.com/meshtastic/firmware/releases/tag/v2.6.0',
    });
    const idle = { status: 'disconnected' } as unknown as DeviceState;
    const meshcore = {
      status: 'configured',
      firmwareVersion: '1.17.0.4',
    } as unknown as DeviceState;
    const meshtastic = {
      status: 'configured',
      firmwareVersion: '2.5.0',
    } as unknown as DeviceState;
    const shared = {
      deviceStateByProtocol: protocolRecord(meshtastic, meshcore, idle, idle),
      capabilitiesByProtocol: protocolRecord(
        MESHTASTIC_CAPABILITIES,
        MESHCORE_CAPABILITIES,
        RETICULUM_CAPABILITIES,
        MESHCOM_CAPABILITIES,
      ),
      onResult: vi.fn(),
    };
    const { rerender } = render(
      <ToastProvider>
        <FirmwareUpdateNotifier {...shared} activeProtocol="meshcore" />
      </ToastProvider>,
    );
    expect(await screen.findByText('Firmware update available: v1.17.1')).toBeInTheDocument();

    rerender(
      <ToastProvider>
        <FirmwareUpdateNotifier {...shared} activeProtocol="meshtastic" />
      </ToastProvider>,
    );
    expect(await screen.findByText('Firmware update available: v2.6.0')).toBeInTheDocument();

    rerender(
      <ToastProvider>
        <FirmwareUpdateNotifier {...shared} activeProtocol="meshcore" />
      </ToastProvider>,
    );
    await waitFor(() => {
      expect(fetchMeshcoreRelease).toHaveBeenCalledTimes(2);
    });
    expect(screen.getAllByText('Firmware update available: v1.17.1')).toHaveLength(1);
  });

  it('checks MeshCom-Firmware releases and toasts when the letter series is behind', async () => {
    const idle = { status: 'disconnected' } as unknown as DeviceState;
    const meshcom = {
      status: 'configured',
      firmwareVersion: '4.35p',
    } as unknown as DeviceState;
    render(
      <ToastProvider>
        <FirmwareUpdateNotifier
          deviceStateByProtocol={protocolRecord(idle, idle, idle, meshcom)}
          capabilitiesByProtocol={protocolRecord(
            MESHTASTIC_CAPABILITIES,
            MESHCORE_CAPABILITIES,
            RETICULUM_CAPABILITIES,
            MESHCOM_CAPABILITIES,
          )}
          activeProtocol="meshcom"
          onResult={vi.fn()}
        />
      </ToastProvider>,
    );
    expect(await screen.findByText('Firmware update available: v4.40a.11.14')).toBeInTheDocument();
    expect(fetchMeshcomRelease).toHaveBeenCalled();
    expect(fetchMeshcoreRelease).not.toHaveBeenCalled();
  });

  it('stays quiet for MeshCom when the device letter series matches latest', async () => {
    const idle = { status: 'disconnected' } as unknown as DeviceState;
    const meshcom = {
      status: 'configured',
      firmwareVersion: '4.40a-rm5',
    } as unknown as DeviceState;
    const onResult = vi.fn();
    render(
      <ToastProvider>
        <FirmwareUpdateNotifier
          deviceStateByProtocol={protocolRecord(idle, idle, idle, meshcom)}
          capabilitiesByProtocol={protocolRecord(
            MESHTASTIC_CAPABILITIES,
            MESHCORE_CAPABILITIES,
            RETICULUM_CAPABILITIES,
            MESHCOM_CAPABILITIES,
          )}
          activeProtocol="meshcom"
          onResult={onResult}
        />
      </ToastProvider>,
    );
    await waitFor(() => {
      expect(onResult).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'up-to-date', latestVersion: '4.40a.11.14' }),
      );
    });
    expect(screen.queryByText(/Firmware update available/)).toBeNull();
    expect(localStorage.getItem(MESHCOM_DISMISS_KEY)).toBeNull();
  });
});
