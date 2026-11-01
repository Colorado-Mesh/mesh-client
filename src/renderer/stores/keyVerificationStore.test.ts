import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerMeshtasticKeyVerificationSender } from '../lib/meshtastic/meshtasticKeyVerification';
import type { IdentityId } from '../lib/types';
import {
  applyKeyVerificationClientNotification,
  cancelKeyVerification,
  confirmKeyVerification,
  initiateKeyVerification,
  recordKeyVerificationPacket,
  resetKeyVerificationStore,
  submitKeyVerificationSecurityNumber,
  useKeyVerificationStore,
} from './keyVerificationStore';
import { useNodeStore } from './nodeStore';

const ID = 'id-kv' as IdentityId;
const REMOTE = 0xabcd01;

function seedNode(nodeId = REMOTE, longName = 'Remote Op'): void {
  useNodeStore.setState({
    nodes: { [ID]: { [nodeId]: { nodeId, longName, keyManuallyVerified: false } } },
  });
}

describe('keyVerificationStore', () => {
  const sender = vi.fn();
  let unregister: () => void;

  beforeEach(() => {
    resetKeyVerificationStore();
    useNodeStore.setState({ nodes: {} });
    sender.mockReset().mockResolvedValue(undefined);
    unregister = registerMeshtasticKeyVerificationSender(sender);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    unregister();
    vi.restoreAllMocks();
  });

  it('initiator flow: initiate → number request → submit → final → verify updates the badge', async () => {
    seedNode();
    await initiateKeyVerification(ID, REMOTE, 'Remote Op');
    expect(sender).toHaveBeenLastCalledWith({ type: 'initiate', remoteNodeNum: REMOTE });
    expect(useKeyVerificationStore.getState().session?.phase).toBe('initiating');

    expect(
      applyKeyVerificationClientNotification(ID, {
        payloadVariant: {
          case: 'keyVerificationNumberRequest',
          value: { nonce: 77n, remoteLongname: 'Remote Op' },
        },
      }),
    ).toBe(true);
    let session = useKeyVerificationStore.getState().session;
    expect(session).toMatchObject({ phase: 'enterNumber', nonce: 77n, remoteNodeNum: REMOTE });

    await submitKeyVerificationSecurityNumber('123 456');
    expect(sender).toHaveBeenLastCalledWith({
      type: 'provideSecurityNumber',
      remoteNodeNum: REMOTE,
      nonce: 77n,
      securityNumber: 123456,
    });

    applyKeyVerificationClientNotification(ID, {
      payloadVariant: {
        case: 'keyVerificationFinal',
        value: {
          nonce: 77n,
          remoteLongname: 'Remote Op',
          isSender: true,
          verificationCharacters: 'AB12',
        },
      },
    });
    session = useKeyVerificationStore.getState().session;
    expect(session).toMatchObject({ phase: 'compare', verificationCharacters: 'AB12' });

    await confirmKeyVerification(true);
    expect(sender).toHaveBeenLastCalledWith({
      type: 'doVerify',
      remoteNodeNum: REMOTE,
      nonce: 77n,
    });
    expect(useKeyVerificationStore.getState().session?.phase).toBe('done');
    expect(useNodeStore.getState().nodes[ID][REMOTE].keyManuallyVerified).toBe(true);
  });

  it('responder flow: shows the security number and binds the node via the mesh packet nonce', () => {
    seedNode(REMOTE, 'Initiator');
    recordKeyVerificationPacket(ID, { from: REMOTE, nonce: 5n });
    applyKeyVerificationClientNotification(ID, {
      payloadVariant: {
        case: 'keyVerificationNumberInform',
        value: { nonce: 5n, remoteLongname: 'Someone Else', securityNumber: 4242 },
      },
    });
    expect(useKeyVerificationStore.getState().session).toMatchObject({
      phase: 'showNumber',
      securityNumber: 4242,
      isSender: false,
      remoteNodeNum: REMOTE,
    });
  });

  it('binds a packet that arrives after the notification', () => {
    applyKeyVerificationClientNotification(ID, {
      payloadVariant: {
        case: 'keyVerificationNumberInform',
        value: { nonce: 9n, remoteLongname: 'Ghost', securityNumber: 1 },
      },
    });
    expect(useKeyVerificationStore.getState().session?.remoteNodeNum).toBeNull();
    recordKeyVerificationPacket(ID, { from: 0x55, nonce: 9n });
    expect(useKeyVerificationStore.getState().session?.remoteNodeNum).toBe(0x55);
  });

  it('falls back to a unique long-name match when no packet was seen', () => {
    seedNode(REMOTE, 'Unique Name');
    applyKeyVerificationClientNotification(ID, {
      payloadVariant: {
        case: 'keyVerificationNumberInform',
        value: { nonce: 1n, remoteLongname: 'Unique Name', securityNumber: 1 },
      },
    });
    expect(useKeyVerificationStore.getState().session?.remoteNodeNum).toBe(REMOTE);
  });

  it('declining does not mark the node verified', async () => {
    seedNode();
    await initiateKeyVerification(ID, REMOTE, 'Remote Op');
    applyKeyVerificationClientNotification(ID, {
      payloadVariant: {
        case: 'keyVerificationFinal',
        value: {
          nonce: 3n,
          remoteLongname: 'Remote Op',
          isSender: true,
          verificationCharacters: 'X',
        },
      },
    });
    await confirmKeyVerification(false);
    expect(sender).toHaveBeenLastCalledWith({
      type: 'doNotVerify',
      remoteNodeNum: REMOTE,
      nonce: 3n,
    });
    expect(useKeyVerificationStore.getState().session?.phase).toBe('rejected');
    expect(useNodeStore.getState().nodes[ID][REMOTE].keyManuallyVerified).toBe(false);
  });

  it('rejects an invalid security number without sending', async () => {
    await initiateKeyVerification(ID, REMOTE, 'Remote Op');
    applyKeyVerificationClientNotification(ID, {
      payloadVariant: {
        case: 'keyVerificationNumberRequest',
        value: { nonce: 1n, remoteLongname: 'Remote Op' },
      },
    });
    sender.mockClear();
    await submitKeyVerificationSecurityNumber('abc');
    await submitKeyVerificationSecurityNumber('0');
    expect(sender).not.toHaveBeenCalled();
    expect(useKeyVerificationStore.getState().session).toMatchObject({
      phase: 'enterNumber',
      errorCode: 'invalid_number',
    });
  });

  it('surfaces a send failure as an error phase', async () => {
    sender.mockRejectedValue(new Error('offline'));
    await initiateKeyVerification(ID, REMOTE, 'Remote Op');
    expect(useKeyVerificationStore.getState().session).toMatchObject({
      phase: 'error',
      errorCode: 'send_failed',
    });
  });

  it('does not mark the node verified when DO_VERIFY fails to send', async () => {
    seedNode();
    await initiateKeyVerification(ID, REMOTE, 'Remote Op');
    applyKeyVerificationClientNotification(ID, {
      payloadVariant: {
        case: 'keyVerificationFinal',
        value: {
          nonce: 3n,
          remoteLongname: 'Remote Op',
          isSender: true,
          verificationCharacters: 'X',
        },
      },
    });
    sender.mockRejectedValue(new Error('offline'));
    await confirmKeyVerification(true);
    expect(useKeyVerificationStore.getState().session?.phase).toBe('error');
    expect(useNodeStore.getState().nodes[ID][REMOTE].keyManuallyVerified).toBe(false);
  });

  it('cancel clears the session and tells the radio DO_NOT_VERIFY', async () => {
    await initiateKeyVerification(ID, REMOTE, 'Remote Op');
    sender.mockClear();
    cancelKeyVerification();
    expect(useKeyVerificationStore.getState().session).toBeNull();
    expect(sender).toHaveBeenCalledWith({ type: 'doNotVerify', remoteNodeNum: REMOTE, nonce: 0n });
  });

  it('ignores unrelated clientNotification variants', () => {
    expect(
      applyKeyVerificationClientNotification(ID, {
        payloadVariant: { case: 'duplicatedPublicKey', value: {} },
      }),
    ).toBe(false);
    expect(applyKeyVerificationClientNotification(ID, undefined)).toBe(false);
    expect(useKeyVerificationStore.getState().session).toBeNull();
  });

  it('bounds the nonce → node map', () => {
    for (let i = 1; i <= 40; i++) recordKeyVerificationPacket(ID, { from: i, nonce: BigInt(i) });
    expect(useKeyVerificationStore.getState().nonceToNode.size).toBeLessThanOrEqual(16);
  });

  it('does not reuse a done session remoteNodeNum for a new Inform for another node', () => {
    const nodeA = 0xaa01;
    const nodeB = 0xbb02;
    seedNode(nodeA, 'Node A');
    seedNode(nodeB, 'Node B');
    useKeyVerificationStore.setState({
      session: {
        identityId: ID,
        phase: 'done',
        nonce: 11n,
        remoteNodeNum: nodeA,
        remoteLongname: 'Node A',
        isSender: true,
      },
      nonceToNode: new Map([[22n, nodeB]]),
    });

    applyKeyVerificationClientNotification(ID, {
      payloadVariant: {
        case: 'keyVerificationNumberInform',
        value: { nonce: 22n, remoteLongname: 'Node B', securityNumber: 777 },
      },
    });

    expect(useKeyVerificationStore.getState().session).toMatchObject({
      phase: 'showNumber',
      nonce: 22n,
      remoteNodeNum: nodeB,
      remoteLongname: 'Node B',
      securityNumber: 777,
    });
  });
});
