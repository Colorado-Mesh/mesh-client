import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MECP_ALERT_THROTTLE_MAX,
  resetMecpAlertThrottleForTests,
} from '@/renderer/lib/mecp/mecpAlertThrottle';
import { selectUnseenCriticalIncidents, useIncidentStore } from '@/renderer/stores/incidentStore';
import { useMecpBlockStore } from '@/renderer/stores/mecpBlockStore';
import {
  type MessageRecord,
  resetBulkLoadedMessageIdsForTests,
} from '@/renderer/stores/messageStore';

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
  function renderMeshtasticWatcher() {
    const own = new Set<number>([1]);
    return renderHook(
      ({ messages }) => {
        useMecpAlertWatcher(
          { protocol: 'meshtastic', messages, ownNodeIds: own, ownSenderId: 1 },
          { protocol: 'meshcore', messages: [], ownNodeIds: own },
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
