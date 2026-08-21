import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeAppSetting } from '../lib/appSettingsStorage';
import { connectionDriver } from '../lib/drivers/ConnectionDriver';
import { resetHeardRepeatWindowsForTests } from '../lib/meshcore/heardRepeatTracker';
import { setMeshcoreTcpOpenHopDeadAccepted } from '../lib/meshcore/meshcoreTcpInitBurst';
import { meshcoreProtocol } from '../lib/protocols/MeshCoreProtocol';
import { meshtasticProtocol } from '../lib/protocols/MeshtasticProtocol';
import { reticulumProtocol } from '../lib/protocols/ReticulumProtocol';
import { useRelayCoverageStore } from '../lib/relayCoverage/relayCoverageStore';
import { registerReticulumDestinationHash } from '../lib/reticulum/destHash';
import { type MeshcoreSessionApi, registerMeshcoreSession } from '../lib/sessions/meshcoreSession';
import {
  type MeshtasticSessionApi,
  registerMeshtasticSession,
} from '../lib/sessions/meshtasticSession';
import {
  registerReticulumSession,
  type ReticulumSessionApi,
} from '../lib/sessions/reticulumSession';
import { mockConsoleWarn } from '../lib/vitestConsoleMock';
import { setConnection } from '../stores/connectionStore';
import { addIdentity, useIdentityStore } from '../stores/identityStore';
import { addMessage, useMessageStore } from '../stores/messageStore';
import { upsertNode } from '../stores/nodeStore';

const ID_MC_FAIL = 'id-send-mc-fail';
const ID_MC_DM = 'id-send-mc-dm';
import { useSendMessage } from './useSendMessage';

const ID_MT = 'id-send-mt';
const ID_MC = 'id-send-mc';
const ID_RT = 'id-send-rt';

vi.mock('../lib/drivers/ConnectionDriver', () => ({
  connectionDriver: {
    getHandle: vi.fn(),
  },
}));

function createMeshtasticSessionStub(): MeshtasticSessionApi {
  return {
    prepareRfConnect: vi.fn(),
    attachRfSession: vi.fn(),
    handleRfConnectFailure: vi.fn(),
    finalizeDriverDisconnect: vi.fn(),
    connectAutomatic: vi.fn(),
    sendChatMessage: vi.fn(),
  };
}

function createMeshcoreSessionStub(
  overrides: Partial<MeshcoreSessionApi> = {},
): MeshcoreSessionApi {
  return {
    connect: vi.fn(),
    prepareRfConnect: vi.fn(),
    attachRfSession: vi.fn(),
    handleRfConnectFailure: vi.fn(),
    finalizeDriverDisconnect: vi.fn(),
    connectAutomatic: vi.fn(),
    ...overrides,
  };
}

