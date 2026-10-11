import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { useBeaconTraffic } from '@/renderer/hooks/useBeaconTraffic';
import { APP_SETTINGS_STORAGE_KEY } from '@/renderer/lib/appSettingsStorage';
import { COLORADO_BEACON_URL, CORESCOPE_PRESETS } from '@/renderer/lib/map/beaconPresets';

import { BeaconConnectionControls } from './BeaconConnectionControls';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function feed(): ReturnType<typeof useBeaconTraffic> {
  return {
    status: 'disconnected',
    error: null,
    directoryLimited: false,
    events: [],
    points: [],
    regions: [{ slug: 'front-range', name: 'Front Range' }],
    connect: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

function presetPicker() {
  return screen.getByRole('combobox', { name: 'liveTraffic.beacon.preset' });
}

function urlInput() {
  return screen.getByRole('textbox', { name: 'liveTraffic.beacon.url' });
}

beforeEach(() => {
  localStorage.removeItem(APP_SETTINGS_STORAGE_KEY);
});

describe('BeaconConnectionControls presets', () => {
  it('defaults to Colorado without starting a connection', () => {
    const service = feed();
    render(<BeaconConnectionControls feed={service} />);
    expect(presetPicker()).toHaveValue('colorado');
    expect(urlInput()).toHaveValue(COLORADO_BEACON_URL);
    expect(service.connect).not.toHaveBeenCalled();
  });

  it('recognizes a saved preset URL and leaves saved custom origins editable', () => {
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ mapBeaconUrl: 'https://beacon.meshat.se/' }),
    );
    const first = render(<BeaconConnectionControls feed={feed()} />);
    expect(presetPicker()).toHaveValue('meshat-sweden');
    first.unmount();
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ mapBeaconUrl: 'https://community.example.org' }),
    );
    render(<BeaconConnectionControls feed={feed()} />);
    expect(presetPicker()).toHaveValue('custom');
    expect(urlInput()).toHaveValue('https://community.example.org');
  });

  it('requires an explicit connect after choosing a preset and resets the previous region', async () => {
    const service = feed();
    render(<BeaconConnectionControls feed={service} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'liveTraffic.beacon.region' }), {
      target: { value: 'front-range' },
    });
    fireEvent.change(presetPicker(), { target: { value: 'meshat-sweden' } });
    expect(urlInput()).toHaveValue('https://beacon.meshat.se');
    expect(
      screen.queryByRole('combobox', { name: 'liveTraffic.beacon.region' }),
    ).not.toBeInTheDocument();
    expect(service.connect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.beacon.connect' }));
    await waitFor(() => {
      expect(service.connect).toHaveBeenCalledWith('https://beacon.meshat.se', undefined);
    });
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}')).toMatchObject({
        mapBeaconUrl: 'https://beacon.meshat.se',
      });
    });
  });

  it('preserves the custom URL while exploring presets without contacting either service', async () => {
    const service = feed();
    render(<BeaconConnectionControls feed={service} />);
    fireEvent.change(presetPicker(), { target: { value: 'custom' } });
    expect(urlInput()).toHaveValue('');
    fireEvent.change(urlInput(), { target: { value: 'https://my-community.example.org' } });
    fireEvent.change(presetPicker(), { target: { value: 'colorado' } });
    fireEvent.change(presetPicker(), { target: { value: 'custom' } });
    expect(urlInput()).toHaveValue('https://my-community.example.org');
    expect(service.connect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.beacon.connect' }));
    await waitFor(() => {
      expect(service.connect).toHaveBeenCalledWith('https://my-community.example.org', undefined);
    });
  });

  it('switches to custom when a preset URL is edited and does not persist failed connections', async () => {
    const service = feed();
    vi.mocked(service.connect).mockResolvedValue(false);
    render(<BeaconConnectionControls feed={service} />);
    fireEvent.change(urlInput(), { target: { value: 'https://custom.example.org' } });
    expect(presetPicker()).toHaveValue('custom');
    expect(localStorage.getItem(APP_SETTINGS_STORAGE_KEY)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.beacon.connect' }));
    await waitFor(() => {
      expect(service.connect).toHaveBeenCalledOnce();
    });
    expect(localStorage.getItem(APP_SETTINGS_STORAGE_KEY)).toBeNull();
  });

  it('disables source editing while the explicit connection is pending', () => {
    render(<BeaconConnectionControls feed={{ ...feed(), status: 'connecting' }} />);
    expect(presetPicker()).toBeDisabled();
    expect(urlInput()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'liveTraffic.beacon.connect' })).toBeDisabled();
  });

  it('offers disconnect while the connected source form is being edited', async () => {
    const service = { ...feed(), status: 'live' as const };
    render(<BeaconConnectionControls feed={service} />);
    expect(urlInput()).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.beacon.disconnect' }));
    await waitFor(() => {
      expect(service.disconnect).toHaveBeenCalledOnce();
    });
  });

  it.each(['connecting', 'reconnecting'] as const)('offers cancel during %s', async (status) => {
    const service = { ...feed(), status };
    render(<BeaconConnectionControls feed={service} />);
    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.cancelConnection' }));
    await waitFor(() => {
      expect(service.disconnect).toHaveBeenCalledOnce();
    });
  });

  it('does not save or accept a connection result that arrives after cancellation', async () => {
    let resolveConnection!: (connected: boolean) => void;
    const service = feed();
    vi.mocked(service.connect).mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveConnection = resolve;
      }),
    );
    const { rerender } = render(<BeaconConnectionControls feed={service} />);
    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.beacon.connect' }));
    rerender(<BeaconConnectionControls feed={{ ...service, status: 'connecting' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.cancelConnection' }));
    await act(async () => {
      resolveConnection(true);
      await Promise.resolve();
    });
    expect(service.disconnect).toHaveBeenCalledOnce();
    expect(localStorage.getItem(APP_SETTINGS_STORAGE_KEY)).toBeNull();
  });

  it('shows only CoreScope presets and never connects when a preset is chosen', () => {
    const service = feed();
    render(<BeaconConnectionControls feed={service} provider="corescope" />);
    const picker = screen.getByRole('combobox', { name: 'liveTraffic.corescope.preset' });
    const input = screen.getByRole('textbox', { name: 'liveTraffic.corescope.url' });
    expect(picker).toHaveValue(CORESCOPE_PRESETS[0].id);
    expect(input).toHaveValue(CORESCOPE_PRESETS[0].baseUrl);
    expect(screen.queryByRole('option', { name: 'Colorado' })).toBeNull();
    fireEvent.change(picker, { target: { value: 'meshat-sweden' } });
    expect(input).toHaveValue('https://meshcore.meshat.se');
    expect(service.connect).not.toHaveBeenCalled();
  });

  it('keeps saved provider URLs separate and drops the previous server region on provider change', async () => {
    const service = feed();
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        mapBeaconUrl: COLORADO_BEACON_URL,
        mapCoreScopeUrl: 'https://custom-corescope.example.org',
      }),
    );
    const { rerender } = render(<BeaconConnectionControls feed={service} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'liveTraffic.beacon.region' }), {
      target: { value: 'front-range' },
    });
    rerender(
      <BeaconConnectionControls
        feed={{ ...service, regions: [{ slug: 'BOS', name: 'Boston' }] }}
        provider="corescope"
      />,
    );
    expect(screen.getByRole('textbox', { name: 'liveTraffic.corescope.url' })).toHaveValue(
      'https://custom-corescope.example.org',
    );
    expect(screen.getByRole('combobox', { name: 'liveTraffic.beacon.region' })).toHaveValue('');
    expect(screen.queryByRole('option', { name: 'Front Range' })).toBeNull();
    expect(service.connect).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'liveTraffic.corescope.url' }), {
      target: { value: 'https://changed-corescope.example.org' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.beacon.connect' }));
    await waitFor(() => {
      expect(service.connect).toHaveBeenCalledWith(
        'https://changed-corescope.example.org',
        undefined,
      );
      expect(JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}')).toMatchObject({
        mapBeaconUrl: COLORADO_BEACON_URL,
        mapCoreScopeUrl: 'https://changed-corescope.example.org',
      });
    });
  });

  it('passes a CoreScope server region code only after it is explicitly selected', async () => {
    const service = { ...feed(), regions: [{ slug: 'BOS', name: 'Boston' }] };
    render(<BeaconConnectionControls feed={service} provider="corescope" />);
    fireEvent.change(screen.getByRole('combobox', { name: 'liveTraffic.beacon.region' }), {
      target: { value: 'BOS' },
    });
    expect(service.connect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.beacon.connect' }));
    await waitFor(() => {
      expect(service.connect).toHaveBeenCalledWith(CORESCOPE_PRESETS[0].baseUrl, 'BOS');
    });
  });
});
