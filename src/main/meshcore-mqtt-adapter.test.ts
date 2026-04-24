// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MQTTSettings } from '../renderer/lib/types';
import { MeshcoreMqttAdapter } from './meshcore-mqtt-adapter';

vi.mock('mqtt', () => {
  const mockClient = {
    on: vi.fn(),
    end: vi.fn(),
    removeAllListeners: vi.fn(),
    connected: false,
    publish: vi.fn(),
    subscribe: vi.fn(),
    reschedulePing: vi.fn(),
  };
  return { connect: vi.fn(() => mockClient) };
});

const BASE_SETTINGS: MQTTSettings = {
  server: 'broker.example.com',
  port: 8883,
  username: 'user',
  password: 'token',
  topicPrefix: 'msh',
  autoLaunch: false,
  mqttTransportProtocol: 'meshcore',
};

interface AdapterPrivate {
  status: string;
  lastSettings: MQTTSettings | null;
  pendingReconnect: boolean;
  _doConnect: (s: MQTTSettings) => void;
}

/** Force private state so we can test timer scheduling without a full connect. */
function seedConnected(adapter: MeshcoreMqttAdapter, expiresAt: number): void {
  const a = adapter as unknown as AdapterPrivate;
  a.status = 'connected';
  a.lastSettings = { ...BASE_SETTINGS, tokenExpiresAt: expiresAt };
}

describe('MeshcoreMqttAdapter — token refresh', () => {
  let adapter: MeshcoreMqttAdapter;

  beforeEach(() => {
    vi.useFakeTimers();
    adapter = new MeshcoreMqttAdapter();
  });

  afterEach(() => {
    adapter.disconnect();
    vi.useRealTimers();
  });

  describe('scheduleTokenRefresh via updateToken', () => {
    it('emits EVENT_PROACTIVE_TOKEN_REFRESH after the grace-period offset', () => {
      // Use 30-min expiry so grace-period logic is the binding constraint,
      // not the 54-min PROACTIVE_REFRESH_MS cap.
      const TOKEN_GRACE_PERIOD_MS = 5 * 60 * 1000;
      const expiresInMs = 30 * 60 * 1000;
      const scheduleMs = expiresInMs - TOKEN_GRACE_PERIOD_MS; // 25 min
      const expiresAt = Date.now() + expiresInMs;

      seedConnected(adapter, expiresAt);

      const handler = vi.fn();
      adapter.on(MeshcoreMqttAdapter.EVENT_PROACTIVE_TOKEN_REFRESH, handler);

      adapter.updateToken('new-token', expiresAt);

      expect(handler).not.toHaveBeenCalled();

      vi.advanceTimersByTime(scheduleMs - 1);
      expect(handler).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2);
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(BASE_SETTINGS.server);
    });

    it('caps schedule at PROACTIVE_REFRESH_MS (54 min) for long-lived tokens', () => {
      const PROACTIVE_REFRESH_MS = 54 * 60 * 1000;
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 h from now

      seedConnected(adapter, expiresAt);

      const handler = vi.fn();
      adapter.on(MeshcoreMqttAdapter.EVENT_PROACTIVE_TOKEN_REFRESH, handler);
      adapter.updateToken('new-token', expiresAt);

      vi.advanceTimersByTime(PROACTIVE_REFRESH_MS - 1);
      expect(handler).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2);
      expect(handler).toHaveBeenCalledOnce();
    });

    it('does not schedule when token is already within grace period', () => {
      const expiresAt = Date.now() + 4 * 60 * 1000; // 4 min — inside 5-min grace

      seedConnected(adapter, expiresAt);

      const handler = vi.fn();
      adapter.on(MeshcoreMqttAdapter.EVENT_PROACTIVE_TOKEN_REFRESH, handler);
      adapter.updateToken('new-token', expiresAt);

      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(handler).not.toHaveBeenCalled();
    });

    it('does not schedule when not connected', () => {
      const expiresAt = Date.now() + 60 * 60 * 1000;

      const handler = vi.fn();
      adapter.on(MeshcoreMqttAdapter.EVENT_PROACTIVE_TOKEN_REFRESH, handler);
      adapter.updateToken('token', expiresAt);

      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('disconnect() clears pending token timer', () => {
    it('cancels the refresh timer so the event never fires', () => {
      const expiresAt = Date.now() + 60 * 60 * 1000;

      seedConnected(adapter, expiresAt);

      const handler = vi.fn();
      adapter.on(MeshcoreMqttAdapter.EVENT_PROACTIVE_TOKEN_REFRESH, handler);
      adapter.updateToken('token', expiresAt);

      adapter.disconnect();

      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('updateToken with pendingReconnect', () => {
    it('clears pendingReconnect and calls _doConnect', () => {
      const expiresAt = Date.now() + 60 * 60 * 1000;
      const a = adapter as unknown as AdapterPrivate;
      a.pendingReconnect = true;
      a.lastSettings = { ...BASE_SETTINGS, tokenExpiresAt: expiresAt };

      const doConnectSpy = vi.spyOn(adapter as unknown as AdapterPrivate, '_doConnect');

      adapter.updateToken('fresh-token', expiresAt);

      expect(a.pendingReconnect).toBe(false);
      expect(doConnectSpy).toHaveBeenCalledOnce();
    });

    it('does not call _doConnect when pendingReconnect is false', () => {
      const expiresAt = Date.now() + 60 * 60 * 1000;
      const a = adapter as unknown as AdapterPrivate;
      a.lastSettings = { ...BASE_SETTINGS, tokenExpiresAt: expiresAt };

      const doConnectSpy = vi.spyOn(adapter as unknown as AdapterPrivate, '_doConnect');

      adapter.updateToken('token', expiresAt);

      expect(doConnectSpy).not.toHaveBeenCalled();
    });
  });
});
