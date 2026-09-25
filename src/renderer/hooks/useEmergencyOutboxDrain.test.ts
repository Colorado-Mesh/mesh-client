import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  requestChatOutboxDrain,
  resetChatOutboxDrainLocksForTests,
} from '@/renderer/lib/chatOutboxDrain';
import { resetMeshcoreSendRateForTests } from '@/renderer/lib/meshcoreSendRateNotice';
import { resetMeshtasticTextSendPacingForTests } from '@/renderer/lib/meshtasticTextSendPacing';
import type { MeshProtocol } from '@/renderer/lib/types';
import type { OutboxEntry } from '@/shared/electron-api.types';

import { useChatOutbox } from './useChatOutbox';
import {
  type EmergencyOutboxDrainTarget,
  isChatOutboxSendAvailable,
  useEmergencyOutboxDrain,
} from './useEmergencyOutboxDrain';

function makeEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: 1,
    protocol: 'meshcore',
    viewKey: 'ch:0',
    channel: 0,
    toNode: null,
    payload: 'hello',
    replyId: null,
    status: 'queued',
    error: null,
    attemptCount: 0,
    nextRetryAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    groupId: null,
    groupIndex: null,
    groupTotal: null,
    priority: 'normal',
    ...overrides,
  };
}

function drainsFor(
  sendFns: Partial<Record<MeshProtocol, EmergencyOutboxDrainTarget['sendFn']>>,
  available: Partial<Record<MeshProtocol, boolean>> = {},
): EmergencyOutboxDrainTarget[] {
  return (['meshtastic', 'meshcore', 'reticulum'] as const).map((protocol) => ({
    protocol,
    isSendAvailable: available[protocol] ?? false,
    sendFn: sendFns[protocol] ?? vi.fn().mockResolvedValue(undefined),
  }));
}

describe('useEmergencyOutboxDrain', () => {
  const mockOutbox = window.electronAPI.chat.outbox;
  let stored: OutboxEntry[];

  beforeEach(() => {
    resetChatOutboxDrainLocksForTests();
    resetMeshtasticTextSendPacingForTests();
    resetMeshcoreSendRateForTests();
    stored = [];
    vi.mocked(mockOutbox.list).mockReset();
    vi.mocked(mockOutbox.updateStatus).mockReset();
    vi.mocked(mockOutbox.remove).mockReset();
    vi.mocked(mockOutbox.list).mockImplementation((protocol?: string) =>
      Promise.resolve(stored.filter((r) => protocol == null || r.protocol === protocol)),
    );
    vi.mocked(mockOutbox.updateStatus).mockImplementation((id, status) => {
      stored = stored.map((r) => (r.id === id ? { ...r, status } : r));
      return Promise.resolve(undefined);
    });
    vi.mocked(mockOutbox.remove).mockImplementation((id) => {
      stored = stored.filter((r) => r.id !== id);
      return Promise.resolve(undefined);
    });
  });

  it('registers drain listeners for all three protocols', async () => {
    renderHook(() => {
      useEmergencyOutboxDrain({
        drains: drainsFor({}, { meshtastic: true, meshcore: true, reticulum: true }),
      });
    });
    await waitFor(() => {
      expect(mockOutbox.list).toHaveBeenCalledTimes(3);
    });
    vi.mocked(mockOutbox.list).mockClear();
    for (const p of ['meshtastic', 'meshcore', 'reticulum'] as const) {
      requestChatOutboxDrain(p);
    }
    await waitFor(() => {
      expect(new Set(vi.mocked(mockOutbox.list).mock.calls.map((c) => c[0]))).toEqual(
        new Set(['meshtastic', 'meshcore', 'reticulum']),
      );
    });
  });

  it('drains emergency and incident-ACK rows without ChatPanel mounted', async () => {
    stored = [
      makeEntry({ id: 1, payload: 'routine', createdAt: Date.now() - 2_000 }),
      makeEntry({ id: 2, payload: 'MECP/0/M01', priority: 'emergency' }),
      makeEntry({
        id: 3,
        payload: 'MECP/0/R01 M01',
        priority: 'normal',
        viewKey: 'ackIncident:mecp-x:ch:0',
      }),
    ];
    const sendFn = vi.fn().mockResolvedValue(undefined);
    renderHook(() => {
      useEmergencyOutboxDrain({ drains: drainsFor({ meshcore: sendFn }, { meshcore: true }) });
    });
    await waitFor(() => {
      expect(mockOutbox.remove).toHaveBeenCalledWith(2);
      expect(mockOutbox.remove).toHaveBeenCalledWith(3);
    });
    expect(sendFn).toHaveBeenCalledTimes(2);
    expect(stored.map((r) => r.id)).toEqual([1]);
  });

  it('wakes at nextRetryAt for emergency rows when ChatPanel is not mounted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const dueAt = Date.now() + 5_000;
      stored = [
        makeEntry({
          id: 9,
          payload: 'MECP/0/M01',
          priority: 'emergency',
          status: 'failed',
          nextRetryAt: dueAt,
          attemptCount: 1,
        }),
      ];
      const sendFn = vi.fn().mockResolvedValue(undefined);
      renderHook(() => {
        useEmergencyOutboxDrain({ drains: drainsFor({ meshcore: sendFn }, { meshcore: true }) });
      });
      // Initial drain sees nextRetryAt in the future and arms the timer without sending.
      await waitFor(() => {
        expect(mockOutbox.list).toHaveBeenCalled();
      });
      expect(sendFn).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5_100);
      await waitFor(() => {
        expect(sendFn).toHaveBeenCalledWith('MECP/0/M01', 0, undefined, undefined);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not drain protocols whose send is unavailable', async () => {
    stored = [makeEntry({ id: 3, payload: 'MECP/1/T04', priority: 'emergency' })];
    const sendFn = vi.fn().mockResolvedValue(undefined);
    renderHook(() => {
      useEmergencyOutboxDrain({ drains: drainsFor({ meshcore: sendFn }) });
    });
    requestChatOutboxDrain('meshcore');
    await new Promise((r) => setTimeout(r, 20));
    expect(sendFn).not.toHaveBeenCalled();
  });

  it('shares the per-protocol drain lock with useChatOutbox so a row is sent once', async () => {
    stored = [makeEntry({ id: 4, payload: 'MECP/0/M01', priority: 'emergency' })];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sendFn = vi.fn(async () => {
      await gate;
      return undefined;
    });
    renderHook(() => {
      useEmergencyOutboxDrain({ drains: drainsFor({ meshcore: sendFn }, { meshcore: true }) });
    });
    renderHook(() => useChatOutbox({ protocol: 'meshcore', isSendAvailable: true, sendFn }));
    await waitFor(() => {
      expect(sendFn).toHaveBeenCalledTimes(1);
    });
    requestChatOutboxDrain('meshcore');
    await new Promise((r) => setTimeout(r, 20));
    release();
    await waitFor(() => {
      expect(mockOutbox.remove).toHaveBeenCalledWith(4);
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(sendFn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['meshtastic', { state: { status: 'configured' }, mqttStatus: null }, true],
    ['meshcore', { state: { status: 'stale' }, mqttStatus: null }, true],
    ['meshtastic', { state: { status: 'disconnected' }, mqttStatus: 'connected' }, true],
    ['meshcore', { state: { status: 'disconnected' }, mqttStatus: 'connected' }, false],
    ['reticulum', { state: { status: 'disconnected' }, mqttStatus: null }, false],
  ] as const)('isChatOutboxSendAvailable(%s, %j) → %s', (protocol, view, expected) => {
    expect(isChatOutboxSendAvailable(protocol, view)).toBe(expected);
  });
});
