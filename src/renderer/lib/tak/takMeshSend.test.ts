import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setConnection } from '../../stores/connectionStore';
import { addIdentity, useIdentityStore } from '../../stores/identityStore';
import {
  addMessage,
  renameMessageId,
  updateMessageStatus,
  useMessageStore,
} from '../../stores/messageStore';
import { useNodeStore } from '../../stores/nodeStore';
import { connectionDriver } from '../drivers/ConnectionDriver';
import { resetHeardRepeatWindowsForTests } from '../meshcore/heardRepeatTracker';
import { meshcoreProtocol } from '../protocols/MeshCoreProtocol';
import { meshtasticProtocol } from '../protocols/MeshtasticProtocol';
import { useRelayCoverageStore } from '../relayCoverage/relayCoverageStore';
import { registerMeshcoreSession } from '../sessions/meshcoreSession';
import {
  type MeshtasticSessionApi,
  registerMeshtasticSession,
} from '../sessions/meshtasticSession';
import { mockConsoleWarn } from '../vitestConsoleMock';
import { sendTakTextOnMesh, waitForOutboundSettled } from './takMeshSend';

vi.mock('../drivers/ConnectionDriver', () => ({
  connectionDriver: {
    getHandle: vi.fn(),
  },
}));

const ID_MC = 'id-tak-send-mc';
const ID_MT = 'id-tak-send-mt';

function addMeshcoreIdentity(): void {
  addIdentity({
    id: ID_MC,
    protocol: meshcoreProtocol,
    signature: 'sig-tak-mc',
    transports: [],
    createdAt: 1,
    lastSeenAt: 1,
  });
  setConnection(ID_MC, { status: 'configured', myNodeNum: 7 });
}

function rows(identityId: string) {
  return Object.values(useMessageStore.getState().messages[identityId] ?? {});
}

function sending(id: string) {
  return {
    id,
    from: 7,
    to: 0xffffffff,
    payload: 'x',
    channelIndex: 0,
    timestamp: 1,
    status: 'sending' as const,
  };
}

