import { beforeEach, describe, expect, it } from 'vitest';

import {
  getConnection,
  mirrorMqttStatusToConnection,
  removeConnection,
  setConnection,
  useConnectionStore,
} from './connectionStore';

const ID_A = 'identity-a';
const ID_B = 'identity-b';

describe('connectionStore', () => {
  beforeEach(() => {
    useConnectionStore.setState({ connections: {} });
  });

  it('setConnection creates a default record for a new identity', () => {
    setConnection(ID_A, { status: 'connecting' });

    expect(getConnection(ID_A)).toEqual({
      identityId: ID_A,
      status: 'connecting',
      connectionType: null,
      mqttStatus: 'disconnected',
      reconnectAttempt: 0,
      myNodeNum: 0,
    });
  });

  it('setConnection merges partial updates without clobbering unrelated fields', () => {
    setConnection(ID_A, { status: 'connected', myNodeNum: 42, firmwareVersion: '2.5.0' });
    setConnection(ID_A, { status: 'configured' });

    expect(getConnection(ID_A)).toMatchObject({
      status: 'configured',
      myNodeNum: 42,
      firmwareVersion: '2.5.0',
    });
  });

  it('removeConnection removes one identity and leaves others intact', () => {
    setConnection(ID_A, { status: 'connected' });
    setConnection(ID_B, { status: 'connected' });

    removeConnection(ID_A);

    expect(getConnection(ID_A)).toBeUndefined();
    expect(getConnection(ID_B)?.status).toBe('connected');
  });

  it('getConnection returns undefined for a missing identity', () => {
    expect(getConnection('missing')).toBeUndefined();
  });

  it('mirrorMqttStatusToConnection updates mqttStatus when identityId is set', () => {
    setConnection(ID_A, { status: 'connected' });

    mirrorMqttStatusToConnection(ID_A, 'connected');

    expect(getConnection(ID_A)?.mqttStatus).toBe('connected');
  });

  it('mirrorMqttStatusToConnection is a no-op when identityId is null', () => {
    mirrorMqttStatusToConnection(null, 'connected');

    expect(useConnectionStore.getState().connections).toEqual({});
  });
});
