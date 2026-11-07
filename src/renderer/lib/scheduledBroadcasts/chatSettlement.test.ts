import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addMessage,
  renameMessageId,
  updateMessageStatus,
  useMessageStore,
} from '../../stores/messageStore';
import { waitForChatSettlement } from './chatSettlement';

const ID = 'identity-1';

function seed(id: string, status: 'sending' | 'acked' | 'failed' = 'sending'): void {
  addMessage(ID, {
    id,
    from: 1,
    to: 0xffffffff,
    payload: 'hi',
    channelIndex: 0,
    timestamp: 1,
    status,
  });
}

describe('waitForChatSettlement', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useMessageStore.setState({ messages: {} });
  });
  afterEach(() => {
    vi.useRealTimers();
    useMessageStore.setState({ messages: {} });
  });

  it('resolves true when the row is already acked', async () => {
    seed('m1', 'acked');
    await expect(waitForChatSettlement(ID, 'm1', 1000)).resolves.toBe(true);
  });

  it('resolves false when the row is already failed', async () => {
    seed('m1', 'failed');
    await expect(waitForChatSettlement(ID, 'm1', 1000)).resolves.toBe(false);
  });

  it('resolves true when the row later becomes acked', async () => {
    seed('m1');
    const p = waitForChatSettlement(ID, 'm1', 1000);
    updateMessageStatus(ID, 'm1', 'acked');
    await expect(p).resolves.toBe(true);
  });

  it('resolves false when the row later fails', async () => {
    seed('m1');
    const p = waitForChatSettlement(ID, 'm1', 1000);
    updateMessageStatus(ID, 'm1', 'failed', 'boom');
    await expect(p).resolves.toBe(false);
  });

  it('follows provisional id re-keys before the ack', async () => {
    seed('provisional');
    const p = waitForChatSettlement(ID, 'provisional', 1000);
    renameMessageId(ID, 'provisional', '42');
    updateMessageStatus(ID, '42', 'acked');
    await expect(p).resolves.toBe(true);
  });

  it('resolves false on timeout while still sending', async () => {
    seed('m1');
    const p = waitForChatSettlement(ID, 'm1', 500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(p).resolves.toBe(false);
  });

  it('stops listening after settling', async () => {
    seed('m1');
    const p = waitForChatSettlement(ID, 'm1', 500);
    updateMessageStatus(ID, 'm1', 'acked');
    await p;
    expect(vi.getTimerCount()).toBe(0);
  });
});
