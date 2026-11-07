import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { meshtasticProtocol } from '@/renderer/lib/protocols/MeshtasticProtocol';
import { setDeviceChannels, useDeviceStore } from '@/renderer/stores/deviceStore';
import { useIdentityStore } from '@/renderer/stores/identityStore';
import {
  resetLiveChannelKeyStoreForTests,
  setLiveChannelKeys,
} from '@/renderer/stores/liveChannelKeyStore';

import { ScheduledBroadcastTargetPicker } from './ScheduledBroadcastTargetPicker';

beforeEach(() => {
  resetLiveChannelKeyStoreForTests();
  useDeviceStore.setState({ devices: {} });
  useIdentityStore.setState({
    identities: {
      mt: {
        id: 'mt',
        protocol: meshtasticProtocol,
        signature: 'meshtastic:sb-picker',
        transports: [],
        displayName: 'Radio',
        createdAt: 1,
        lastSeenAt: 1,
      },
    },
    activeIdentityId: 'mt',
  });
  setLiveChannelKeys('meshtastic', {
    radioNodeId: 1,
    keyByIndex: { 0: 'key0' },
  });
});

describe('ScheduledBroadcastTargetPicker', () => {
  it('shows the live channel name when deviceStore has it', () => {
    setDeviceChannels('mt', [{ index: 0, name: 'LongFast' }], []);
    render(<ScheduledBroadcastTargetPicker targets={[]} onChange={() => {}} />);
    expect(screen.getByLabelText('Meshtastic channel 0: LongFast')).toBeInTheDocument();
  });

  it('falls back to kind + index when the channel is unnamed', () => {
    render(<ScheduledBroadcastTargetPicker targets={[]} onChange={() => {}} />);
    expect(screen.getByLabelText('Meshtastic channel 0')).toBeInTheDocument();
  });
});
