import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mapMeshcoreDbRowsToChatMessages } from '@/renderer/hooks/meshcore/meshcoreHookPreamble';
import {
  MECP_ALERT_THROTTLE_MAX,
  resetMecpAlertThrottleForTests,
} from '@/renderer/lib/mecp/mecpAlertThrottle';
import { savedMessageToChatMessage } from '@/renderer/lib/meshtasticDbCacheHydration';
import { reticulumHashToNodeId } from '@/renderer/lib/reticulum/destHash';
import {
  chatMessageToMessageRecord,
  reticulumDbRowToMessageRecord,
} from '@/renderer/lib/storeRecordAdapters';
import {
  selectOpenIncidentsSorted,
  selectUnseenCriticalIncidents,
  useIncidentStore,
} from '@/renderer/stores/incidentStore';
import { useMecpBlockStore } from '@/renderer/stores/mecpBlockStore';
import {
  type MessageRecord,
  resetBulkLoadedMessageIdsForTests,
  upsertMessageRecordsForIdentity,
  useMessageStore,
} from '@/renderer/stores/messageStore';
import type { SavedMessage } from '@/shared/electron-api.types';

import { useMecpAlertWatcher } from './useMecpAlertWatcher';

const appendReceived = vi.fn().mockResolvedValue({ ok: true });
const triggerMecpAlert = vi.fn();
const executeMecpRebroadcast = vi.fn().mockResolvedValue([]);

const notifyMecpAlertsSuppressed = vi.fn();

