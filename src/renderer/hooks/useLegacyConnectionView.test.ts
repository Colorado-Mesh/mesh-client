import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { setConnection, useConnectionStore } from '../stores/connectionStore';
import { useLegacyConnectionView } from './useLegacyConnectionView';

const IDENTITY = 'id-meshtastic-test';

describe('useLegacyConnectionView', () => {
  beforeEach(() => {
    useConnectionStore.setState({ connections: {} });
  });

  it('returns disconnected defaults when identity or store row is missing', () => {
    const { result } = renderHook(() => useLegacyConnectionView(null));

    expect(result.current.state.status).toBe('disconnected');
    expect(result.current.state.myNodeNum).toBe(0);
    expect(result.current.mqttStatus).toBe('disconnected');
  });

  it('reads connection fields from the identity-scoped store row', () => {
    setConnection(IDENTITY, {
      status: 'configured',
      connectionType: 'serial',
      myNodeNum: 0xabcd,
      mqttStatus: 'connected',
      reconnectAttempt: 2,
      connectionLoss: true,
    });

    const { result } = renderHook(() => useLegacyConnectionView(IDENTITY));

    expect(result.current.state.status).toBe('configured');
    expect(result.current.state.connectionType).toBe('serial');
    expect(result.current.state.myNodeNum).toBe(0xabcd);
    expect(result.current.state.reconnectAttempt).toBe(2);
    expect(result.current.state.connectionLoss).toBe(true);
    expect(result.current.mqttStatus).toBe('connected');
  });

  it('prefers store mqttStatus when present', () => {
    setConnection(IDENTITY, { mqttStatus: 'connected' });

    const { result } = renderHook(() => useLegacyConnectionView(IDENTITY));

    expect(result.current.mqttStatus).toBe('connected');
  });
});