beforeEach(() => {
  registerMeshtasticSession(null);
  registerMeshcoreSession(null);
  useIdentityStore.setState({ identities: {}, activeIdentityId: null });
  useMessageStore.setState({ messages: {} });
  useNodeStore.setState({ nodes: {} });
  useRelayCoverageStore.setState({ coverage: {} });
  resetHeardRepeatWindowsForTests();
  vi.mocked(connectionDriver.getHandle).mockReturnValue(null);
  vi.spyOn(window.electronAPI.db, 'saveMeshcoreMessage').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('waitForOutboundSettled', () => {
  it('resolves at once when the message has already settled', async () => {
    addMessage(ID_MC, { ...sending('a'), status: 'failed' });
    await expect(waitForOutboundSettled(ID_MC, 'a')).resolves.toBe('failed');
  });

  it('resolves when the status leaves sending', async () => {
    addMessage(ID_MC, sending('a'));
    const settled = waitForOutboundSettled(ID_MC, 'a');
    updateMessageStatus(ID_MC, 'a', 'acked');
    await expect(settled).resolves.toBe('acked');
  });

  it('follows the message through a re-key to its packet id', async () => {
    addMessage(ID_MC, sending('provisional'));
    const settled = waitForOutboundSettled(ID_MC, 'provisional');
    renameMessageId(ID_MC, 'provisional', '456');
    updateMessageStatus(ID_MC, '456', 'acked');
    await expect(settled).resolves.toBe('acked');
  });

  it('gives up after the timeout so no waiter is left behind', async () => {
    vi.useFakeTimers();
    addMessage(ID_MC, sending('a'));
    const settled = waitForOutboundSettled(ID_MC, 'a', 1_000);
    vi.advanceTimersByTime(1_000);
    await expect(settled).resolves.toBe('timeout');
  });
});

describe('sendTakTextOnMesh', () => {
  it('sends MeshCore channel text through the Chat path and resolves once accepted', async () => {
    const sendSpy = vi.spyOn(meshcoreProtocol, 'sendMessage').mockResolvedValue({});
    vi.mocked(connectionDriver.getHandle).mockReturnValue({ kind: 'rf' });
    addMeshcoreIdentity();

    await sendTakTextOnMesh(
      { identityId: ID_MC, protocol: 'meshcore', channelIndex: 2 },
      '[VIPER] on scene',
    );

    expect(sendSpy).toHaveBeenCalledWith(
      { kind: 'rf' },
      expect.objectContaining({ text: '[VIPER] on scene', channelIndex: 2 }),
    );
    expect(rows(ID_MC)).toEqual([
      expect.objectContaining({ payload: '[VIPER] on scene', channelIndex: 2, status: 'acked' }),
    ]);
  });

  it('sends a direct message through the Chat path without waiting for its ack', async () => {
    // The companion has not answered yet: a channel send would still be waiting here.
    const sendSpy = vi
      .spyOn(meshcoreProtocol, 'sendMessage')
      .mockImplementation(() => new Promise(() => {}));
    vi.mocked(connectionDriver.getHandle).mockReturnValue({ kind: 'rf' });
    addMeshcoreIdentity();

    await sendTakTextOnMesh(
      { identityId: ID_MC, protocol: 'meshcore', channelIndex: 0, destination: 123 },
      '[VIPER] meet at the gate',
    );

    expect(sendSpy).toHaveBeenCalledWith(
      { kind: 'rf' },
      expect.objectContaining({ text: '[VIPER] meet at the gate', destination: 123 }),
    );
    expect(rows(ID_MC)).toEqual([
      expect.objectContaining({ to: 123, channelIndex: -1, status: 'sending' }),
    ]);
  });

  it('rejects when the MeshCore send fails, leaving the message failed in Chat', async () => {
    mockConsoleWarn();
    vi.spyOn(meshcoreProtocol, 'sendMessage').mockRejectedValue(new Error('rf down'));
    vi.mocked(connectionDriver.getHandle).mockReturnValue({ kind: 'rf' });
    addMeshcoreIdentity();

    await expect(
      sendTakTextOnMesh({ identityId: ID_MC, protocol: 'meshcore', channelIndex: 0 }, 'hi'),
    ).rejects.toThrow('MeshCore send failed');
    expect(rows(ID_MC)).toEqual([expect.objectContaining({ status: 'failed' })]);
  });

  it('rejects when MeshCore is not connected', async () => {
    mockConsoleWarn();
    addMeshcoreIdentity();
    await expect(
      sendTakTextOnMesh({ identityId: ID_MC, protocol: 'meshcore', channelIndex: 0 }, 'hi'),
    ).rejects.toThrow('meshcore send was not started');
    expect(rows(ID_MC)).toEqual([]);
  });

  it('queues Meshtastic text with the runtime and resolves without waiting for the ack', async () => {
    const sendChatMessage = vi.fn().mockReturnValue('123');
    registerMeshtasticSession({ sendChatMessage } as unknown as MeshtasticSessionApi);
    vi.mocked(connectionDriver.getHandle).mockReturnValue({ kind: 'rf' });
    addIdentity({
      id: ID_MT,
      protocol: meshtasticProtocol,
      signature: 'sig-tak-mt',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID_MT, { status: 'configured', myNodeNum: 42 });

    await sendTakTextOnMesh(
      { identityId: ID_MT, protocol: 'meshtastic', channelIndex: 1 },
      '[VIPER] copy',
    );

    expect(sendChatMessage).toHaveBeenCalledWith('[VIPER] copy', 1, undefined, undefined);
  });

  it('rejects for an identity that no longer exists', async () => {
    mockConsoleWarn();
    await expect(
      sendTakTextOnMesh({ identityId: 'gone', protocol: 'meshcore', channelIndex: 0 }, 'hi'),
    ).rejects.toThrow('meshcore send was not started');
  });
});