vi.mock('@/renderer/lib/mecp/mecpAlert', () => ({
  triggerMecpAlert: (...args: unknown[]) => triggerMecpAlert(...args),
  notifyMecpAlertsSuppressed: (...args: unknown[]) => notifyMecpAlertsSuppressed(...args),
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
  notifyMecpAlertsSuppressed.mockClear();
  resetMecpAlertThrottleForTests();
  useMecpBlockStore.setState({ blocked: {} });
  resetBulkLoadedMessageIdsForTests();
  useIncidentStore.setState({ incidents: {}, resolvedTombstones: {} });
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

  it('does not seed own messages into the incident store', () => {
    const own = new Set<number>([9]);
    renderHook(() => {
      useMecpAlertWatcher(
        {
          protocol: 'meshtastic',
          messages: [msg({ id: 'own', payload: 'MECP/0/M01', from: 9 })],
          ownNodeIds: own,
          ownSenderId: 9,
        },
        { protocol: 'meshcore', messages: [], ownNodeIds: own },
        { protocol: 'reticulum', messages: [], ownNodeIds: own },
      );
    });
    expect(Object.keys(useIncidentStore.getState().incidents)).toHaveLength(0);
  });

  it('treats DB hydration that lands after mount as history (seed guards, no alert)', async () => {
    const own = new Set<number>([9]);
    const nineDaysMs = 9 * 24 * 60 * 60 * 1000;
    const stale = msg({ id: 'db-old', payload: 'MECP/0/M01 old', from: 4 });
    stale.timestamp = Date.now() - nineDaysMs;
    const recent = msg({ id: 'db-new', payload: 'MECP/3/D01', from: 4 });
    const ownRecent = msg({ id: 'db-own', payload: 'MECP/3/D02', from: 9, status: 'acked' });
    const hydrated = [stale, recent, ownRecent];
    const { rerender } = renderHook(
      ({ messages }: { messages: MessageRecord[] }) => {
        useMecpAlertWatcher(
          { protocol: 'meshtastic', messages: [], ownNodeIds: own, ownSenderId: 9 },
          { protocol: 'meshcore', messages: [], ownNodeIds: own, ownSenderId: 9 },
          { protocol: 'reticulum', messages, ownNodeIds: own, ownSenderId: 9 },
        );
      },
      { initialProps: { messages: [] as MessageRecord[] } },
    );
    upsertMessageRecordsForIdentity('test-identity', hydrated);
    rerender({ messages: hydrated });
    await vi.waitFor(() => {
      expect(selectOpenIncidentsSorted(useIncidentStore.getState())).toHaveLength(1);
    });
    expect(selectOpenIncidentsSorted(useIncidentStore.getState())[0]).toMatchObject({
      senderId: '4',
      isDrill: true,
    });
    expect(triggerMecpAlert).not.toHaveBeenCalled();
    expect(appendReceived).not.toHaveBeenCalled();

    rerender({
      messages: [...hydrated, msg({ id: 'live', payload: 'MECP/0/M01 live', from: 4 })],
    });
    await vi.waitFor(() => {
      expect(triggerMecpAlert).toHaveBeenCalledTimes(1);
    });
  });

  it('restores foreign incidents from adapter-stamped acked rows and still seeds own B01/B03', async () => {
    const ownId = 9;
    const own = new Set<number>([ownId]);
    const now = Date.now();
    const foreignRnHash = '000000000004' + 'ab'.repeat(10);
    const foreignRnId = reticulumHashToNodeId(foreignRnHash);

    const meshtasticSaved = (
      row: Pick<SavedMessage, 'id' | 'sender_id' | 'sender_name' | 'payload' | 'to'>,
    ): MessageRecord =>
      chatMessageToMessageRecord(
        savedMessageToChatMessage({
          packetId: row.id,
          channel: 0,
          timestamp: now,
          status: 'acked',
          error: null,
          emoji: null,
          replyId: null,
          mqttStatus: null,
          receivedVia: 'rf',
          ...row,
        }),
      );

    const mtForeign = meshtasticSaved({
      id: 4101,
      sender_id: 4,
      sender_name: 'Ada',
      payload: 'MECP/0/M01 trapped',
      to: 0xffffffff,
    });
    const ownB01 = meshtasticSaved({
      id: 4102,
      sender_id: ownId,
      sender_name: 'Me',
      payload: 'MECP/0/B01',
      to: 15,
    });
    const ownB03 = meshtasticSaved({
      id: 4103,
      sender_id: ownId,
      sender_name: 'Me',
      payload: 'MECP/0/B03',
      to: 15,
    });
    const mcMapped = mapMeshcoreDbRowsToChatMessages([
      {
        id: 4201,
        sender_id: 7,
        sender_name: 'Bob',
        payload: 'MECP/1/T04 blocked',
        channel_idx: 0,
        timestamp: now,
        status: 'acked',
        packet_id: 4201,
        emoji: null,
        reply_id: null,
        to_node: null,
      },
    ]).map(chatMessageToMessageRecord);
    const mcForeign = mcMapped[0];
    if (mcForeign == null) throw new Error('meshcore adapter dropped the foreign incident');
    const rnForeign = reticulumDbRowToMessageRecord({
      sender_id: foreignRnHash,
      sender_name: 'Cara',
      payload: 'MECP/2/M01 downed line',
      timestamp: now,
      message_hash: 'cd'.repeat(16),
    });

    expect([mtForeign, ownB01, ownB03, mcForeign, rnForeign].map((m) => m.status)).toEqual([
      'acked',
      'acked',
      'acked',
      'acked',
      'acked',
    ]);
    expect(rnForeign.from).toBe(foreignRnId);
    expect(own.has(foreignRnId)).toBe(false);

    const mt = [mtForeign, ownB01, ownB03];
    const mc = [mcForeign];
    const rn = [rnForeign];
    useMessageStore.setState({ messages: {} });
    upsertMessageRecordsForIdentity('mecp-adapter-seed', [...mt, ...mc, ...rn]);

    const { rerender } = renderHook(
      ({
        messages,
      }: {
        messages: { mt: MessageRecord[]; mc: MessageRecord[]; rn: MessageRecord[] };
      }) => {
        useMecpAlertWatcher(
          { protocol: 'meshtastic', messages: messages.mt, ownNodeIds: own, ownSenderId: ownId },
          { protocol: 'meshcore', messages: messages.mc, ownNodeIds: own, ownSenderId: ownId },
          { protocol: 'reticulum', messages: messages.rn, ownNodeIds: own, ownSenderId: ownId },
        );
      },
      {
        initialProps: {
          messages: {
            mt: [] as MessageRecord[],
            mc: [] as MessageRecord[],
            rn: [] as MessageRecord[],
          },
        },
      },
    );
    rerender({ messages: { mt, mc, rn } });

    await vi.waitFor(() => {
      expect(selectOpenIncidentsSorted(useIncidentStore.getState())).toHaveLength(4);
    });
    const open = selectOpenIncidentsSorted(useIncidentStore.getState());
    const foreignMt = open.find((i) => i.messageIds.includes(mtForeign.id));
    expect(foreignMt).toMatchObject({
      protocol: 'meshtastic',
      senderId: '4',
      senderName: 'Ada',
      severity: 0,
    });
    expect(foreignMt?.localOrigin).toBeUndefined();
    expect(open.find((i) => i.messageIds.includes(mcForeign.id))).toMatchObject({
      protocol: 'meshcore',
      senderId: '7',
      severity: 1,
    });
    expect(open.find((i) => i.messageIds.includes(rnForeign.id))).toMatchObject({
      protocol: 'reticulum',
      senderId: String(foreignRnId),
      senderName: 'Cara',
      severity: 2,
    });
    expect(open.find((i) => i.senderId === String(ownId))).toMatchObject({
      protocol: 'meshtastic',
      localOrigin: true,
      beaconActive: false,
      beaconCancelToNode: 15,
      messageIds: [ownB01.id],
    });
    expect(triggerMecpAlert).not.toHaveBeenCalled();
    expect(appendReceived).not.toHaveBeenCalled();
  });

  it('seeds an own distress beacon without alerting so the originator can cancel it', () => {
    const own = new Set<number>([9]);
    renderHook(() => {
      useMecpAlertWatcher(
        {
          protocol: 'meshtastic',
          messages: [msg({ id: 'own-b01', payload: 'MECP/0/B01 M01', from: 9, to: 15 })],
          ownNodeIds: own,
          ownSenderId: 9,
        },
        { protocol: 'meshcore', messages: [], ownNodeIds: own },
        { protocol: 'reticulum', messages: [], ownNodeIds: own },
      );
    });
    const open = selectOpenIncidentsSorted(useIncidentStore.getState());
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      senderId: '9',
      beaconActive: true,
      localOrigin: true,
      beaconCancelToNode: 15,
    });
    expect(triggerMecpAlert).not.toHaveBeenCalled();
    expect(appendReceived).not.toHaveBeenCalled();
  });

  it('applies an own B03 to the originated beacon without alerting', async () => {
    const own = new Set<number>([9]);
    const beacon = msg({ id: 'own-b01', payload: 'MECP/0/B01', from: 9 });
    const { rerender } = renderHook(
      ({ messages }: { messages: MessageRecord[] }) => {
        useMecpAlertWatcher(
          { protocol: 'meshtastic', messages, ownNodeIds: own, ownSenderId: 9 },
          { protocol: 'meshcore', messages: [], ownNodeIds: own },
          { protocol: 'reticulum', messages: [], ownNodeIds: own },
        );
      },
      { initialProps: { messages: [] as MessageRecord[] } },
    );
    rerender({ messages: [beacon] });
    await vi.waitFor(() => {
      expect(selectOpenIncidentsSorted(useIncidentStore.getState())).toHaveLength(1);
    });
    expect(triggerMecpAlert).not.toHaveBeenCalled();

    rerender({
      messages: [beacon, msg({ id: 'own-b03', payload: 'MECP/0/B03', from: 9 })],
    });
    await vi.waitFor(() => {
      const inc = selectOpenIncidentsSorted(useIncidentStore.getState())[0];
      expect(inc?.beaconActive).toBe(false);
      expect(inc?.status).toBe('open');
    });
    expect(triggerMecpAlert).not.toHaveBeenCalled();
  });

  it('ignores a stale hydrated B03 so it cannot cancel a current beacon', async () => {
    const own = new Set<number>([9]);
    const { rerender } = renderHook(
      ({ messages }: { messages: MessageRecord[] }) => {
        useMecpAlertWatcher(
          { protocol: 'meshtastic', messages, ownNodeIds: own, ownSenderId: 9 },
          { protocol: 'meshcore', messages: [], ownNodeIds: own },
          { protocol: 'reticulum', messages: [], ownNodeIds: own },
        );
      },
      { initialProps: { messages: [] as MessageRecord[] } },
    );
    const beacon = msg({ id: 'peer-b01', payload: 'MECP/0/B01', from: 4 });
    rerender({ messages: [beacon] });
    await vi.waitFor(() => {
      expect(selectOpenIncidentsSorted(useIncidentStore.getState())[0]?.beaconActive).toBe(true);
    });

    const staleCancel = msg({ id: 'peer-b03-old', payload: 'MECP/0/B03', from: 4 });
    staleCancel.timestamp = Date.now() - 2 * 24 * 60 * 60 * 1000;
    upsertMessageRecordsForIdentity('test-identity', [staleCancel]);
    rerender({ messages: [beacon, staleCancel] });
    await new Promise((r) => setTimeout(r, 0));
    expect(selectOpenIncidentsSorted(useIncidentStore.getState())[0]?.beaconActive).toBe(true);
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

  function renderMeshtasticWatcher() {
    const own = new Set<number>([1]);
    return renderHook(
      ({ messages }) => {
        useMecpAlertWatcher(
          { protocol: 'meshtastic', messages, ownNodeIds: own, ownSenderId: 1 },
          { protocol: 'meshcore', messages: [], ownNodeIds: own },
          { protocol: 'reticulum', messages: [], ownNodeIds: own },
        );
      },
      { initialProps: { messages: [] as MessageRecord[] } },
    );
  }

  it('audits a blocked sender only: no alert, incident, or rebroadcast', async () => {
    useMecpBlockStore.getState().block('meshtastic', '9', 'Spammer');
    const { rerender } = renderMeshtasticWatcher();

    rerender({ messages: [msg({ id: 'b1', payload: 'MECP/0/M01 fake', from: 9 })] });

    await vi.waitFor(() => {
      expect(appendReceived).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: 'b1', blocked: true }),
      );
    });
    expect(triggerMecpAlert).not.toHaveBeenCalled();
    expect(executeMecpRebroadcast).not.toHaveBeenCalled();
    expect(Object.keys(useIncidentStore.getState().incidents)).toHaveLength(0);
  });

  it('does not seed hydrated incidents from a blocked sender', () => {
    useMecpBlockStore.getState().block('meshtastic', '9', 'Spammer');
    const own = new Set<number>([1]);
    renderHook(() => {
      useMecpAlertWatcher(
        {
          protocol: 'meshtastic',
          messages: [msg({ id: 's1', payload: 'MECP/0/M01 old', from: 9 })],
          ownNodeIds: own,
          ownSenderId: 1,
        },
        { protocol: 'meshcore', messages: [], ownNodeIds: own },
        { protocol: 'reticulum', messages: [], ownNodeIds: own },
      );
    });
    expect(Object.keys(useIncidentStore.getState().incidents)).toHaveLength(0);
  });

  it('throttles repeated alerts from one sender but still records each incident quietly', async () => {
    const { rerender } = renderMeshtasticWatcher();
    const messages: MessageRecord[] = [];
    for (let i = 0; i <= MECP_ALERT_THROTTLE_MAX; i++) {
      messages.push(msg({ id: `t${i}`, payload: `MECP/0/M01 spam ${i}`, from: 9 }));
      rerender({ messages: [...messages] });
      await vi.waitFor(() => {
        expect(appendReceived).toHaveBeenCalledTimes(i + 1);
      });
    }

    expect(triggerMecpAlert).toHaveBeenCalledTimes(MECP_ALERT_THROTTLE_MAX);
    expect(notifyMecpAlertsSuppressed).toHaveBeenCalledTimes(1);
    expect(notifyMecpAlertsSuppressed).toHaveBeenCalledWith('sender', '9', expect.any(Function));
    const incidents = Object.values(useIncidentStore.getState().incidents);
    expect(incidents).toHaveLength(MECP_ALERT_THROTTLE_MAX + 1);
    // The quiet (throttled) row is recorded already seen, so it never drives the banner.
    expect(selectUnseenCriticalIncidents(useIncidentStore.getState())).toHaveLength(
      MECP_ALERT_THROTTLE_MAX,
    );

    // The suppression toast's Block action blocks the sender.
    const onBlock = notifyMecpAlertsSuppressed.mock.calls[0]?.[2] as () => void;
    onBlock();
    expect(useMecpBlockStore.getState().blocked['meshtastic:9']).toBeDefined();
  });
});
