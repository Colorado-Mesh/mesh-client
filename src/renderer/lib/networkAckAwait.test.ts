import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addMessage,
  type MessageRecord,
  renameMessageId,
  useMessageStore,
} from '@/renderer/stores/messageStore';

import { tryParseMecp } from './mecp/mecpMessages';
import {
  awaitNetworkAck,
  isNetworkAckCancelledError,
  isPeerMecpNetworkAck,
  MESHCORE_NETWORK_ACK_TIMEOUT_MS,
  MESHTASTIC_NETWORK_ACK_TIMEOUT_MS,
  NETWORK_ACK_CANCELLED_KEY,
  NETWORK_ACK_FAILED_KEY,
  NETWORK_ACK_TIMEOUT_KEY,
  networkAckTimeoutMs,
  readTransportVerdict,
} from './networkAckAwait';
import { useRelayCoverageStore } from './relayCoverage/relayCoverageStore';
import { RETICULUM_RECEIPT_TIMEOUT_MS } from './reticulumOutboundReceipt';

const IDENTITY = 'ack-test-identity';
const OWN_NODE = 1;
const PEER_NODE = 77;

function record(overrides: Partial<MessageRecord> & Pick<MessageRecord, 'id'>): MessageRecord {
  return {
    from: OWN_NODE,
    to: 42,
    payload: 'hello',
    channelIndex: -1,
    timestamp: Date.now(),
    status: 'sending',
    ...overrides,
  };
}

function patch(id: string, fields: Partial<MessageRecord>): void {
  useMessageStore.setState((s) => {
    const bucket = s.messages[IDENTITY] ?? {};
    return {
      messages: { ...s.messages, [IDENTITY]: { ...bucket, [id]: { ...bucket[id], ...fields } } },
    };
  });
}

function mecp(payload: string) {
  const parsed = tryParseMecp(payload);
  if (parsed == null) throw new Error(`not MECP: ${payload}`);
  return parsed;
}

describe('isPeerMecpNetworkAck', () => {
  it.each([
    ['R01 echoing our code', 'MECP/0/M01', 'MECP/0/R01 M01 on way', true],
    ['R01 echoing another code', 'MECP/0/M01', 'MECP/0/R01 T04', false],
    ['bare R01 with our severity', 'MECP/0/M01', 'MECP/0/R01', true],
    ['bare R01 with other severity', 'MECP/0/M01', 'MECP/2/R01', false],
    ['B02 for our beacon', 'MECP/0/B01', 'MECP/0/B02 heard you', true],
    ['B02 for a non-beacon', 'MECP/0/M01', 'MECP/0/B02', false],
    ['relayed copy', 'MECP/0/M01 ridge', 'MECP/0/M01 ridge', true],
    ['different report', 'MECP/0/M01 ridge', 'MECP/1/T04 valley', false],
  ])('%s → %s', (_label, ours, incoming, expected) => {
    expect(isPeerMecpNetworkAck(mecp(ours), mecp(incoming))).toBe(expected);
  });
});

describe('readTransportVerdict', () => {
  beforeEach(() => {
    useRelayCoverageStore.setState({ coverage: {} });
  });

  it('meshtastic: device or MQTT ack counts; fails only when both transports are done', () => {
    expect(readTransportVerdict('meshtastic', IDENTITY, record({ id: 'a', status: 'acked' }))).toBe(
      'acked',
    );
    expect(
      readTransportVerdict(
        'meshtastic',
        IDENTITY,
        record({ id: 'a', status: 'failed', mqttStatus: 'acked' }),
      ),
    ).toBe('acked');
    expect(
      readTransportVerdict(
        'meshtastic',
        IDENTITY,
        record({ id: 'a', status: 'failed', mqttStatus: 'sending' }),
      ),
    ).toBeUndefined();
    expect(
      readTransportVerdict('meshtastic', IDENTITY, record({ id: 'a', status: 'failed' })),
    ).toBe('failed');
  });

  it('meshcore channel: companion accept is not enough; a heard repeater is', () => {
    const channelMsg = record({ id: 'ch-1', to: 0, channelIndex: 0, status: 'acked' });
    expect(readTransportVerdict('meshcore', IDENTITY, channelMsg)).toBeUndefined();
    useRelayCoverageStore.getState().set(IDENTITY, 'ch-1', {
      protocol: 'meshcore',
      mode: 'binary-heard',
      heardRepeaters: [{ nodeId: 5 }],
    });
    expect(readTransportVerdict('meshcore', IDENTITY, channelMsg)).toBe('acked');
  });

  it('meshcore DM: acked status counts', () => {
    expect(readTransportVerdict('meshcore', IDENTITY, record({ id: 'dm', status: 'acked' }))).toBe(
      'acked',
    );
    expect(readTransportVerdict('meshcore', IDENTITY, record({ id: 'dm', status: 'failed' }))).toBe(
      'failed',
    );
  });
});

