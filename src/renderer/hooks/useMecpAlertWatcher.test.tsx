import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { selectOpenIncidentsSorted, useIncidentStore } from '@/renderer/stores/incidentStore';
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
  useIncidentStore.getState().clearAll();
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

  it('seeds open incidents from hydrated MECP across all protocols without alert/audit', () => {
    const own = new Set<number>([1]);
    renderHook(() => {
      useMecpAlertWatcher(
        {
          protocol: 'meshtastic',
          messages: [
            msg({ id: 'h1', payload: 'MECP/0/M01 trapped', from: 9, senderName: 'Ada' }),
            msg({ id: 'h2', payload: 'hello, not MECP', from: 9 }),
          ],
          ownNodeIds: own,
          ownSenderId: 1,
        },
        {
          protocol: 'meshcore',
          messages: [msg({ id: 'h3', payload: 'MECP/1/T04', from: 7 })],
          ownNodeIds: own,
        },
        { protocol: 'reticulum', messages: [], ownNodeIds: own },
      );
    });

    const open = selectOpenIncidentsSorted(useIncidentStore.getState());
    expect(open.map((i) => [i.protocol, i.severity, i.senderId])).toEqual([
      ['meshtastic', 0, '9'],
      ['meshcore', 1, '7'],
    ]);
    expect(open[0]?.senderName).toBe('Ada');
    expect(open[0]?.messageIds).toEqual(['h1']);
    expect(triggerMecpAlert).not.toHaveBeenCalled();
    expect(appendReceived).not.toHaveBeenCalled();
  });

  it('does not open an incident for a hydrated B02 beacon ACK', () => {
    const own = new Set<number>([1]);
    renderHook(() => {
      useMecpAlertWatcher(
        {
          protocol: 'meshtastic',
          messages: [msg({ id: 'b2', payload: 'MECP/0/B02', from: 9 })],
          ownNodeIds: own,
          ownSenderId: 1,
        },
        { protocol: 'meshcore', messages: [], ownNodeIds: own },
        { protocol: 'reticulum', messages: [], ownNodeIds: own },
      );
    });
    expect(Object.keys(useIncidentStore.getState().incidents)).toHaveLength(0);
  });

  it('upserts a new inbound MECP into the incident store and merges cross-protocol copies', async () => {
    const own = new Set<number>([1]);
    const { rerender } = renderHook(
      ({ mt, mc }: { mt: MessageRecord[]; mc: MessageRecord[] }) => {
        useMecpAlertWatcher(
          { protocol: 'meshtastic', messages: mt, ownNodeIds: own, ownSenderId: 1 },
          { protocol: 'meshcore', messages: mc, ownNodeIds: own },
          { protocol: 'reticulum', messages: [], ownNodeIds: own },
        );
      },
      { initialProps: { mt: [] as MessageRecord[], mc: [] as MessageRecord[] } },
    );
    expect(Object.keys(useIncidentStore.getState().incidents)).toHaveLength(0);

    const report = { payload: 'MECP/0/M01 trapped', from: 9, senderName: 'Ada', channelIndex: 3 };
    rerender({ mt: [msg({ id: 'n1', ...report })], mc: [] });
    await vi.waitFor(() => {
      expect(triggerMecpAlert).toHaveBeenCalledTimes(1);
    });
    let open = selectOpenIncidentsSorted(useIncidentStore.getState());
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ protocol: 'meshtastic', channel: '3', severity: 0 });

    rerender({ mt: [msg({ id: 'n1', ...report })], mc: [msg({ id: 'n2', ...report })] });
    await vi.waitFor(() => {
      open = selectOpenIncidentsSorted(useIncidentStore.getState());
      expect(open[0]?.protocolsSeen).toEqual(['meshtastic', 'meshcore']);
    });
    expect(open).toHaveLength(1);
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
