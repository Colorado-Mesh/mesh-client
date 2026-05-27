import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DeviceState, MQTTStatus } from '../lib/types';
import { setConnection, useConnectionStore } from '../stores/connectionStore';
import { useLegacyConnectionView } from './useLegacyConnectionView';

const IDENTITY = 'id-meshtastic-test';

function legacyStub(overrides?: Partial<{ state: DeviceState; mqttStatus: MQTTStatus }>) {
  return {
    state: {
      status: 'disconnected',
      myNodeNum: 0,
      connectionType: null,
      connectionLoss: false,
      reconnectAttempt: 0,
      lastDataReceived: 0,
      firmwareVersion: undefined,
      manufacturerModel: undefined,
      batteryPercent: undefined,
      batteryCharging: undefined,
      ...overrides?.state,
    },
    mqttStatus: overrides?.mqttStatus ?? ('disconnected' as const),
  };
}

describe('useLegacyConnectionView', () => {
  beforeEach(() => {
    useConnectionStore.setState({ connections: {} });
  });

  it('falls back to legacy hook state when identity or store row is missing', () => {
    const legacy = legacyStub({
      state: {
        status: 'connected',
        myNodeNum: 42,
        connectionType: 'ble',
        connectionLoss: false,
        reconnectAttempt: 0,
        lastDataReceived: 0,
      },
      mqttStatus: 'connecting',
    });

    const { result } = renderHook(() => useLegacyConnectionView(null, legacy as never));

    expect(result.current.state.status).toBe('connected');
    expect(result.current.state.myNodeNum).toBe(42);
    expect(result.current.mqttStatus).toBe('connecting');
  });

  it('merges connection store fields with legacy connectionLoss', () => {
    const legacy = legacyStub({
      state: {
        status: 'disconnected',
        myNodeNum: 0,
        connectionType: null,
        connectionLoss: true,
        reconnectAttempt: 0,
        lastDataReceived: 0,
      },
      mqttStatus: 'disconnected',
    });

    setConnection(IDENTITY, {
      status: 'configured',
      connectionType: 'serial',
      myNodeNum: 0xabcd,
      mqttStatus: 'connected',
      reconnectAttempt: 2,
    });

    const { result } = renderHook(() => useLegacyConnectionView(IDENTITY, legacy as never));

    expect(result.current.state.status).toBe('configured');
    expect(result.current.state.connectionType).toBe('serial');
    expect(result.current.state.myNodeNum).toBe(0xabcd);
    expect(result.current.state.reconnectAttempt).toBe(2);
    expect(result.current.state.connectionLoss).toBe(true);
    expect(result.current.mqttStatus).toBe('connected');
  });

  it('prefers store mqttStatus when present', () => {
    const legacy = legacyStub({ mqttStatus: 'error' });
    setConnection(IDENTITY, { mqttStatus: 'connected' });

    const { result } = renderHook(() => useLegacyConnectionView(IDENTITY, legacy as never));

    expect(result.current.mqttStatus).toBe('connected');
  });
});