describe('networkAckTimeoutMs', () => {
  it('maps each protocol to its timeout', () => {
    expect(networkAckTimeoutMs('meshtastic')).toBe(MESHTASTIC_NETWORK_ACK_TIMEOUT_MS);
    expect(networkAckTimeoutMs('meshcore')).toBe(MESHCORE_NETWORK_ACK_TIMEOUT_MS);
    expect(networkAckTimeoutMs('reticulum')).toBe(RETICULUM_RECEIPT_TIMEOUT_MS);
  });
});

describe('awaitNetworkAck', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
    useRelayCoverageStore.setState({ coverage: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects immediately when the send returned no id', async () => {
    await expect(
      awaitNetworkAck({ protocol: 'meshcore', sendResult: undefined, payload: 'MECP/0/M01' }),
    ).rejects.toThrow(NETWORK_ACK_FAILED_KEY);
  });

  it.each(['meshtastic', 'meshcore'] as const)(
    '%s: resolves when the tracked record is acked',
    async (protocol) => {
      addMessage(IDENTITY, record({ id: '501' }));
      const wait = awaitNetworkAck({ protocol, sendResult: '501', payload: 'MECP/0/M01' });
      patch('501', { status: 'acked' });
      await expect(wait).resolves.toBeUndefined();
    },
  );

  it.each(['meshtastic', 'meshcore'] as const)(
    '%s: rejects with the record error when the send fails',
    async (protocol) => {
      addMessage(IDENTITY, record({ id: '502' }));
      const wait = awaitNetworkAck({ protocol, sendResult: '502', payload: 'MECP/0/M01' });
      patch('502', { status: 'failed', error: 'chatPanel.sendErrors.timeout' });
      await expect(wait).rejects.toThrow('chatPanel.sendErrors.timeout');
    },
  );

  it('reticulum: resolves on the LXMF receipt', async () => {
    addMessage(IDENTITY, record({ id: 'lx-1' }));
    const wait = awaitNetworkAck({
      protocol: 'reticulum',
      sendResult: 'lx-1',
      payload: 'MECP/0/M01',
      identityId: IDENTITY,
    });
    patch('lx-1', { status: 'acked' });
    await expect(wait).resolves.toBeUndefined();
  });

  it('meshtastic: follows a tempId → wire packet id rename', async () => {
    addMessage(IDENTITY, record({ id: '700' }));
    const wait = awaitNetworkAck({ protocol: 'meshtastic', sendResult: '700', payload: 'hi' });
    renameMessageId(IDENTITY, '700', '9001');
    patch('9001', { status: 'acked' });
    await expect(wait).resolves.toBeUndefined();
  });

  it('resolves when a peer ACKs our MECP report', async () => {
    addMessage(IDENTITY, record({ id: '801', payload: 'MECP/0/M01' }));
    const wait = awaitNetworkAck({
      protocol: 'meshcore',
      sendResult: '801',
      payload: 'MECP/0/M01',
    });
    addMessage(
      IDENTITY,
      record({ id: 'peer-1', from: PEER_NODE, payload: 'MECP/0/R01 M01', status: undefined }),
    );
    await expect(wait).resolves.toBeUndefined();
  });

  it('resolves when a peer relays the same MECP report', async () => {
    addMessage(IDENTITY, record({ id: '802', payload: 'MECP/0/M01 ridge' }));
    const wait = awaitNetworkAck({
      protocol: 'meshcore',
      sendResult: '802',
      payload: 'MECP/0/M01 ridge',
    });
    addMessage(
      IDENTITY,
      record({ id: 'peer-2', from: PEER_NODE, payload: 'MECP/0/M01 ridge', status: undefined }),
    );
    await expect(wait).resolves.toBeUndefined();
  });

  it('ignores our own outbound copies and non-MECP payloads', async () => {
    vi.useFakeTimers();
    addMessage(IDENTITY, record({ id: '803', payload: 'MECP/0/M01' }));
    const wait = awaitNetworkAck({
      protocol: 'meshcore',
      sendResult: '803',
      payload: 'MECP/0/M01',
      timeoutMs: 1_000,
    });
    const settled = vi.fn();
    wait.then(settled, settled);
    addMessage(IDENTITY, record({ id: 'own-2', payload: 'MECP/0/R01 M01', status: 'acked' }));
    addMessage(IDENTITY, record({ id: 'chat', from: PEER_NODE, payload: 'R01 M01' }));
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    await expect(wait).rejects.toThrow(NETWORK_ACK_TIMEOUT_KEY);
  });

  it('rejects with the cancel key when aborted', async () => {
    addMessage(IDENTITY, record({ id: '901' }));
    const controller = new AbortController();
    const wait = awaitNetworkAck({
      protocol: 'meshcore',
      sendResult: '901',
      payload: 'MECP/0/M01',
      signal: controller.signal,
    });
    controller.abort();
    const err = await wait.catch((e: unknown) => e);
    expect(isNetworkAckCancelledError(err)).toBe(true);
    expect((err as Error).message).toBe(NETWORK_ACK_CANCELLED_KEY);
  });

  it('rejects with the cancel key when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      awaitNetworkAck({
        protocol: 'meshtastic',
        sendResult: '1',
        payload: 'x',
        signal: controller.signal,
      }),
    ).rejects.toThrow(NETWORK_ACK_CANCELLED_KEY);
  });
});
