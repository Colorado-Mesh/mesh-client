import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { setConversationMuteMqttClientId } from '../lib/conversationMuteStorage';
import { meshcoreProtocol } from '../lib/protocols/MeshCoreProtocol';
import { setConnection, useConnectionStore } from '../stores/connectionStore';
import { useIdentityStore } from '../stores/identityStore';
import { setLiveChannelKeys } from '../stores/liveChannelKeyStore';
import { useNodeStore } from '../stores/nodeStore';
import { useConversationMuteMqttIdentity, useConversationMutes } from './useConversationMutes';

const addToast = vi.hoisted(() => vi.fn());
vi.mock('../components/Toast', () => ({ useToast: () => ({ addToast }) }));

beforeEach(() => {
  localStorage.clear();
  useConnectionStore.setState({ connections: {} });
  setConversationMuteMqttClientId('meshcore', '');
  setConversationMuteMqttClientId('meshtastic', '');
  addToast.mockReset();
  useNodeStore.setState({
    nodes: { radio: { 192: { nodeId: 192, publicKey: new Uint8Array(32).fill(1) } } },
  });
  useIdentityStore.setState({
    activeIdentityId: 'radio',
    identities: {
      radio: {
        id: 'radio',
        protocol: meshcoreProtocol,
        signature: 'meshcore:pk:' + ('aa' + '00'.repeat(31)),
        transports: [],
        createdAt: 1,
        lastSeenAt: 1,
      },
    },
  });
  setLiveChannelKeys('meshcore', { radioNodeId: 170, keyByIndex: { 0: 'channel-a' } });
});

it('synchronizes mounted panels and follows device/channel discovery without replaying mutations', () => {
  const first = renderHook(() => useConversationMutes('meshcore'));
  const second = renderHook(() => useConversationMutes('meshcore'));
  act(() => {
    first.result.current[1](new Set(['ch:0']));
  });
  expect(second.result.current[0]).toEqual(new Set(['ch:0']));
  act(() => {
    second.result.current[1]((views) => new Set([...views, 'room:192']));
  });
  expect(first.result.current[0]).toEqual(new Set(['ch:0', 'room:192']));
  act(() => {
    setLiveChannelKeys('meshcore', { radioNodeId: 170, keyByIndex: { 2: 'channel-a' } });
  });
  expect(first.result.current[0]).toEqual(new Set(['ch:2', 'room:192']));
  act(() => {
    first.result.current[1]((views) => new Set([...views].filter((v) => v !== 'ch:2')));
  });
  expect(second.result.current[0]).toEqual(new Set(['room:192']));
});

it('keeps both views unchanged on failure and exposes a retryable error', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const view = renderHook(() => useConversationMutes('meshcore'));
  const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  act(() => {
    view.result.current[1](new Set(['ch:0']));
  });
  expect(view.result.current[0].size).toBe(0);
  expect(addToast).toHaveBeenCalled();
  write.mockRestore();
  act(() => {
    view.result.current[1](new Set(['ch:0']));
  });
  expect(view.result.current[0]).toEqual(new Set(['ch:0']));
});

it('hydrates MQTT identity before legacy migration and ignores a stale initial response', async () => {
  let completeInitial: (id: string) => void = () => {};
  let clientEvent: Parameters<typeof window.electronAPI.mqtt.onClientId>[0] = () => {};
  const unsubscribe = vi.fn();
  vi.mocked(window.electronAPI.mqtt.getClientId).mockImplementation((protocol) =>
    protocol === 'meshcore'
      ? new Promise((resolve) => {
          completeInitial = resolve;
        })
      : Promise.resolve(''),
  );
  vi.mocked(window.electronAPI.mqtt.onClientId).mockImplementation((callback) => {
    clientEvent = callback;
    return unsubscribe;
  });
  useIdentityStore.setState((state) => ({
    identities: { radio: { ...state.identities.radio, signature: '' } },
  }));
  setConnection('radio', { status: 'disconnected', mqttStatus: 'connected', myNodeNum: 0 });
  localStorage.setItem('mesh-client:mutedViews:meshcore', '["room:192"]');
  const view = renderHook(() => {
    useConversationMuteMqttIdentity();
    return useConversationMutes('meshcore');
  });
  await act(async () => {
    clientEvent({ protocol: 'meshcore', clientId: 'meshcore-mqtt-' + 'a'.repeat(16) });
    completeInitial('meshcore-mqtt-' + 'b'.repeat(16));
    await Promise.resolve();
  });
  expect(view.result.current[0]).toEqual(new Set(['room:192']));
  expect(localStorage.getItem('mesh-client:conversationMutes:v1')).toContain('a'.repeat(16));
  expect(localStorage.getItem('mesh-client:conversationMutes:v1')).not.toContain('b'.repeat(16));
  act(() => {
    view.result.current[1](new Set());
  });
  expect(view.result.current[0].size).toBe(0);
  view.unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
