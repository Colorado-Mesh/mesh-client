import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { setDeviceChannels, useDeviceStore } from '@/renderer/stores/deviceStore';
import {
  resetLiveChannelKeyStoreForTests,
  setLiveChannelKeys,
} from '@/renderer/stores/liveChannelKeyStore';
import {
  resetScheduledBroadcastsStoreForTests,
  useScheduledBroadcastsStore,
} from '@/renderer/stores/scheduledBroadcastsStore';
import type { ScheduledBroadcastRow } from '@/shared/scheduledBroadcastTypes';

import ScheduledBroadcastsPanel from './ScheduledBroadcastsPanel';

beforeEach(() => {
  resetScheduledBroadcastsStoreForTests();
  resetLiveChannelKeyStoreForTests();
  useDeviceStore.setState({ devices: {} });
  useScheduledBroadcastsStore.setState({ hydrated: true });
});

describe('ScheduledBroadcastsPanel', () => {
  it('renders 12 slots', () => {
    render(<ScheduledBroadcastsPanel />);
    expect(screen.getAllByText(/^B\d+$/).length).toBe(12);
  });

  it('shows a respect warning against channel spam', () => {
    render(<ScheduledBroadcastsPanel />);
    expect(screen.getByText(/be respectful of shared lora airtime/i)).toBeInTheDocument();
  });

  it('shows airtime warning for frequent intervals with many targets', () => {
    const manyTargets = [0, 1, 2].map((i) => ({
      kind: 'meshcore-channel' as const,
      identityId: 'mc1',
      label: `Ch${i}`,
      enabled: true,
      channelIndex: i,
    }));
    const row: ScheduledBroadcastRow = {
      slot: 1,
      label: 'Frequent',
      text: 'hello',
      enabled: true,
      interval: 'every4h',
      timeOfDayMin: 6 * 60,
      weekday: null,
      dayOfMonth: null,
      anchorYmd: null,
      nextDueAt: null,
      lastAttemptAt: null,
      lastResult: null,
      updatedAt: 1,
      targets: manyTargets,
    };
    useScheduledBroadcastsStore.setState({
      hydrated: true,
      slots: { ...useScheduledBroadcastsStore.getState().slots, 1: row },
    });
    const { unmount } = render(<ScheduledBroadcastsPanel />);
    expect(screen.getByText(/frequent schedules with many targets/i)).toBeInTheDocument();
    unmount();

    useScheduledBroadcastsStore.setState({
      hydrated: true,
      slots: {
        ...useScheduledBroadcastsStore.getState().slots,
        1: { ...row, interval: 'hourly' },
      },
    });
    const { unmount: unmountHourly } = render(<ScheduledBroadcastsPanel />);
    expect(screen.getByText(/frequent schedules with many targets/i)).toBeInTheDocument();
    unmountHourly();

    useScheduledBroadcastsStore.setState({
      hydrated: true,
      slots: {
        ...useScheduledBroadcastsStore.getState().slots,
        1: { ...row, interval: 'daily' },
      },
    });
    render(<ScheduledBroadcastsPanel />);
    expect(screen.queryByText(/frequent schedules with many targets/i)).not.toBeInTheDocument();
  });

  it('opens editor from Add', async () => {
    const user = userEvent.setup();
    render(<ScheduledBroadcastsPanel />);
    await user.click(screen.getAllByRole('button', { name: /add broadcast/i })[0]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(<ScheduledBroadcastsPanel />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('refreshes channel target chips with live names', () => {
    setLiveChannelKeys('meshtastic', {
      radioNodeId: 1,
      keyByIndex: { 0: 'key0' },
    });
    setDeviceChannels('mt', [{ index: 0, name: 'LongFast' }], []);
    const row: ScheduledBroadcastRow = {
      slot: 1,
      label: 'Check-in',
      text: 'hello',
      enabled: true,
      interval: 'daily',
      timeOfDayMin: 8 * 60,
      weekday: null,
      dayOfMonth: null,
      anchorYmd: null,
      nextDueAt: null,
      lastAttemptAt: null,
      lastResult: null,
      updatedAt: 1,
      targets: [
        {
          kind: 'meshtastic-channel',
          identityId: 'mt',
          label: 'Meshtastic channel 0',
          enabled: true,
          channelIndex: 0,
          channelKey: 'key0',
        },
      ],
    };
    useScheduledBroadcastsStore.setState({
      hydrated: true,
      slots: { ...useScheduledBroadcastsStore.getState().slots, 1: row },
    });
    render(<ScheduledBroadcastsPanel />);
    expect(screen.getByText('Meshtastic channel 0: LongFast')).toBeInTheDocument();

    act(() => {
      setDeviceChannels('mt', [{ index: 0, name: 'MediumSlow' }], []);
    });
    expect(screen.getByText('Meshtastic channel 0: MediumSlow')).toBeInTheDocument();
    expect(screen.queryByText('Meshtastic channel 0: LongFast')).not.toBeInTheDocument();
  });
});
