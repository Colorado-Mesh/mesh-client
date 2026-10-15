import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import type { HeardMeshBeacon } from '../lib/meshtastic/meshtasticModuleEvents';
import { renderWithToast } from '../lib/testRenderHelpers';
import { MeshBeaconHeardList } from './MeshBeaconHeardList';

const channels = [{ index: 0, name: '', role: 1, psk: new Uint8Array([1]) }];
const lora = { region: 1, modemPreset: 0, usePreset: true, channelNum: 0 };

function heard(from: number, p: Partial<HeardMeshBeacon>): HeardMeshBeacon {
  return {
    from,
    timestamp: Date.now(),
    message: '',
    offerChannel: null,
    offerRegion: 0,
    offerPreset: null,
    offerFrequencySlot: null,
    ...p,
  };
}

function renderList(
  beacons: HeardMeshBeacon[],
  overrides: Partial<Parameters<typeof MeshBeaconHeardList>[0]> = {},
) {
  const onJoinChannel = vi.fn().mockResolvedValue(undefined);
  const onApplyLora = vi.fn().mockResolvedValue(undefined);
  const view = renderWithToast(
    <MeshBeaconHeardList
      beacons={new Map(beacons.map((b) => [b.from, b]))}
      getNodeName={(n) => `Node ${n}`}
      channelConfigs={channels}
      loraConfig={lora}
      disabled={false}
      canJoin
      onJoinChannel={onJoinChannel}
      onApplyLora={onApplyLora}
      {...overrides}
    />,
  );
  return { ...view, onJoinChannel, onApplyLora };
}

describe('MeshBeaconHeardList', () => {
  it('shows an empty state', () => {
    renderList([]);
    expect(screen.getByText(/No beacons heard yet/)).toBeInTheDocument();
  });

  it('joins an offered channel into the first free slot after confirmation', async () => {
    const user = userEvent.setup();
    const psk = new Uint8Array([7, 7]);
    const { onJoinChannel } = renderList([
      heard(5, { message: 'Welcome', offerChannel: { name: 'Ops', psk } }),
    ]);
    expect(screen.getByText('Welcome')).toBeInTheDocument();
    expect(screen.getByText('Channel: Ops')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Join channel Ops offered by Node 5' }));
    expect(screen.getByText('Join channel?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Join' }));

    await waitFor(() => {
      expect(onJoinChannel).toHaveBeenCalledWith(1, { name: 'Ops', psk });
    });
  });

  it('does nothing when the join is cancelled', async () => {
    const user = userEvent.setup();
    const { onJoinChannel } = renderList([
      heard(5, { offerChannel: { name: 'Ops', psk: new Uint8Array([7]) } }),
    ]);
    await user.click(screen.getByRole('button', { name: /Join channel Ops/ }));
    const cancelButtons = screen.getAllByRole('button', { name: 'Cancel' });
    await user.click(cancelButtons[cancelButtons.length - 1]);
    expect(screen.queryByText('Join channel?')).toBeNull();
    expect(onJoinChannel).not.toHaveBeenCalled();
  });

  it('marks a channel that is already on the radio', () => {
    renderList([heard(5, { offerChannel: { name: '', psk: new Uint8Array([1]) } })]);
    expect(screen.getByText('Channel already on this radio (slot 0)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Join channel/ })).toBeNull();
  });

  it('applies radio settings after confirmation', async () => {
    const user = userEvent.setup();
    const { onApplyLora } = renderList([heard(6, { offerPreset: 3, offerFrequencySlot: 20 })]);
    await user.click(screen.getByRole('button', { name: 'Use radio settings offered by Node 6' }));
    expect(screen.getByText(/frequency slot 20/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply and reboot' }));
    await waitFor(() => {
      expect(onApplyLora).toHaveBeenCalledWith({
        modemPreset: 3,
        usePreset: true,
        channelNum: 20,
      });
    });
  });

  it('blocks a radio offer for a different region', () => {
    renderList([heard(6, { offerRegion: 3, offerPreset: 3 })]);
    expect(screen.queryByRole('button', { name: /Use radio settings/ })).toBeNull();
    expect(screen.getByText(/this radio is set to/)).toBeInTheDocument();
  });

  it('hides join actions for a remote target', () => {
    renderList([heard(5, { offerChannel: { name: 'Ops', psk: new Uint8Array([7]) } })], {
      canJoin: false,
    });
    expect(screen.queryByRole('button', { name: /Join channel/ })).toBeNull();
    expect(screen.getByText(/only available for the connected radio/)).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = renderList([
      heard(5, { message: 'Hi', offerChannel: { name: 'Ops', psk: new Uint8Array([7]) } }),
      heard(6, { offerRegion: 3, offerPreset: 3 }),
    ]);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
