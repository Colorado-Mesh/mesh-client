import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { setMeshcoreRoomCredential } from '@/renderer/lib/meshcoreRoomCredentialStorage';
import {
  meshcoreApplyRoomSession,
  meshcoreClearAllRoomSessions,
} from '@/renderer/lib/meshcoreRoomSession';
import { OFFLINE_MESHCORE_IDENTITY_ID } from '@/renderer/lib/offlineProtocolIdentities';
import { meshcoreProtocol } from '@/renderer/lib/protocols/MeshCoreProtocol';
import { meshtasticProtocol } from '@/renderer/lib/protocols/MeshtasticProtocol';
import { reticulumProtocol } from '@/renderer/lib/protocols/ReticulumProtocol';
import { resetSecureSecretCacheForTests } from '@/renderer/lib/secureSecretStorage';
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
import { upsertNode, upsertNodeRecord, useNodeStore } from '@/renderer/stores/nodeStore';
import { useRrcHubStore } from '@/renderer/stores/rrcHubStore';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';

import { ScheduledBroadcastTargetPicker } from './ScheduledBroadcastTargetPicker';

const ROOM_PUB = 'aa'.repeat(32);

const HUB = 'aabbccddeeff00112233445566778899';

beforeEach(() => {
  resetLiveChannelKeyStoreForTests();
  localStorage.clear();
  resetSecureSecretCacheForTests();
  meshcoreClearAllRoomSessions();
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

function setupMeshcoreWithRoom(opts?: { nodeId?: number; name?: string }): {
  identityId: string;
  nodeId: number;
} {
  const identityId = 'mc';
  const nodeId = opts?.nodeId ?? 0xabcd;
  useIdentityStore.setState({
    identities: {
      [identityId]: {
        id: identityId,
        protocol: meshcoreProtocol,
        signature: 'meshcore:sb-picker',
        transports: [],
        displayName: 'NVON',
        createdAt: 1,
        lastSeenAt: 1,
      },
    },
    activeIdentityId: identityId,
  });
  setLiveChannelKeys('meshcore', {
    radioNodeId: 1,
    keyByIndex: { 0: 'mckey' },
  });
  setMeshcoreChannels(identityId, [{ index: 0, name: 'Public', key: new Uint8Array(16) }]);
  upsertNodeRecord(identityId, {
    nodeId,
    longName: opts?.name ?? 'Unknown Room',
    shortName: 'UR',
    hwModel: 'Room',
    publicKeyHex: ROOM_PUB,
  });
  return { identityId, nodeId };
}

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

  it('hides MeshCore rooms with neither login nor saved password', () => {
    setupMeshcoreWithRoom({ name: 'Stranger Room' });
    render(<ScheduledBroadcastTargetPicker targets={[]} onChange={() => {}} />);
    expect(screen.queryByLabelText('Stranger Room')).not.toBeInTheDocument();
    expect(screen.getByLabelText('MeshCore channel 0: Public')).toBeInTheDocument();
  });

  it('shows MeshCore rooms that can post', () => {
    const { nodeId } = setupMeshcoreWithRoom({ name: 'Logged Room' });
    meshcoreApplyRoomSession(nodeId, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    render(<ScheduledBroadcastTargetPicker targets={[]} onChange={() => {}} />);
    expect(screen.getByLabelText('Logged Room')).toBeInTheDocument();
  });

  it('shows MeshCore rooms with a saved password only', async () => {
    const { nodeId } = setupMeshcoreWithRoom({ name: 'Saved Room' });
    await setMeshcoreRoomCredential(nodeId, { guestPassword: 'hello' });
    render(<ScheduledBroadcastTargetPicker targets={[]} onChange={() => {}} />);
    expect(screen.getByLabelText('Saved Room')).toBeInTheDocument();
  });

  it('removes a MeshCore room from the open picker when its guest password is forgotten', async () => {
    const { nodeId } = setupMeshcoreWithRoom({ name: 'Forgettable Room' });
    await setMeshcoreRoomCredential(nodeId, { guestPassword: 'hello' });
    render(<ScheduledBroadcastTargetPicker targets={[]} onChange={() => {}} />);
    expect(screen.getByLabelText('Forgettable Room')).toBeInTheDocument();
    await act(async () => {
      await setMeshcoreRoomCredential(nodeId, null);
    });
    expect(screen.queryByLabelText('Forgettable Room')).not.toBeInTheDocument();
  });

  it('keeps ineligible selected MeshCore rooms under saved targets', () => {
    const { identityId } = setupMeshcoreWithRoom({ name: 'Orphan Room' });
    render(
      <ScheduledBroadcastTargetPicker
        targets={[
          {
            kind: 'meshcore-room',
            identityId,
            label: 'Orphan Room',
            enabled: true,
            roomPubKeyHex: ROOM_PUB,
            roomNodeId: 0xabcd,
          },
        ]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText('Orphan Room')).toBeInTheDocument();
    expect(screen.getByText('Saved targets')).toBeInTheDocument();
  });
});
