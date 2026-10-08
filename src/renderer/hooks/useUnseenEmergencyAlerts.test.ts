// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tryParseMecp } from '@/renderer/lib/mecp/mecpMessages';
import { useIncidentStore } from '@/renderer/stores/incidentStore';
import { MS_PER_MINUTE } from '@/shared/timeConstants';

import { useUnseenEmergencyAlerts } from './useUnseenEmergencyAlerts';

const { playMecpSiren, playMecpEasAttention } = vi.hoisted(() => ({
  playMecpSiren: vi.fn(),
  playMecpEasAttention: vi.fn(),
}));
vi.mock('../lib/chatNotifications', () => ({ playMecpSiren, playMecpEasAttention }));

function ingest(text: string, senderId: string, fromSeed = false): string {
  let id = '';
  act(() => {
    id = useIncidentStore.getState().upsertFromMecp({
      protocol: 'meshtastic',
      parsed: tryParseMecp(text)!,
      senderId,
      receivedAt: Date.now(),
      fromSeed,
    })!;
  });
  return id;
}

describe('useUnseenEmergencyAlerts', () => {
  let requestAttention: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    useIncidentStore.getState().clearAll();
    playMecpSiren.mockClear();
    playMecpEasAttention.mockClear();
    requestAttention = vi.mocked(window.electronAPI.app.requestAttention);
    requestAttention.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('requests window attention once per newly unseen incident, never for seed or drills', () => {
    renderHook(() => {
      useUnseenEmergencyAlerts(null);
    });
    expect(requestAttention).not.toHaveBeenCalled();
    ingest('MECP/0/M01 seeded', '1', true);
    ingest('MECP/0/D01 M01', '2');
    expect(requestAttention).not.toHaveBeenCalled();
    ingest('MECP/1/T04', '3');
    expect(requestAttention).toHaveBeenCalledTimes(1);
    ingest('MECP/2/L01', '4');
    expect(requestAttention).toHaveBeenCalledTimes(1);
    ingest('MECP/0/M01 help', '5');
    expect(requestAttention).toHaveBeenCalledTimes(2);
  });

  it('does not repeat the tone when the setting is off', () => {
    renderHook(() => {
      useUnseenEmergencyAlerts(null);
    });
    ingest('MECP/0/M01 help', '1');
    act(() => {
      vi.advanceTimersByTime(60 * MS_PER_MINUTE);
    });
    expect(playMecpSiren).not.toHaveBeenCalled();
  });

  it('repeats the most severe tone each interval until everything is seen', () => {
    renderHook(() => {
      useUnseenEmergencyAlerts(2);
    });
    const urgent = ingest('MECP/1/T04', '1');
    act(() => {
      vi.advanceTimersByTime(2 * MS_PER_MINUTE);
    });
    expect(playMecpEasAttention).toHaveBeenCalledTimes(1);
    expect(playMecpSiren).not.toHaveBeenCalled();

    const mayday = ingest('MECP/0/M01 help', '2');
    act(() => {
      vi.advanceTimersByTime(2 * MS_PER_MINUTE);
    });
    expect(playMecpSiren).toHaveBeenCalledTimes(1);

    act(() => {
      useIncidentStore.getState().markSeen(mayday);
      useIncidentStore.getState().resolveIncident(urgent);
    });
    act(() => {
      vi.advanceTimersByTime(10 * MS_PER_MINUTE);
    });
    expect(playMecpSiren).toHaveBeenCalledTimes(1);
    expect(playMecpEasAttention).toHaveBeenCalledTimes(1);
  });
});
