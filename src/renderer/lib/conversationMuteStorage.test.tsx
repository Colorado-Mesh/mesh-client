import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setConnection, useConnectionStore } from '../stores/connectionStore';
import { useIdentityStore } from '../stores/identityStore';
import {
  resetLiveChannelKeyStoreForTests,
  setLiveChannelKeys,
} from '../stores/liveChannelKeyStore';
import { useNodeStore } from '../stores/nodeStore';
import { useReticulumIdentityStore } from '../stores/reticulumIdentityStore';
import { loadMutedViews } from './chatPanelProtocolStorage';
import {
  CONVERSATION_MUTES_KEY,
  migrateLegacyConversationMutes,
  saveConversationMutes,
  setConversationMuteMqttClientId,
} from './conversationMuteStorage';
import {
  clearMeshcorePubKeyRegistry,
  registerMeshcorePubKey,
} from './meshcore/meshcorePubKeyRegistry';
import { meshcoreContactToMeshNode, pubkeyToNodeId } from './meshcoreUtils';
import { meshcoreProtocol } from './protocols/MeshCoreProtocol';
import { meshtasticProtocol } from './protocols/MeshtasticProtocol';
import { reticulumProtocol } from './protocols/ReticulumProtocol';
import { isRrcRoomMuted } from './rrcMention';
import {
  MESHTASTIC_MQTT_SECRET_KEY,
  resetSecureSecretCacheForTests,
  setSecureSecret,
} from './secureSecretStorage';
import { meshNodeToNodeRecord } from './storeRecordAdapters';

function device(signature = 'aa' + '00'.repeat(31), slot = 0, key = 'channel-a') {
  useIdentityStore.setState({
    activeIdentityId: 'radio',
    identities: {
      radio: {
        id: 'radio',
        protocol: meshcoreProtocol,
        signature: `meshcore:pk:${signature}`,
        transports: [],
        createdAt: 1,
        lastSeenAt: 1,
      },
    },
  });
  setLiveChannelKeys('meshcore', {
    radioNodeId: pubkeyToNodeId(
      Uint8Array.from(signature.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16)),
    ),
    keyByIndex: { [slot]: key },
  });
}
function toggle(view: string) {
  const before = loadMutedViews('meshcore');
  const after = new Set(before);
  if (after.has(view)) after.delete(view);
  else after.add(view);
  return saveConversationMutes('meshcore', before, after);
}

