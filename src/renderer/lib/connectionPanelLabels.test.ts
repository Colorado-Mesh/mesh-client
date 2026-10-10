import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import type { TAKRemoteStatus } from '@/shared/tak-types';

import {
  connectionPanelMqttStatusLabel,
  connectionPanelRadioStatusLabel,
  connectionPanelTakRemoteLabel,
  connectionPanelTakStatusLabel,
  takStatusBarLabels,
} from './connectionPanelLabels';
import type { ConnectionStatus, MQTTStatus } from './types';

function mockT(): TFunction {
  return ((key: string) => key) as TFunction;
}

describe('connectionPanelRadioStatusLabel', () => {
  it.each<[ConnectionStatus, string]>([
    ['disconnected', 'app.deviceStatus.disconnected'],
    ['connecting', 'app.deviceStatus.connecting'],
    ['connected', 'app.deviceStatus.connected'],
    ['configured', 'app.deviceStatus.configured'],
    ['stale', 'app.deviceStatus.stale'],
    ['reconnecting', 'app.deviceStatus.reconnecting'],
  ])('maps %s to %s', (status, key) => {
    expect(connectionPanelRadioStatusLabel(mockT(), status)).toBe(key);
  });
});

describe('connectionPanelMqttStatusLabel', () => {
  it.each<[MQTTStatus, boolean, string]>([
    ['connected', false, 'app.deviceStatus.connected'],
    ['connecting', false, 'app.deviceStatus.connecting'],
    ['disconnected', false, 'app.deviceStatus.disconnected'],
    ['error', false, 'connectionPanel.tiles.error'],
    ['connecting', true, 'connectionPanel.tiles.error'],
  ])('maps %s (loss %s) to %s', (status, loss, key) => {
    expect(connectionPanelMqttStatusLabel(mockT(), status, loss)).toBe(key);
  });
});

describe('connectionPanelTakStatusLabel', () => {
  it.each<[boolean, boolean, boolean, string]>([
    [true, false, false, 'connectionPanel.tiles.running'],
    [true, false, true, 'connectionPanel.tiles.clientLost'],
    [false, true, false, 'connectionPanel.tiles.error'],
    [false, false, false, 'connectionPanel.tiles.stopped'],
  ])('running %s, error %s, client loss %s maps to %s', (running, error, loss, key) => {
    expect(connectionPanelTakStatusLabel(mockT(), running, error, loss)).toBe(key);
  });
});

describe('connectionPanelTakRemoteLabel', () => {
  it.each<[TAKRemoteStatus['state'], string | undefined, string | null]>([
    ['connected', undefined, 'connectionPanel.tiles.remoteConnected'],
    ['connected', 'stale error', 'connectionPanel.tiles.remoteConnected'],
    ['connecting', undefined, 'connectionPanel.tiles.remoteConnecting'],
    ['connecting', 'Connection refused', 'connectionPanel.tiles.remoteError'],
    ['disconnected', 'bad certificate', 'connectionPanel.tiles.remoteError'],
    ['disconnected', undefined, null],
  ])('state %s, error %s maps to %s', (state, error, key) => {
    expect(connectionPanelTakRemoteLabel(mockT(), { state, error })).toBe(key);
  });
});

describe('takStatusBarLabels', () => {
  const tWithOpts = ((key: string, opts?: Record<string, unknown>) =>
    opts ? `${key}:${JSON.stringify(opts)}` : key) as TFunction;
  const OFF = { state: 'disconnected' as const };

  it('uses the local-only labels while the relay is off', () => {
    expect(takStatusBarLabels(tWithOpts, true, false, OFF)).toEqual({
      label: 'app.takRunning',
      ariaLabel: 'app.takServerRunning',
    });
    expect(takStatusBarLabels(tWithOpts, false, false, OFF)).toEqual({
      label: 'app.takStopped',
      ariaLabel: 'app.takServerStopped',
    });
    expect(takStatusBarLabels(tWithOpts, true, true, OFF).label).toBe('app.takClientLost');
  });

  it('shows only the remote state when the local server is stopped', () => {
    const remote = 'app.takRemoteOnly:{"remote":"app.takRemoteConnected"}';
    expect(takStatusBarLabels(tWithOpts, false, false, { state: 'connected' })).toEqual({
      label: remote,
      ariaLabel: remote,
    });
  });

  it('combines both when the local server runs and the relay is active', () => {
    expect(
      takStatusBarLabels(tWithOpts, true, false, { state: 'connecting', error: 'refused' }),
    ).toEqual({
      label: 'app.takWithRemote:{"local":"app.takRunning","remote":"app.takRemoteError"}',
      ariaLabel: 'app.takWithRemote:{"local":"app.takServerRunning","remote":"app.takRemoteError"}',
    });
  });
});
