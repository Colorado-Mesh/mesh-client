import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { OFFLINE_MESHCORE_IDENTITY_ID } from '@/renderer/lib/offlineProtocolIdentities';
import { meshcoreProtocol } from '@/renderer/lib/protocols/MeshCoreProtocol';
import { meshtasticProtocol } from '@/renderer/lib/protocols/MeshtasticProtocol';
import { reticulumProtocol } from '@/renderer/lib/protocols/ReticulumProtocol';
import { setConnection, useConnectionStore } from '@/renderer/stores/connectionStore';
import {
  setDeviceChannels,
  setMeshcoreChannels,
  useDeviceStore,
} from '@/renderer/stores/deviceStore';
import { useIdentityStore } from '@/renderer/stores/identityStore';
import {
  resetLiveChannelKeyStoreForTests,
  setLiveChannelKeys,
} from '@/renderer/stores/liveChannelKeyStore';
import { upsertNode, useNodeStore } from '@/renderer/stores/nodeStore';
import { useRrcHubStore } from '@/renderer/stores/rrcHubStore';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';

import { ScheduledBroadcastTargetPicker } from './ScheduledBroadcastTargetPicker';

const HUB = 'aabbccddeeff00112233445566778899';

beforeEach(() => {
  resetLiveChannelKeyStoreForTests();
  useDeviceStore.setState({ devices: {} });
  useConnectionStore.setState({ connections: {} });
  useNodeStore.setState({ nodes: {} });
  useRrcHubStore.setState({ hubs: new Map(), lastRefreshAt: null });
  useRrcSessionStore.setState({
    hubDestHash: null,
    rooms: new Map(),
    sessionsByHub: new Map(),
  });
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

  it('uses radio name and connected status instead of offline-* id legends', () => {
    useIdentityStore.setState({
      identities: {
        [OFFLINE_MESHCORE_IDENTITY_ID]: {
          id: OFFLINE_MESHCORE_IDENTITY_ID,
          protocol: meshcoreProtocol,
          signature: '',
          transports: [],
          createdAt: 0,
          lastSeenAt: 0,
          selfNodeNum: 7,
        },
      },
      activeIdentityId: OFFLINE_MESHCORE_IDENTITY_ID,
    });
    setLiveChannelKeys('meshcore', {
      radioNodeId: 7,
      keyByIndex: { 0: 'mckey' },
    });
    upsertNode(OFFLINE_MESHCORE_IDENTITY_ID, {
      nodeId: 7,
      longName: 'Peak Relay',
      shortName: 'PR',
    });
    setConnection(OFFLINE_MESHCORE_IDENTITY_ID, { status: 'connected', myNodeNum: 7 });
    setMeshcoreChannels(OFFLINE_MESHCORE_IDENTITY_ID, [
      { index: 0, name: 'Public', key: new Uint8Array(16) },
    ]);
    render(<ScheduledBroadcastTargetPicker targets={[]} onChange={() => {}} />);
    expect(screen.getByText('Peak Relay (connected)')).toBeInTheDocument();
    expect(screen.queryByText(/^offline-/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('MeshCore channel 0: Public')).toBeInTheDocument();
  });

  it('labels RRC rooms with the hub display name', () => {
    useIdentityStore.setState({
      identities: {
        rns: {
          id: 'rns',
          protocol: reticulumProtocol,
          signature: '',
          transports: [],
          createdAt: 1,
          lastSeenAt: 1,
        },
      },
      activeIdentityId: 'rns',
    });
    useRrcHubStore.getState().upsertFromEvent({
      destination_hash: HUB,
      display_name: 'Denver Hub',
      source: 'discovered',
    });
    useRrcSessionStore.setState({
      hubDestHash: HUB,
      rooms: new Map([['lobby', { name: 'lobby' }]]),
      sessionsByHub: new Map(),
    });
    render(<ScheduledBroadcastTargetPicker targets={[]} onChange={() => {}} />);
    expect(screen.getByLabelText('Denver Hub — lobby')).toBeInTheDocument();
  });
});
