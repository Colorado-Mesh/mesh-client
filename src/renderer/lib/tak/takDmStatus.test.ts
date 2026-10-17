import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addMessage, type MessageRecord, useMessageStore } from '../../stores/messageStore';
import {
  type AutoResendSendFn,
  resetAutoResendForTests,
  startAutoResend,
} from '../autoResend/autoResendController';
import { AUTO_RESEND_DELAYS_MS } from '../autoResend/autoResendPolicy';
import {
  reportTakDmOutcome,
  resetTakDmStatus,
  startTakDmStatus,
  watchTakDirectMessage,
} from './takDmStatus';

const ID = 'tak-dm-status-mt';
const REF = '0c2f8e1a-5b3d-4c7e-9a10-2b4d6f8a0c1e';

function dm(id: string): MessageRecord {
  return {
    id,
    from: 1,
    to: 456,
    payload: '[VIPER] hi',
    channelIndex: 0,
    timestamp: Date.now(),
    status: 'sending',
  };
}

function setStatus(id: string, status: MessageRecord['status']): void {
  useMessageStore.setState((s) => {
    const bucket = s.messages[ID] ?? {};
    return { messages: { ...s.messages, [ID]: { ...bucket, [id]: { ...bucket[id], status } } } };
  });
}

describe('takDmStatus', () => {
  let dmStatus: ReturnType<typeof vi.spyOn>;
  let stop: () => void;
  let nextId = 100;

  beforeEach(() => {
    vi.useFakeTimers();
    useMessageStore.setState({ messages: {} });
    dmStatus = vi.spyOn(window.electronAPI.tak, 'dmStatus').mockResolvedValue(undefined);
    // The API mock is shared by every test, so earlier calls are cleared.
    dmStatus.mockClear();
    vi.spyOn(window.electronAPI.db, 'deleteFailedOutboundMessage').mockResolvedValue({
      changes: 1,
    });
    // Each resend is a new message; the controller follows it back to the first send.
    const send: AutoResendSendFn = () => {
      nextId += 1;
      addMessage(ID, dm(String(nextId)));
      return String(nextId);
    };
    const stopResend = startAutoResend(send, (id) => (id === ID ? 'meshtastic' : null));
    const stopStatus = startTakDmStatus();
    stop = () => {
      stopStatus();
      stopResend();
    };
  });

  afterEach(() => {
    stop();
    resetAutoResendForTests();
    resetTakDmStatus();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('reports a watched message delivered when a resend of it is acknowledged', () => {
    addMessage(ID, dm('1'));
    watchTakDirectMessage(ID, '1', REF);
    setStatus('1', 'failed');
    vi.advanceTimersByTime(AUTO_RESEND_DELAYS_MS[0]);
    expect(dmStatus).not.toHaveBeenCalled();
    setStatus(String(nextId), 'acked');
    expect(dmStatus).toHaveBeenCalledExactlyOnceWith({ dmRef: REF, outcome: 'delivered' });
  });

  it('reports it unconfirmed once the last resend has failed', () => {
    addMessage(ID, dm('1'));
    watchTakDirectMessage(ID, '1', REF);
    let current = '1';
    for (const delay of AUTO_RESEND_DELAYS_MS) {
      setStatus(current, 'failed');
      vi.advanceTimersByTime(delay);
      current = String(nextId);
    }
    setStatus(current, 'failed');
    expect(dmStatus).toHaveBeenCalledExactlyOnceWith({ dmRef: REF, outcome: 'unconfirmed' });
  });

  it('says nothing about messages it is not watching', () => {
    addMessage(ID, dm('1'));
    setStatus('1', 'acked');
    expect(dmStatus).not.toHaveBeenCalled();
  });

  it('logs a report main refused', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    dmStatus.mockRejectedValueOnce(new Error('rate limited'));
    reportTakDmOutcome(REF, 'not-sent');
    await vi.runAllTimersAsync();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dmStatus failed'));
  });
});