describe('stable conversation mutes', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSecureSecretCacheForTests();
    useConnectionStore.setState({ connections: {} });
    setConversationMuteMqttClientId('meshtastic', '');
    setConversationMuteMqttClientId('meshcore', '');
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
    useNodeStore.setState({
      nodes: {
        radio: {
          192: { nodeId: 192, publicKey: new Uint8Array(32).fill(1) },
          5: { nodeId: 5, publicKey: new Uint8Array(32).fill(2) },
        },
      },
    });
    resetLiveChannelKeyStoreForTests();
    clearMeshcorePubKeyRegistry();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('survives reconnect and channel reordering without leaking to replacement channels/devices', () => {
    device();
    expect(toggle('ch:0')).toBe(true);
    expect(loadMutedViews('meshcore')).toEqual(new Set(['ch:0']));
    device('aa' + '00'.repeat(31), 2);
    expect(loadMutedViews('meshcore')).toEqual(new Set(['ch:2']));
    device('aa' + '00'.repeat(31), 0, 'other-channel');
    expect(loadMutedViews('meshcore').size).toBe(0);
    device('bb' + '00'.repeat(31));
    expect(loadMutedViews('meshcore').size).toBe(0);
    device('aa' + '00'.repeat(31), 2);
    expect(toggle('ch:2')).toBe(true);
    expect(loadMutedViews('meshcore').size).toBe(0);
  });

  it('migrates legacy mutes once, retains rollback data and allows unmute after reorder', () => {
    const legacy = JSON.stringify(['ch:0', 'room:192']);
    localStorage.setItem('mesh-client:mutedViews:meshcore', legacy);
    device();
    expect(migrateLegacyConversationMutes('meshcore')).toBe(true);
    expect(localStorage.getItem('mesh-client:mutedViews:meshcore')).toBe(legacy);
    device('aa' + '00'.repeat(31), 2);
    expect(loadMutedViews('meshcore')).toEqual(new Set(['ch:2', 'room:192']));
    expect(toggle('ch:2')).toBe(true);
    expect(loadMutedViews('meshcore')).toEqual(new Set(['room:192']));
    expect(migrateLegacyConversationMutes('meshcore')).toBe(false);
    device('bb' + '00'.repeat(31));
    expect(loadMutedViews('meshcore').size).toBe(0);
  });

  it('merges independent channel, DM and room writes rather than overwriting other panels', () => {
    device();
    useNodeStore.setState({
      nodes: {
        radio: {
          192: { nodeId: 192, publicKey: new Uint8Array(32).fill(1) },
          5: { nodeId: 5, publicKey: new Uint8Array(32).fill(2) },
        },
      },
    });
    expect(toggle('room:192')).toBe(true);
    expect(toggle('ch:0')).toBe(true);
    expect(toggle('dm:5')).toBe(true);
    expect(loadMutedViews('meshcore')).toEqual(new Set(['room:192', 'ch:0', 'dm:5']));
    expect(loadMutedViews('meshtastic').size).toBe(0);
    expect(toggle('room:192')).toBe(true);
    expect(loadMutedViews('meshcore')).toEqual(new Set(['ch:0', 'dm:5']));
  });

  it('scopes Meshtastic channel and DM choices to the finalized radio identity', () => {
    useIdentityStore.setState({
      activeIdentityId: 'radio',
      identities: {
        radio: {
          id: 'radio',
          protocol: meshtasticProtocol,
          signature: 'meshtastic:node:1',
          transports: [],
          createdAt: 1,
          lastSeenAt: 1,
        },
      },
    });
    setLiveChannelKeys('meshtastic', { radioNodeId: 1, keyByIndex: { 0: 'channel-a' } });
    expect(saveConversationMutes('meshtastic', new Set(), new Set(['ch:0', 'dm:5']))).toBe(true);
    setLiveChannelKeys('meshtastic', { radioNodeId: 1, keyByIndex: { 2: 'channel-a' } });
    expect(loadMutedViews('meshtastic')).toEqual(new Set(['ch:2', 'dm:5']));
    useIdentityStore.setState((state) => ({
      identities: { radio: { ...state.identities.radio, signature: 'meshtastic:node:2' } },
    }));
    setLiveChannelKeys('meshtastic', { radioNodeId: 2, keyByIndex: { 0: 'channel-a' } });
    expect(loadMutedViews('meshtastic').size).toBe(0);
    expect(loadMutedViews('meshcore').size).toBe(0);
  });

  it('does not transfer a MeshCore peer mute to a colliding short node id', () => {
    device();
    expect(toggle('dm:5')).toBe(true);
    useNodeStore.setState({
      nodes: { radio: { 5: { nodeId: 5, publicKey: new Uint8Array(32).fill(3) } } },
    });
    expect(loadMutedViews('meshcore').size).toBe(0);
  });

  it.each(['meshtastic', 'meshcore'] as const)(
    'persists %s MQTT-only choices separately from a radio and other client identities',
    (protocol) => {
      device();
      useIdentityStore.setState((state) => ({
        identities: {
          radio: {
            ...state.identities.radio,
            protocol: protocol === 'meshtastic' ? meshtasticProtocol : meshcoreProtocol,
            signature: '',
          },
        },
      }));
      setConnection('radio', { status: 'disconnected', mqttStatus: 'connected', myNodeNum: 77 });
      const prefix = protocol === 'meshtastic' ? 'meshtastic-electron-' : 'meshcore-mqtt-';
      setConversationMuteMqttClientId(protocol, prefix + 'a'.repeat(16));
      setLiveChannelKeys(protocol, { radioNodeId: 77, keyByIndex: { 0: 'mqtt-channel' } });
      expect(saveConversationMutes(protocol, new Set(), new Set(['ch:0', 'dm:5']))).toBe(true);
      expect(loadMutedViews(protocol)).toEqual(new Set(['ch:0', 'dm:5']));
      expect(localStorage.getItem(CONVERSATION_MUTES_KEY)).toContain(':mqtt:client:');
      setConversationMuteMqttClientId(protocol, prefix + 'b'.repeat(16));
      expect(loadMutedViews(protocol).size).toBe(0);
      setConversationMuteMqttClientId(protocol, prefix + 'a'.repeat(16));
      setConnection('radio', { status: 'connecting' });
      expect(loadMutedViews(protocol).size).toBe(0);
      expect(saveConversationMutes(protocol, new Set(), new Set(['ch:0']))).toBe(false);
      setConnection('radio', { status: 'disconnected' });
      expect(loadMutedViews(protocol)).toEqual(new Set(['ch:0', 'dm:5']));
      setLiveChannelKeys(protocol, { radioNodeId: 88, keyByIndex: { 0: 'mqtt-channel' } });
      expect(loadMutedViews(protocol)).toEqual(
        new Set(protocol === 'meshtastic' ? ['ch:0', 'dm:5'] : ['dm:5']),
      );
    },
  );

  it('supports MeshCore MQTT peer bells without inventing unavailable channel metadata', () => {
    device();
    useIdentityStore.setState((state) => ({
      identities: { radio: { ...state.identities.radio, signature: '' } },
    }));
    setConnection('radio', { status: 'disconnected', mqttStatus: 'connected', myNodeNum: 0 });
    setConversationMuteMqttClientId('meshcore', 'v1_' + 'ab'.repeat(32));
    setLiveChannelKeys('meshcore', null);
    expect(toggle('room:192')).toBe(true);
    expect(toggle('dm:5')).toBe(true);
    expect(toggle('ch:0')).toBe(false);
    expect(loadMutedViews('meshcore')).toEqual(new Set(['room:192', 'dm:5']));
  });

  it.each([undefined, 'LongFast@0=AQ==', 'QATest@0=AQEBAQEBAQEBAQEBAQEBAQ=='])(
    'binds canonical Meshtastic MQTT defaults/settings before RF channel discovery: %s',
    async (line) => {
      device();
      useIdentityStore.setState((state) => ({
        identities: {
          radio: { ...state.identities.radio, protocol: meshtasticProtocol, signature: '' },
        },
      }));
      setConnection('radio', { status: 'disconnected', mqttStatus: 'connected', myNodeNum: 77 });
      setConversationMuteMqttClientId('meshtastic', 'meshtastic-electron-' + 'a'.repeat(16));
      if (line)
        await setSecureSecret(MESHTASTIC_MQTT_SECRET_KEY, JSON.stringify({ channelPsks: [line] }));
      setLiveChannelKeys('meshtastic', null);
      expect(saveConversationMutes('meshtastic', new Set(), new Set(['ch:0']))).toBe(true);
      expect(loadMutedViews('meshtastic')).toEqual(new Set(['ch:0']));
      expect(saveConversationMutes('meshtastic', new Set(['ch:0']), new Set())).toBe(true);
      expect(loadMutedViews('meshtastic').size).toBe(0);
      if (line) expect(localStorage.getItem(CONVERSATION_MUTES_KEY)).not.toContain(line);
    },
  );

  it('retains a live contact full key after RF disconnect clears the transport registry', () => {
    device();
    const publicKey = new Uint8Array(32);
    publicKey[0] = 194;
    const node = meshcoreContactToMeshNode({
      publicKey,
      type: 1,
      advName: 'QA Peer',
      lastAdvert: 100,
      advLat: 0,
      advLon: 0,
    });
    useNodeStore.setState({ nodes: { radio: { 194: meshNodeToNodeRecord(node) } } });
    registerMeshcorePubKey(194, publicKey);
    expect(toggle('dm:194')).toBe(true);
    clearMeshcorePubKeyRegistry();
    setConnection('radio', { status: 'disconnected', mqttStatus: 'connected', myNodeNum: 0 });
    setConversationMuteMqttClientId('meshcore', 'meshcore-mqtt-' + 'a'.repeat(16));
    expect(toggle('dm:194')).toBe(true);
    expect(loadMutedViews('meshcore')).toEqual(new Set(['dm:194']));
  });

  it('refuses MQTT migration while a separate primary RF identity is connecting', () => {
    device();
    const original = useIdentityStore.getState().identities.radio;
    useIdentityStore.setState({
      activeIdentityId: 'pending',
      identities: {
        pending: { ...original, id: 'pending', signature: 'meshcore:tcp:127.0.0.1' },
        'offline-meshcore': { ...original, id: 'offline-meshcore', signature: '' },
      },
    });
    useNodeStore.setState({ nodes: { 'offline-meshcore': useNodeStore.getState().nodes.radio } });
    setConnection('pending', { status: 'connecting', mqttStatus: 'disconnected' });
    setConnection('offline-meshcore', { status: 'disconnected', mqttStatus: 'connected' });
    setConversationMuteMqttClientId('meshcore', 'meshcore-mqtt-' + 'a'.repeat(16));
    localStorage.setItem('mesh-client:mutedViews:meshcore', '["room:192"]');
    expect(migrateLegacyConversationMutes('meshcore')).toBe(false);
    expect(toggle('dm:5')).toBe(false);
    expect(localStorage.getItem(CONVERSATION_MUTES_KEY)).toBeNull();
  });

  it('mutes every slot of the same logical channel and unmutes from either bell', () => {
    device();
    setLiveChannelKeys('meshcore', {
      radioNodeId: 170,
      keyByIndex: { 0: 'channel-a', 2: 'channel-a' },
    });
    expect(toggle('ch:2')).toBe(true);
    expect(loadMutedViews('meshcore')).toEqual(new Set(['ch:0', 'ch:2']));
    expect(toggle('ch:0')).toBe(true);
    expect(loadMutedViews('meshcore').size).toBe(0);
    expect(toggle('ch:0')).toBe(true);
    expect(toggle('ch:2')).toBe(true);
    expect(loadMutedViews('meshcore').size).toBe(0);
  });

  it('migrates duplicate legacy slots once and prevents aliases leaking to a new radio', () => {
    device();
    setLiveChannelKeys('meshcore', {
      radioNodeId: 170,
      keyByIndex: { 0: 'channel-a', 2: 'channel-a' },
    });
    const legacy = '["ch:0","ch:2"]';
    localStorage.setItem('mesh-client:mutedViews:meshcore', legacy);
    expect(migrateLegacyConversationMutes('meshcore')).toBe(true);
    expect(migrateLegacyConversationMutes('meshcore')).toBe(false);
    device('bb' + '00'.repeat(31));
    expect(loadMutedViews('meshcore').size).toBe(0);
    expect(localStorage.getItem('mesh-client:mutedViews:meshcore')).toBe(legacy);
  });

  it('resolves real MeshCore contact keys from the shared registry and persisted hex records', () => {
    device();
    useNodeStore.setState({ nodes: {} });
    registerMeshcorePubKey(192, new Uint8Array(32).fill(4));
    expect(toggle('room:192')).toBe(true);
    useNodeStore.setState({
      nodes: { radio: { 5: { nodeId: 5, publicKeyHex: 'ab'.repeat(32) } } },
    });
    expect(toggle('dm:5')).toBe(true);
    expect(loadMutedViews('meshcore')).toEqual(new Set(['room:192', 'dm:5']));
  });

  it('keys RRC rooms by full hub identity and canonical room spelling', () => {
    expect(saveConversationMutes('reticulum', new Set(), new Set(['rrc:ABC:#General']))).toBe(true);
    const views = loadMutedViews('reticulum');
    expect(isRrcRoomMuted('abc', 'general', views)).toBe(true);
    expect(isRrcRoomMuted('def', 'general', views)).toBe(false);
    expect(saveConversationMutes('reticulum', views, new Set())).toBe(true);
    expect(isRrcRoomMuted('abc', '#GENERAL', loadMutedViews('reticulum'))).toBe(false);
  });

  it('keeps previous preferences and UI on quota errors, and rejects unavailable identity', () => {
    expect(toggle('ch:0')).toBe(false);
    device();
    expect(toggle('ch:0')).toBe(true);
    const stored = localStorage.getItem(CONVERSATION_MUTES_KEY);
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(toggle('ch:0')).toBe(false);
    expect(localStorage.getItem(CONVERSATION_MUTES_KEY)).toBe(stored);
    expect(loadMutedViews('meshcore')).toEqual(new Set(['ch:0']));
    write.mockRestore();
  });

  it('defers provisional identity and missing peer discovery, then preserves mutes while contacts reload', () => {
    device();
    useIdentityStore.setState((state) => ({
      identities: { radio: { ...state.identities.radio, signature: 'meshcore:tcp:127.0.0.1' } },
    }));
    localStorage.setItem('mesh-client:mutedViews:meshcore', '["room:192"]');
    expect(migrateLegacyConversationMutes('meshcore')).toBe(false);
    expect(toggle('ch:0')).toBe(false);
    device();
    useNodeStore.setState({ nodes: {} });
    expect(migrateLegacyConversationMutes('meshcore')).toBe(false);
    expect(toggle('dm:5')).toBe(false);
    useNodeStore.setState({
      nodes: {
        radio: {
          192: { nodeId: 192, publicKey: new Uint8Array(32).fill(1) },
          5: { nodeId: 5, publicKey: new Uint8Array(32).fill(2) },
        },
      },
    });
    expect(migrateLegacyConversationMutes('meshcore')).toBe(true);
    expect(loadMutedViews('meshcore')).toEqual(new Set(['room:192']));
    useNodeStore.setState({ nodes: {} });
    expect(loadMutedViews('meshcore')).toEqual(new Set(['room:192']));
    expect(toggle('room:192')).toBe(true);
    expect(loadMutedViews('meshcore').size).toBe(0);
  });

  it('does not bind legacy mutes to an old map during a staggered device switch', () => {
    device();
    useIdentityStore.setState((state) => ({
      identities: {
        radio: { ...state.identities.radio, signature: 'meshcore:pk:' + ('bb' + '00'.repeat(31)) },
      },
    }));
    localStorage.setItem('mesh-client:mutedViews:meshcore', '["ch:0"]');
    expect(migrateLegacyConversationMutes('meshcore')).toBe(false);
    expect(toggle('ch:0')).toBe(false);
    device('bb' + '00'.repeat(31), 0, 'new-radio-channel');
    expect(migrateLegacyConversationMutes('meshcore')).toBe(true);
    expect(loadMutedViews('meshcore')).toEqual(new Set(['ch:0']));
    expect(localStorage.getItem(CONVERSATION_MUTES_KEY)).toContain('new-radio-channel');
    expect(localStorage.getItem(CONVERSATION_MUTES_KEY)).not.toContain('channel-a');
  });

  it('retains reordered channel mutes after disconnect and permits offline unmute', () => {
    device();
    toggle('ch:0');
    device('aa' + '00'.repeat(31), 2);
    expect(loadMutedViews('meshcore')).toEqual(new Set(['ch:2']));
    setLiveChannelKeys('meshcore', null);
    expect(loadMutedViews('meshcore')).toEqual(new Set(['ch:2']));
    expect(toggle('ch:2')).toBe(true);
    expect(loadMutedViews('meshcore').size).toBe(0);
  });

  it('does not project an obsolete channel slot before discovery after restart', async () => {
    device();
    expect(toggle('ch:0')).toBe(true);
    device('aa' + '00'.repeat(31), 2);
    expect(loadMutedViews('meshcore')).toEqual(new Set(['ch:2']));
    // A fresh module has no retained layout, as on a cold renderer start.
    vi.resetModules();
    const { projectConversationMutes } = await import('./conversationMuteStorage');
    const { saveConversationMutes: saveAfterRestart } = await import('./conversationMuteStorage');
    const identities = await import('../stores/identityStore');
    identities.useIdentityStore.setState(useIdentityStore.getState());
    expect(projectConversationMutes('meshcore', new Set())).toEqual(new Set());
    expect(saveAfterRestart('meshcore', new Set(), new Set(['ch:0']))).toBe(false);
  });

  it('uses the real Reticulum local LXMF identity with its offline store bucket', () => {
    useIdentityStore.setState({
      activeIdentityId: 'offline-reticulum',
      identities: {
        'offline-reticulum': {
          id: 'offline-reticulum',
          protocol: reticulumProtocol,
          signature: '',
          transports: [],
          createdAt: 0,
          lastSeenAt: 0,
        },
      },
    });
    useReticulumIdentityStore
      .getState()
      .setIdentity({ configured: true, identity_hash: 'a'.repeat(32), lxmf_hash: 'b'.repeat(32) });
    useNodeStore.setState({
      nodes: {
        'offline-reticulum': { 5: { nodeId: 5, reticulumDestinationHash: 'c'.repeat(32) } },
      },
    });
    expect(saveConversationMutes('reticulum', new Set(), new Set(['dm:5']))).toBe(true);
    expect(loadMutedViews('reticulum')).toEqual(new Set(['dm:5']));
    useReticulumIdentityStore
      .getState()
      .setIdentity({ configured: true, identity_hash: 'd'.repeat(32), lxmf_hash: 'e'.repeat(32) });
    expect(loadMutedViews('reticulum').size).toBe(0);
  });

  it('preserves legacy mutes and refuses to overwrite a corrupt stable document', () => {
    device();
    localStorage.setItem(CONVERSATION_MUTES_KEY, '{bad');
    localStorage.setItem('mesh-client:mutedViews:meshcore', '["ch:0"]');
    expect(loadMutedViews('meshcore')).toEqual(new Set(['ch:0']));
    expect(toggle('ch:0')).toBe(false);
    expect(localStorage.getItem(CONVERSATION_MUTES_KEY)).toBe('{bad');
  });
});
