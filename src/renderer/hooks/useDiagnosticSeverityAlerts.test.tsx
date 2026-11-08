import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OperationalAlertSettings } from '../lib/appSettingsStorage';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';
import {
  DIAGNOSTIC_ALERT_COOLDOWN_MS,
  useDiagnosticSeverityAlerts,
} from './useDiagnosticSeverityAlerts';

vi.mock('../lib/desktopNotification', () => ({
  fireNotification: vi.fn(),
}));

vi.mock('../lib/chatNotifications', () => ({
  playMessageNotification: vi.fn(),
}));

import { playMessageNotification } from '../lib/chatNotifications';
import { fireNotification } from '../lib/desktopNotification';

const baseSettings: OperationalAlertSettings = {
  nodeSilenceAlertMinutes: null,
  nodeBatteryLowThreshold: 10,
  notifyOnLinkDown: true,
  notifyOnDiagnosticErrors: false,
  mecpStandingAlertEnabled: false,
  mecpRepeatAlertMinutes: null,
};

describe('useDiagnosticSeverityAlerts', () => {
  beforeEach(() => {
    useDiagnosticsStore.getState().clearDiagnostics();
    vi.mocked(fireNotification).mockClear();
    vi.mocked(playMessageNotification).mockClear();
  });

  afterEach(() => {
    useDiagnosticsStore.getState().clearDiagnostics();
  });

  it('does nothing when the setting is off', () => {
    useDiagnosticsStore.setState({
      diagnosticRows: [
        {
          kind: 'routing',
          id: 'routing:1:bad_route',
          nodeId: 1,
          type: 'bad_route',
          severity: 'error',
          description: 'Bad route',
          detectedAt: Date.now(),
        },
      ],
    });
    renderHook(() => {
      useDiagnosticSeverityAlerts({
        protocol: 'meshtastic',
        settings: baseSettings,
      });
    });
    expect(fireNotification).not.toHaveBeenCalled();
  });

  it('seeds existing rows without notifying on first enable', () => {
    useDiagnosticsStore.setState({
      diagnosticRows: [
        {
          kind: 'routing',
          id: 'routing:2:hop_goblin',
          nodeId: 2,
          type: 'hop_goblin',
          severity: 'error',
          description: 'Hop goblin',
          detectedAt: Date.now(),
        },
      ],
    });
    renderHook(() => {
      useDiagnosticSeverityAlerts({
        protocol: 'meshtastic',
        settings: { ...baseSettings, notifyOnDiagnosticErrors: true },
      });
    });
    expect(fireNotification).not.toHaveBeenCalled();
  });

  it('notifies when a new error row appears after priming', () => {
    const { rerender } = renderHook(
      (props: { settings: OperationalAlertSettings }) => {
        useDiagnosticSeverityAlerts({
          protocol: 'meshtastic',
          settings: props.settings,
        });
      },
      { initialProps: { settings: { ...baseSettings, notifyOnDiagnosticErrors: true } } },
    );
    expect(fireNotification).not.toHaveBeenCalled();

    act(() => {
      useDiagnosticsStore.setState({
        diagnosticRows: [
          {
            kind: 'routing',
            id: 'routing:3:impossible_hop',
            nodeId: 3,
            type: 'impossible_hop',
            severity: 'error',
            description: 'Impossible hop',
            detectedAt: Date.now(),
          },
        ],
      });
    });
    rerender({ settings: { ...baseSettings, notifyOnDiagnosticErrors: true } });

    expect(fireNotification).toHaveBeenCalledTimes(1);
    expect(playMessageNotification).toHaveBeenCalledWith('diagnosticError');
  });

  it('respects cooldown for the same row id', () => {
    vi.useFakeTimers();
    const { rerender } = renderHook(
      (props: { settings: OperationalAlertSettings }) => {
        useDiagnosticSeverityAlerts({
          protocol: 'meshtastic',
          settings: props.settings,
        });
      },
      { initialProps: { settings: { ...baseSettings, notifyOnDiagnosticErrors: true } } },
    );

    const row = {
      kind: 'routing' as const,
      id: 'routing:4:bad_route',
      nodeId: 4,
      type: 'bad_route' as const,
      severity: 'error' as const,
      description: 'Bad route',
      detectedAt: Date.now(),
    };

    act(() => {
      useDiagnosticsStore.setState({ diagnosticRows: [row] });
    });
    rerender({ settings: { ...baseSettings, notifyOnDiagnosticErrors: true } });
    expect(fireNotification).toHaveBeenCalledTimes(1);

    act(() => {
      useDiagnosticsStore.setState({ diagnosticRows: [] });
    });
    rerender({ settings: { ...baseSettings, notifyOnDiagnosticErrors: true } });

    act(() => {
      useDiagnosticsStore.setState({ diagnosticRows: [{ ...row, detectedAt: Date.now() }] });
    });
    rerender({ settings: { ...baseSettings, notifyOnDiagnosticErrors: true } });
    expect(fireNotification).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(DIAGNOSTIC_ALERT_COOLDOWN_MS + 1);
      useDiagnosticsStore.setState({ diagnosticRows: [] });
    });
    rerender({ settings: { ...baseSettings, notifyOnDiagnosticErrors: true } });
    act(() => {
      useDiagnosticsStore.setState({ diagnosticRows: [{ ...row, detectedAt: Date.now() }] });
    });
    rerender({ settings: { ...baseSettings, notifyOnDiagnosticErrors: true } });
    expect(fireNotification).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('does not re-alert a standing error after the cooldown elapses', () => {
    vi.useFakeTimers();
    const { rerender } = renderHook(
      (props: { settings: OperationalAlertSettings }) => {
        useDiagnosticSeverityAlerts({
          protocol: 'meshtastic',
          settings: props.settings,
        });
      },
      { initialProps: { settings: { ...baseSettings, notifyOnDiagnosticErrors: true } } },
    );
    const row = {
      kind: 'routing' as const,
      id: 'routing:8:bad_route',
      nodeId: 8,
      type: 'bad_route' as const,
      severity: 'error' as const,
      description: 'Bad route',
      detectedAt: 1,
    };
    act(() => {
      useDiagnosticsStore.setState({ diagnosticRows: [row] });
    });
    rerender({ settings: { ...baseSettings, notifyOnDiagnosticErrors: true } });
    expect(fireNotification).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(DIAGNOSTIC_ALERT_COOLDOWN_MS + 1);
      useDiagnosticsStore.setState({
        diagnosticRows: [{ ...row, detectedAt: 2, description: 'Still bad' }],
      });
    });
    rerender({ settings: { ...baseSettings, notifyOnDiagnosticErrors: true } });
    expect(fireNotification).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('seeds the visible rows when the protocol changes instead of notifying them', () => {
    const row = {
      kind: 'routing' as const,
      id: 'routing:9:bad_route',
      nodeId: 9,
      type: 'bad_route' as const,
      severity: 'error' as const,
      description: 'Bad route',
      detectedAt: 1,
    };
    useDiagnosticsStore.setState({ diagnosticRows: [row] });
    const initialProps: { protocol: 'meshtastic' | 'meshcore' } = { protocol: 'meshtastic' };
    const { rerender } = renderHook(
      (props: { protocol: 'meshtastic' | 'meshcore' }) => {
        useDiagnosticSeverityAlerts({
          protocol: props.protocol,
          settings: { ...baseSettings, notifyOnDiagnosticErrors: true },
        });
      },
      { initialProps },
    );
    expect(fireNotification).not.toHaveBeenCalled();

    rerender({ protocol: 'meshcore' });
    expect(fireNotification).not.toHaveBeenCalled();

    act(() => {
      useDiagnosticsStore.setState({
        diagnosticRows: [
          row,
          {
            kind: 'routing',
            id: 'routing:10:hop_goblin',
            nodeId: 10,
            type: 'hop_goblin',
            severity: 'error',
            description: 'Hop goblin',
            detectedAt: 2,
          },
        ],
      });
    });
    rerender({ protocol: 'meshcore' });
    expect(fireNotification).toHaveBeenCalledTimes(1);
  });
});