describe('useSendMessage', () => {
  beforeEach(() => {
    vi.mocked(connectionDriver.getHandle).mockClear();
    registerMeshtasticSession(null);
    registerMeshcoreSession(null);
    registerReticulumSession(null);
    setMeshcoreTcpOpenHopDeadAccepted(false);
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
    useMessageStore.setState({ messages: {} });
    useRelayCoverageStore.setState({ coverage: {} });
    resetHeardRepeatWindowsForTests();
    vi.mocked(connectionDriver.getHandle).mockReturnValue(null);
    vi.spyOn(window.electronAPI.db, 'saveMeshcoreMessage').mockResolvedValue(undefined);
  });

  it('delegates to Meshtastic runtime sendChatMessage when MQTT-only (no RF handle)', () => {
    const session = createMeshtasticSessionStub();
    registerMeshtasticSession(session);
    addIdentity({
      id: ID_MT,
      protocol: meshtasticProtocol,
      signature: 'sig-mt',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID_MT, { mqttStatus: 'connected', status: 'disconnected', myNodeNum: 42 });

    const { result } = renderHook(() => useSendMessage(ID_MT));
    result.current('hello mqtt', 0, undefined, '42');

    expect(session.sendChatMessage).toHaveBeenCalledWith('hello mqtt', 0, undefined, 42);
  });

  it('warns when Meshtastic has no handle, no session, and MQTT is disconnected', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    addIdentity({
      id: ID_MT,
      protocol: meshtasticProtocol,
      signature: 'sig-mt',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID_MT, { mqttStatus: 'disconnected', status: 'disconnected', myNodeNum: 0 });

    const { result } = renderHook(() => useSendMessage(ID_MT));
    result.current('hello', 0);

    expect(warn).toHaveBeenCalledWith(
      '[useSendMessage] Meshtastic runtime not mounted and no RF handle',
    );
    warn.mockRestore();
  });

  it('delegates hybrid Meshtastic send to runtime TransportManager when session mounted', () => {
    const session = createMeshtasticSessionStub();
    registerMeshtasticSession(session);
    const handle = { kind: 'rf' };
    vi.mocked(connectionDriver.getHandle).mockReturnValue(handle);
    addIdentity({
      id: ID_MT,
      protocol: meshtasticProtocol,
      signature: 'sig-mt',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID_MT, { mqttStatus: 'connected', status: 'configured', myNodeNum: 42 });

    const { result } = renderHook(() => useSendMessage(ID_MT));
    result.current('hello hybrid', 0);

    expect(session.sendChatMessage).toHaveBeenCalledWith('hello hybrid', 0, undefined, undefined);
  });

  it('persists Meshtastic optimistic send to SQLite with temp packet_id via runtime session', () => {
    const saveMessage = vi.spyOn(window.electronAPI.db, 'saveMessage').mockResolvedValue(undefined);
    const session = createMeshtasticSessionStub();
    registerMeshtasticSession(session);
    const handle = { kind: 'rf' };
    vi.mocked(connectionDriver.getHandle).mockReturnValue(handle);
    addIdentity({
      id: ID_MT,
      protocol: meshtasticProtocol,
      signature: 'sig-mt',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID_MT, { status: 'configured', myNodeNum: 42, mqttStatus: 'connected' });

    const { result } = renderHook(() => useSendMessage(ID_MT));
    result.current('persist me', 0);

    expect(session.sendChatMessage).toHaveBeenCalledWith('persist me', 0, undefined, undefined);
    saveMessage.mockRestore();
  });

  it('sends via protocol when RF handle exists', async () => {
    const sendSpy = vi.spyOn(meshcoreProtocol, 'sendMessage').mockResolvedValue({ packetId: 1 });
    const handle = { kind: 'rf' };
    vi.mocked(connectionDriver.getHandle).mockReturnValue(handle);
    addIdentity({
      id: ID_MC,
      protocol: meshcoreProtocol,
      signature: 'sig-mc',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID_MC, { status: 'configured', myNodeNum: 7 });

    const { result } = renderHook(() => useSendMessage(ID_MC));
    result.current('hi meshcore', 1);

    await vi.waitFor(() => {
      expect(sendSpy).toHaveBeenCalledWith(
        handle,
        expect.objectContaining({ text: 'hi meshcore', channelIndex: 1 }),
      );
    });
    sendSpy.mockRestore();
  });

  it('opens MeshCore heard-repeat window for channel sends (not DMs)', async () => {
    const sendSpy = vi.spyOn(meshcoreProtocol, 'sendMessage').mockResolvedValue({});
    const handle = { kind: 'rf' };
    vi.mocked(connectionDriver.getHandle).mockReturnValue(handle);
    addIdentity({
      id: ID_MC,
      protocol: meshcoreProtocol,
      signature: 'sig-mc',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID_MC, { status: 'configured', myNodeNum: 7 });

    const { result } = renderHook(() => useSendMessage(ID_MC));
    result.current('heard window', 8);

    await vi.waitFor(() => {
      expect(sendSpy).toHaveBeenCalled();
    });
    const rows = Object.values(useMessageStore.getState().messages[ID_MC] ?? {});
    expect(rows).toHaveLength(1);
    const msgId = rows[0].id;
    expect(msgId.startsWith('out:')).toBe(true);
    expect(useRelayCoverageStore.getState().coverageFor(ID_MC, msgId)).toMatchObject({
      protocol: 'meshcore',
      mode: 'confirmed',
      heardRepeaters: [],
    });
    sendSpy.mockRestore();
  });

  it('sends MeshCore channel reply with keyless @[Name] wire prefix when parent is in store', async () => {
    const sendSpy = vi.spyOn(meshcoreProtocol, 'sendMessage').mockResolvedValue({});
    const handle = { kind: 'rf' };
    vi.mocked(connectionDriver.getHandle).mockReturnValue(handle);
    addIdentity({
      id: ID_MC,
      protocol: meshcoreProtocol,
      signature: 'sig-mc',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID_MC, { status: 'configured', myNodeNum: 7 });
    addMessage(ID_MC, {
      id: '99',
      from: 10,
      senderName: 'durk',
      to: 0xffffffff,
      payload: 'flight data',
      channelIndex: 25,
      timestamp: 1_700_000_000_000,
      status: 'acked',
    });

    const { result } = renderHook(() => useSendMessage(ID_MC));
    result.current('reply test', 25, undefined, '99');

    await vi.waitFor(() => {
      expect(sendSpy).toHaveBeenCalledWith(
        handle,
        expect.objectContaining({ text: '@[durk] reply test', channelIndex: 25 }),
      );
    });
    const rows = Object.values(useMessageStore.getState().messages[ID_MC] ?? {});
    const outbound = rows.find((m) => m.payload === 'reply test');
    expect(outbound?.payload).toBe('reply test');
    expect(outbound?.replyTo).toBe('99');
    sendSpy.mockRestore();
  });

  it('does not open heard-repeat window for MeshCore DMs', async () => {
    const sendSpy = vi.spyOn(meshcoreProtocol, 'sendMessage').mockResolvedValue({
      packetId: 0xabcd,
    });
    const handle = { kind: 'rf' };
    vi.mocked(connectionDriver.getHandle).mockReturnValue(handle);
    const peerId = 0x22;
    const pubKey = new Uint8Array(32).fill(3);
    addIdentity({
      id: ID_MC_DM,
      protocol: meshcoreProtocol,
      signature: 'sig-mc-dm',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID_MC_DM, { status: 'configured', myNodeNum: 7 });
    upsertNode(ID_MC_DM, {
      nodeId: peerId,
      longName: 'Peer',
      publicKey: pubKey,
    });

    const { result } = renderHook(() => useSendMessage(ID_MC_DM));
    result.current('dm hello', -1, peerId);

    await vi.waitFor(() => {
      const rows = Object.values(useMessageStore.getState().messages[ID_MC_DM] ?? {});
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('acked');
    });
    const rows = Object.values(useMessageStore.getState().messages[ID_MC_DM] ?? {});
    const msgId = rows[0].id;
    expect(useRelayCoverageStore.getState().coverageFor(ID_MC_DM, msgId)).toBeUndefined();
    sendSpy.mockRestore();
  });

  it('sends MeshCore GIF as g: wire when Open compat is enabled', async () => {
    mergeAppSetting('meshcoreOpenWireCompatEnabled', true, 'useSendMessage.test');
    const sendSpy = vi.spyOn(meshcoreProtocol, 'sendMessage').mockResolvedValue({});
    const handle = { kind: 'rf' };
    vi.mocked(connectionDriver.getHandle).mockReturnValue(handle);
    addIdentity({
      id: ID_MC,
      protocol: meshcoreProtocol,
      signature: 'sig-mc',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID_MC, { status: 'configured', myNodeNum: 7 });

    const { result } = renderHook(() => useSendMessage(ID_MC));
    result.current('https://giphy.com/gifs/funny-a5viI92PAF89q', 1);

    await vi.waitFor(() => {
      expect(sendSpy).toHaveBeenCalledWith(
        handle,
        expect.objectContaining({ text: 'g:a5viI92PAF89q', channelIndex: 1 }),
      );
    });
    const rows = Object.values(useMessageStore.getState().messages[ID_MC] ?? {});
    expect(rows[0]?.payload).toBe('g:a5viI92PAF89q');
    mergeAppSetting('meshcoreOpenWireCompatEnabled', false, 'useSendMessage.test');
    sendSpy.mockRestore();
  });

  it('sends keyed MeshCore channel reply when Open compat is enabled', async () => {
    mergeAppSetting('meshcoreOpenWireCompatEnabled', true, 'useSendMessage.test');
    const sendSpy = vi.spyOn(meshcoreProtocol, 'sendMessage').mockResolvedValue({});
    const handle = { kind: 'rf' };
    vi.mocked(connectionDriver.getHandle).mockReturnValue(handle);
    addIdentity({
      id: ID_MC,
      protocol: meshcoreProtocol,
      signature: 'sig-mc',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID_MC, { status: 'configured', myNodeNum: 7 });
    addMessage(ID_MC, {
      id: '99',
      from: 10,
      senderName: 'durk',
      to: 0xffffffff,
      payload: 'flight data',
      channelIndex: 25,
      timestamp: 1_700_000_000_000,
      status: 'acked',
    });

    const { result } = renderHook(() => useSendMessage(ID_MC));
    result.current('reply test', 25, undefined, '99');

    await vi.waitFor(() => {
      expect(sendSpy).toHaveBeenCalledWith(
        handle,
        expect.objectContaining({ text: '@[durk#99] reply test', channelIndex: 25 }),
      );
    });
    mergeAppSetting('meshcoreOpenWireCompatEnabled', false, 'useSendMessage.test');
    sendSpy.mockRestore();
  });

  it('OpenHop dead-accepted: sends via runMeshcoreUserTxWithLiveTcp without RF handle', async () => {
    setMeshcoreTcpOpenHopDeadAccepted(true);
    const liveHandle = { kind: 'openhop-live' };
    let runTxCalls = 0;
    const runTx: NonNullable<MeshcoreSessionApi['runMeshcoreUserTxWithLiveTcp']> = async (op) => {
      runTxCalls += 1;
      vi.mocked(connectionDriver.getHandle).mockReturnValue(liveHandle);
      return op();
    };
    registerMeshcoreSession(
      createMeshcoreSessionStub({
        runMeshcoreUserTxWithLiveTcp: runTx,
      }),
    );
    const sendSpy = vi.spyOn(meshcoreProtocol, 'sendMessage').mockResolvedValue({
      packetId: 0xbeef01,
    });
    vi.mocked(connectionDriver.getHandle).mockReturnValue(null);
    addIdentity({
      id: ID_MC,
      protocol: meshcoreProtocol,
      signature: 'sig-mc',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID_MC, { status: 'configured', myNodeNum: 7 });

    const { result } = renderHook(() => useSendMessage(ID_MC));
    result.current('openhop hi', 1);

    await vi.waitFor(() => {
      expect(runTxCalls).toBe(1);
      expect(sendSpy).toHaveBeenCalledWith(
        liveHandle,
        expect.objectContaining({ text: 'openhop hi', channelIndex: 1 }),
      );
      const rows = Object.values(useMessageStore.getState().messages[ID_MC] ?? {});
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('acked');
      expect(rows[0]?.id).toBe(String(0xbeef01));
    });
    sendSpy.mockRestore();
  });

  it('OpenHop dead-accepted: falls back to ensureTcpLiveForUserTx when runTx missing', async () => {
    setMeshcoreTcpOpenHopDeadAccepted(true);
    const liveHandle = { kind: 'openhop-ensure' };
    const ensureTcpLiveForUserTx = vi.fn(() => {
      vi.mocked(connectionDriver.getHandle).mockReturnValue(liveHandle);
      return Promise.resolve();
    });
    registerMeshcoreSession(
      createMeshcoreSessionStub({
        ensureTcpLiveForUserTx,
      }),
    );
    const sendSpy = vi.spyOn(meshcoreProtocol, 'sendMessage').mockResolvedValue({
      packetId: 0xbeef2,
    });
    vi.mocked(connectionDriver.getHandle).mockReturnValue(null);
    addIdentity({
      id: ID_MC,
      protocol: meshcoreProtocol,
      signature: 'sig-mc',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID_MC, { status: 'configured', myNodeNum: 7 });

    const { result } = renderHook(() => useSendMessage(ID_MC));
    result.current('openhop ensure', 2);

    await vi.waitFor(() => {
      expect(ensureTcpLiveForUserTx).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(
        liveHandle,
        expect.objectContaining({ text: 'openhop ensure', channelIndex: 2 }),
      );
      const rows = Object.values(useMessageStore.getState().messages[ID_MC] ?? {});
      expect(rows[0]?.status).toBe('acked');
    });
    sendSpy.mockRestore();
  });

  it('OpenHop dead-accepted: marks failed when live reopen yields no handle', async () => {
    setMeshcoreTcpOpenHopDeadAccepted(true);
    const { spy: warn, restore } = mockConsoleWarn();
    try {
      registerMeshcoreSession(
        createMeshcoreSessionStub({
          runMeshcoreUserTxWithLiveTcp: vi.fn((op) => op()),
        }),
      );
      vi.mocked(connectionDriver.getHandle).mockReturnValue(null);
      addIdentity({
        id: ID_MC,
        protocol: meshcoreProtocol,
        signature: 'sig-mc',
        transports: [],
        createdAt: 1,
        lastSeenAt: 1,
      });
      setConnection(ID_MC, { status: 'configured', myNodeNum: 7 });

      const { result } = renderHook(() => useSendMessage(ID_MC));
      result.current('openhop fail', 1);

      await vi.waitFor(() => {
        const rows = Object.values(useMessageStore.getState().messages[ID_MC] ?? {});
        expect(rows).toHaveLength(1);
        expect(rows[0]?.status).toBe('failed');
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('OpenHop live reopen failed'));
    } finally {
      restore();
    }
  });

  it('marks MeshCore DM acked when send resolves with packetId', async () => {
    const sendSpy = vi.spyOn(meshcoreProtocol, 'sendMessage').mockResolvedValue({
      packetId: 0xabcd,
    });
    const handle = { kind: 'rf' };
    vi.mocked(connectionDriver.getHandle).mockReturnValue(handle);
    const peerId = 0x22;
    const pubKey = new Uint8Array(32).fill(0xab);
    addIdentity({
      id: ID_MC_DM,
      protocol: meshcoreProtocol,
      signature: 'sig-mc-dm',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID_MC_DM, { status: 'configured', myNodeNum: 7 });
    upsertNode(ID_MC_DM, {
      nodeId: peerId,
      longName: 'Peer',
      publicKey: pubKey,
    });

    const { result } = renderHook(() => useSendMessage(ID_MC_DM));
    result.current('dm hello', -1, peerId);

    await vi.waitFor(() => {
      const rows = Object.values(useMessageStore.getState().messages[ID_MC_DM] ?? {});
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('acked');
      expect(rows[0]?.id).toBe(String(0xabcd));
    });
    sendSpy.mockRestore();
  });

  it('persists MeshCore outbound to meshcore_messages after send resolves', async () => {
    const saveMeshcoreMessage = vi
      .spyOn(window.electronAPI.db, 'saveMeshcoreMessage')
      .mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(meshcoreProtocol, 'sendMessage').mockResolvedValue({});
    const handle = { kind: 'rf' };
    vi.mocked(connectionDriver.getHandle).mockReturnValue(handle);
    addIdentity({
      id: ID_MC,
      protocol: meshcoreProtocol,
      signature: 'sig-mc',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID_MC, { status: 'configured', myNodeNum: 7 });

    const { result } = renderHook(() => useSendMessage(ID_MC));
    result.current('persist meshcore', 6);

    await vi.waitFor(() => {
      expect(saveMeshcoreMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: 'persist meshcore',
          channel_idx: 6,
          sender_id: 7,
          status: 'acked',
        }),
      );
    });
    sendSpy.mockRestore();
    saveMeshcoreMessage.mockRestore();
  });

  it('marks optimistic message failed when protocol send rejects', async () => {
    const sendSpy = vi
      .spyOn(meshcoreProtocol, 'sendMessage')
      .mockImplementation(() => Promise.reject(new Error('rf down')));
    const handle = { kind: 'rf' };
    vi.mocked(connectionDriver.getHandle).mockReturnValue(handle);
    addIdentity({
      id: ID_MC_FAIL,
      protocol: meshcoreProtocol,
      signature: 'sig-mc-fail',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID_MC_FAIL, { status: 'configured', myNodeNum: 7 });

    const { result } = renderHook(() => useSendMessage(ID_MC_FAIL));
    result.current('fail payload', 0);

    await vi.waitFor(() => {
      const rows = Object.values(useMessageStore.getState().messages[ID_MC_FAIL] ?? {});
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('failed');
      expect(rows[0]?.error).toContain('rf down');
    });
    sendSpy.mockRestore();
  });

  it('persists optimistic Reticulum outbound to SQLite', () => {
    const saveReticulum = vi
      .spyOn(window.electronAPI.db, 'saveReticulumMessage')
      .mockResolvedValue(undefined);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    registerReticulumSession({
      connect: vi.fn(),
      connectAutomatic: vi.fn(),
      disconnect: vi.fn(),
      finalizeDriverDisconnect: vi.fn(),
      selfNodeId: 0xabcd,
      getFullNodeLabel: () => 'Self',
      sendMessage,
    } satisfies ReticulumSessionApi);
    registerReticulumDestinationHash(0xabcd, 'cc'.repeat(16));
    registerReticulumDestinationHash(0x1234, 'dd'.repeat(16));
    addIdentity({
      id: ID_RT,
      protocol: reticulumProtocol,
      signature: 'sig-rt',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });

    const { result } = renderHook(() => useSendMessage(ID_RT));
    result.current('hello lxmf', 0, 0x1234);

    const rows = Object.values(useMessageStore.getState().messages[ID_RT] ?? {});
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('sending');
    expect(saveReticulum).toHaveBeenCalledWith(
      expect.objectContaining({
        identity_id: ID_RT,
        payload: 'hello lxmf',
        delivery_status: 'sending',
      }),
    );
    saveReticulum.mockRestore();
  });

  it('sends Reticulum reply with truncated preview when parent is in store', () => {
    const saveReticulum = vi
      .spyOn(window.electronAPI.db, 'saveReticulumMessage')
      .mockResolvedValue(undefined);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    registerReticulumSession({
      connect: vi.fn(),
      connectAutomatic: vi.fn(),
      disconnect: vi.fn(),
      finalizeDriverDisconnect: vi.fn(),
      selfNodeId: 0xabcd,
      getFullNodeLabel: () => 'Self',
      sendMessage,
    } satisfies ReticulumSessionApi);
    registerReticulumDestinationHash(0xabcd, 'cc'.repeat(16));
    registerReticulumDestinationHash(0x1234, 'dd'.repeat(16));
    addIdentity({
      id: ID_RT,
      protocol: reticulumProtocol,
      signature: 'sig-rt',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    const parentHash = 'aa'.repeat(32);
    const longPayload = 'x'.repeat(80);
    addMessage(ID_RT, {
      id: 'parent-1',
      from: 0x1234,
      senderName: 'Peer',
      to: 0xabcd,
      payload: longPayload,
      channelIndex: 0,
      timestamp: 1000,
      status: 'acked',
      reticulumMessageHash: parentHash,
    });

    const { result } = renderHook(() => useSendMessage(ID_RT));
    result.current('reply body', 0, 0x1234, parentHash);

    expect(sendMessage).toHaveBeenCalledWith(
      'reply body',
      'dd'.repeat(16),
      parentHash,
      expect.any(String),
      expect.stringMatching(/^x{50}…$/),
    );
    const rows = Object.values(useMessageStore.getState().messages[ID_RT] ?? {});
    const outbound = rows.find((r) => r.payload === 'reply body');
    expect(outbound?.reticulumReplyToHash).toBe(parentHash);
    expect(outbound?.replyPreviewText).toMatch(/^x{50}…$/);
    expect(outbound?.replyPreviewSender).toBe('Peer');
    saveReticulum.mockRestore();
  });

  it('sends Reticulum reply without preview when parent is missing', () => {
    const saveReticulum = vi
      .spyOn(window.electronAPI.db, 'saveReticulumMessage')
      .mockResolvedValue(undefined);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    registerReticulumSession({
      connect: vi.fn(),
      connectAutomatic: vi.fn(),
      disconnect: vi.fn(),
      finalizeDriverDisconnect: vi.fn(),
      selfNodeId: 0xabcd,
      getFullNodeLabel: () => 'Self',
      sendMessage,
    } satisfies ReticulumSessionApi);
    registerReticulumDestinationHash(0xabcd, 'cc'.repeat(16));
    registerReticulumDestinationHash(0x1234, 'dd'.repeat(16));
    addIdentity({
      id: ID_RT,
      protocol: reticulumProtocol,
      signature: 'sig-rt',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    const missingHash = 'bb'.repeat(32);

    const { result } = renderHook(() => useSendMessage(ID_RT));
    result.current('orphan reply', 0, 0x1234, missingHash);

    expect(sendMessage).toHaveBeenCalledWith(
      'orphan reply',
      'dd'.repeat(16),
      missingHash,
      expect.any(String),
      undefined,
    );
    const rows = Object.values(useMessageStore.getState().messages[ID_RT] ?? {});
    const outbound = rows.find((r) => r.payload === 'orphan reply');
    expect(outbound?.reticulumReplyToHash).toBe(missingHash);
    expect(outbound?.replyPreviewText).toBeUndefined();
    saveReticulum.mockRestore();
  });

  it('reuses the failed Reticulum row on retry instead of adding a second bubble', () => {
    const saveReticulum = vi
      .spyOn(window.electronAPI.db, 'saveReticulumMessage')
      .mockResolvedValue(undefined);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    registerReticulumSession({
      connect: vi.fn(),
      connectAutomatic: vi.fn(),
      disconnect: vi.fn(),
      finalizeDriverDisconnect: vi.fn(),
      selfNodeId: 0xabcd,
      getFullNodeLabel: () => 'Self',
      sendMessage,
    } satisfies ReticulumSessionApi);
    registerReticulumDestinationHash(0xabcd, 'cc'.repeat(16));
    registerReticulumDestinationHash(0x1234, 'dd'.repeat(16));
    addIdentity({
      id: ID_RT,
      protocol: reticulumProtocol,
      signature: 'sig-rt',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    const failedHash = 'ee'.repeat(32);
    const failedAt = 1_700_000_000_000;
    addMessage(ID_RT, {
      id: failedHash,
      from: 0xabcd,
      senderName: 'Self',
      to: 0x1234,
      payload: 'retry me',
      channelIndex: 0,
      timestamp: failedAt,
      status: 'failed',
      error: 'delivery failed',
      reticulumMessageHash: failedHash,
      reticulumDeliveryMethod: 'propagated',
      receivedVia: 'tcp',
    });

    const { result } = renderHook(() => useSendMessage(ID_RT));
    result.current('retry me', 0, 0x1234, undefined, failedHash);

    const byId = useMessageStore.getState().messages[ID_RT] ?? {};
    expect(Object.keys(byId)).toHaveLength(1);
    expect(byId[failedHash]).toMatchObject({
      id: failedHash,
      payload: 'retry me',
      timestamp: failedAt,
      status: 'sending',
      error: undefined,
      reticulumDeliveryMethod: undefined,
      reticulumMessageHash: undefined,
    });
    expect(byId[failedHash]?.reticulumMessageHash).toBeUndefined();
    expect(sendMessage).toHaveBeenCalledWith(
      'retry me',
      'dd'.repeat(16),
      undefined,
      failedHash,
      undefined,
    );
    saveReticulum.mockRestore();
  });
});
