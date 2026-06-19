import { beforeEach, describe, expect, it } from 'vitest';

import { addIdentity, setActiveIdentity, useIdentityStore } from '../stores/identityStore';
import { upsertMessage, useMessageStore } from '../stores/messageStore';
import { upsertNode } from '../stores/nodeStore';
import {
  getIdentityIdForProtocol,
  resolveIdentityIdForProtocol,
  resolvePrimaryIdentityIdForProtocol,
} from './identityByProtocol';
import { mergeOfflineStoreIntoIdentity } from './mergeOfflineIdentityStore';
import {
  ensureOfflineProtocolIdentities,
  OFFLINE_MESHCORE_IDENTITY_ID,
  OFFLINE_MESHTASTIC_IDENTITY_ID,
} from './offlineProtocolIdentities';
import { meshcoreProtocol } from './protocols/MeshCoreProtocol';
import { meshtasticProtocol } from './protocols/MeshtasticProtocol';

describe('getIdentityIdForProtocol', () => {
  beforeEach(() => {
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
  });

  it('prefers active identity when it matches the protocol', () => {
    addIdentity({
      id: 'id-mt-old',
      protocol: meshtasticProtocol,
      signature: 'a',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    addIdentity({
      id: 'id-mt-new',
      protocol: meshtasticProtocol,
      signature: 'b',
      transports: [],
      createdAt: 2,
      lastSeenAt: 2,
    });
    setActiveIdentity('id-mt-new');
    expect(getIdentityIdForProtocol('meshtastic')).toBe('id-mt-new');
  });

  it('returns earliest-created identity when active identity is another protocol', () => {
    addIdentity({
      id: 'id-mt',
      protocol: meshtasticProtocol,
      signature: 'a',
      transports: [],
      createdAt: 10,
      lastSeenAt: 1,
    });
    addIdentity({
      id: 'id-mc',
      protocol: meshcoreProtocol,
      signature: 'b',
      transports: [],
      createdAt: 5,
      lastSeenAt: 1,
    });
    setActiveIdentity('id-mc');
    expect(getIdentityIdForProtocol('meshtastic')).toBe('id-mt');
  });

  it('prefers offline identity when primary is empty and offline has hydrated data', () => {
    ensureOfflineProtocolIdentities();
    addIdentity({
      id: 'id-mt-connected-empty',
      protocol: meshtasticProtocol,
      signature: 'meshtastic:node:99',
      transports: [],
      createdAt: 50,
      lastSeenAt: 50,
    });
    setActiveIdentity('id-mt-connected-empty');
    upsertNode(OFFLINE_MESHTASTIC_IDENTITY_ID, { nodeId: 1, longName: 'From DB' });
    expect(getIdentityIdForProtocol('meshtastic')).toBe(OFFLINE_MESHTASTIC_IDENTITY_ID);
  });

  it('keeps connected primary when offline has nodes but primary has live messages', () => {
    ensureOfflineProtocolIdentities();
    const connectedId = 'id-mc-connected-live';
    addIdentity({
      id: connectedId,
      protocol: meshcoreProtocol,
      signature: 'meshcore:pubkey:abc',
      transports: [
        {
          transportId: 't1',
          type: 'ble',
          status: 'connected',
          params: { type: 'ble', peripheralId: 'ble-test' },
        },
      ],
      createdAt: 50,
      lastSeenAt: 50,
    });
    setActiveIdentity(connectedId);
    upsertNode(OFFLINE_MESHCORE_IDENTITY_ID, { nodeId: 1, longName: 'Hydrated contact' });
    upsertMessage(connectedId, {
      id: 'live-1',
      from: 2,
      to: 0,
      payload: 'live traffic',
      channelIndex: 30,
      timestamp: Date.now(),
    });
    expect(getIdentityIdForProtocol('meshcore')).toBe(connectedId);
  });

  it('keeps connected primary when offline has nodes and primary store is empty', () => {
    ensureOfflineProtocolIdentities();
    const connectedId = 'id-mc-connected-empty-store';
    addIdentity({
      id: connectedId,
      protocol: meshcoreProtocol,
      signature: 'meshcore:pubkey:def',
      transports: [
        {
          transportId: 't1',
          type: 'ble',
          status: 'connected',
          params: { type: 'ble', peripheralId: 'ble-test-2' },
        },
      ],
      createdAt: 50,
      lastSeenAt: 50,
    });
    setActiveIdentity(connectedId);
    upsertNode(OFFLINE_MESHCORE_IDENTITY_ID, { nodeId: 1, longName: 'Hydrated contact' });
    expect(getIdentityIdForProtocol('meshcore')).toBe(connectedId);
  });

  it('reproduces stuck-chat split then merge restores unified bucket', () => {
    ensureOfflineProtocolIdentities();
    const connectedId = 'id-mc-prior-session';
    addIdentity({
      id: connectedId,
      protocol: meshcoreProtocol,
      signature: 'meshcore:device:2215091743',
      transports: [
        {
          transportId: 't1',
          type: 'ble',
          status: 'connected',
          params: { type: 'ble', peripheralId: 'win32-ble' },
        },
      ],
      createdAt: 100,
      lastSeenAt: 100,
    });
    setActiveIdentity(connectedId);

    const staleTs = Date.parse('2026-06-19T07:00:00.000Z');
    const liveTs = Date.parse('2026-06-19T08:30:00.000Z');
    upsertMessage(OFFLINE_MESHCORE_IDENTITY_ID, {
      id: 'offline-stale',
      from: 1,
      to: 0,
      payload: 'stale hydrated tail',
      channelIndex: 30,
      timestamp: staleTs,
    });
    upsertMessage(connectedId, {
      id: 'live-missing',
      from: 2,
      to: 0,
      payload: 'great job filling in when meshbud is napping',
      channelIndex: 30,
      timestamp: liveTs,
    });

    expect(getIdentityIdForProtocol('meshcore')).toBe(connectedId);

    mergeOfflineStoreIntoIdentity('meshcore', connectedId);
    const merged = useMessageStore.getState().messages[connectedId] ?? {};
    expect(Object.keys(merged)).toContain('offline-stale');
    expect(Object.keys(merged)).toContain('live-missing');
  });

  it('resolveIdentityIdForProtocol matches getIdentityIdForProtocol', () => {
    addIdentity({
      id: 'id-mt-resolve',
      protocol: meshtasticProtocol,
      signature: 'c',
      transports: [],
      createdAt: 3,
      lastSeenAt: 1,
    });
    const state = useIdentityStore.getState();
    expect(
      resolveIdentityIdForProtocol(state.identities, state.activeIdentityId, 'meshtastic'),
    ).toBe(getIdentityIdForProtocol('meshtastic'));
  });

  it('resolvePrimaryIdentityIdForProtocol returns active protocol identity', () => {
    ensureOfflineProtocolIdentities();
    addIdentity({
      id: 'id-mc-active',
      protocol: meshcoreProtocol,
      signature: 'sig',
      transports: [],
      createdAt: 20,
      lastSeenAt: 20,
    });
    setActiveIdentity('id-mc-active');
    const state = useIdentityStore.getState();
    expect(
      resolvePrimaryIdentityIdForProtocol(state.identities, state.activeIdentityId, 'meshcore'),
    ).toBe('id-mc-active');
  });
});
