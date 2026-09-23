import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessageRecord } from '@/renderer/stores/messageStore';

import { useMecpAlertWatcher } from './useMecpAlertWatcher';

const appendReceived = vi.fn().mockResolvedValue({ ok: true });
const triggerMecpAlert = vi.fn();
const executeMecpRebroadcast = vi.fn().mockResolvedValue([]);

vi.mock('@/renderer/lib/mecp/mecpAlert', () => ({
  triggerMecpAlert: (...args: unknown[]) => triggerMecpAlert(...args),
}));

vi.mock('@/renderer/lib/mecp/mecpRebroadcast', async () => {
  const actual = await vi.importActual('@/renderer/lib/mecp/mecpRebroadcast');
  return {
    ...(actual as object),
    executeMecpRebroadcast: (...args: unknown[]) => executeMecpRebroadcast(...args),
  };
});

vi.mock('@/renderer/lib/mecp/sendMecpRebroadcast', () => ({
  sendMecpRebroadcastOnProtocol: vi.fn(),
  resolveMecpSourceChannelName: () => 'LongFast',
}));

beforeEach(() => {
  appendReceived.mockClear();
  triggerMecpAlert.mockClear();
  executeMecpRebroadcast.mockClear();
  window.electronAPI = {
    ...window.electronAPI,
    mecp: {
      appendReceived,
      exportReceivedLog: vi.fn().mockResolvedValue({ success: false }),
    },
  };
});

function msg(
  partial: Partial<MessageRecord> & Pick<MessageRecord, 'id' | 'payload'>,
): MessageRecord {
  return {
    from: 2,
    to: 0xffffffff,
    channelIndex: 0,
    timestamp: Date.now(),
    ...partial,
  };
}

describe('useMecpAlertWatcher', () => {
  it('seeds hydration without alerting, then alerts once for a new MECP', async () => {
    const initial = [msg({ id: '1', payload: 'MECP/0/M01', from: 9 })];
    const emptyOwn = new Set<number>([1]);

    const { rerender } = renderHook(
      ({ messages }) => {
        useMecpAlertWatcher(
          {
            protocol: 'meshtastic',
            messages,
            ownNodeIds: emptyOwn,
            ownSenderId: 1,
          },
          { protocol: 'meshcore', messages: [], ownNodeIds: emptyOwn },
          { protocol: 'reticulum', messages: [], ownNodeIds: emptyOwn },
        );
      },
      { initialProps: { messages: initial } },
    );

    expect(triggerMecpAlert).not.toHaveBeenCalled();
    expect(appendReceived).not.toHaveBeenCalled();

    rerender({
      messages: [...initial, msg({ id: '2', payload: 'MECP/1/T04', from: 9, senderName: 'Bob' })],
    });

    await vi.waitFor(() => {
      expect(appendReceived).toHaveBeenCalled();
      expect(triggerMecpAlert).toHaveBeenCalled();
    });
    expect(triggerMecpAlert.mock.calls[0]?.[0]).toMatchObject({
      severity: 1,
      isDrill: false,
    });
  });

  it('does not alert for drill but still audits', async () => {
    const emptyOwn = new Set<number>([1]);
    const { rerender } = renderHook(
      ({ messages }) => {
        useMecpAlertWatcher(
          {
            protocol: 'meshtastic',
            messages,
            ownNodeIds: emptyOwn,
            ownSenderId: 1,
          },
          { protocol: 'meshcore', messages: [], ownNodeIds: emptyOwn },
          { protocol: 'reticulum', messages: [], ownNodeIds: emptyOwn },
        );
      },
      { initialProps: { messages: [] as MessageRecord[] } },
    );

    rerender({
      messages: [msg({ id: 'd1', payload: 'MECP/2/D01 M01', from: 9 })],
    });

    await vi.waitFor(() => {
      expect(appendReceived).toHaveBeenCalled();
      // drill: triggerMecpAlert is called but returns early inside — still invoked
      expect(triggerMecpAlert).toHaveBeenCalledWith(expect.objectContaining({ isDrill: true }));
    });
  });

  it('claims in-flight messages so concurrent updates alert and audit once', async () => {
    let resolveAppend: ((value: { ok: true }) => void) | undefined;
    appendReceived.mockImplementationOnce(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveAppend = resolve;
        }),
    );

    const emptyOwn = new Set<number>([1]);
    const mecpMsg = msg({ id: 'slow', payload: 'MECP/0/M01', from: 9, senderName: 'Ada' });
    const { rerender } = renderHook(
      ({ messages }) => {
        useMecpAlertWatcher(
          {
            protocol: 'meshtastic',
            messages,
            ownNodeIds: emptyOwn,
            ownSenderId: 1,
          },
          { protocol: 'meshcore', messages: [], ownNodeIds: emptyOwn },
          { protocol: 'reticulum', messages: [], ownNodeIds: emptyOwn },
        );
      },
      { initialProps: { messages: [] as MessageRecord[] } },
    );

    rerender({ messages: [mecpMsg] });
    await vi.waitFor(() => {
      expect(triggerMecpAlert).toHaveBeenCalledTimes(1);
      expect(appendReceived).toHaveBeenCalledTimes(1);
    });

    // Same message still pending audit — a second effect pass must not re-alert/re-append.
    rerender({ messages: [mecpMsg] });
    await Promise.resolve();
    expect(triggerMecpAlert).toHaveBeenCalledTimes(1);
    expect(appendReceived).toHaveBeenCalledTimes(1);

    resolveAppend?.({ ok: true });
    await vi.waitFor(() => {
      expect(appendReceived).toHaveBeenCalledTimes(1);
    });
  });
});
