// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MQTTSettings } from '../renderer/lib/types';
import { MAX_MESHCORE_MQTT_ENABLED_PUBLISH_FEEDS } from '../shared/meshcoreMqttConnections';
import {
  MAX_MESHCORE_MQTT_CONNECTIONS,
  MESHCORE_MQTT_CHAT_CONNECTION_ID,
  MeshcoreMqttPool,
} from './meshcore-mqtt-pool';

interface MockClient {
  handlers: Map<string, (...args: unknown[]) => void>;
  publish: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  options: { clientId: string };
  stream: Record<string, unknown>;
}

const clients: MockClient[] = [];

vi.mock('mqtt', () => {
  const connect = vi.fn(() => {
    const client: MockClient = {
      handlers: new Map(),
      publish: vi.fn(),
      subscribe: vi.fn(),
      options: { clientId: 'test-client-id' },
      stream: {},
    };
    // mqtt.js typed `on` overloads — the adapter only needs the registry here.
    (
      client as unknown as {
        on: (event: string, cb: (...a: unknown[]) => void) => void;
        end: () => void;
        removeAllListeners: () => void;
      }
    ).on = (event, cb) => {
      client.handlers.set(event, cb);
    };
    (client as unknown as { end: () => void }).end = vi.fn();
    (client as unknown as { removeAllListeners: () => void }).removeAllListeners = vi.fn();
    clients.push(client);
    return client;
  });
  return { connect };
});

const BASE: MQTTSettings = {
  server: 'broker.example.com',
  port: 8883,
  username: 'user',
  password: 'token',
  topicPrefix: 'meshcore/DEN',
  autoLaunch: false,
  mqttTransportProtocol: 'meshcore',
  meshcorePacketLoggerEnabled: true,
};

function connectedClient(index: number): MockClient {
  const client = clients[index];
  client.handlers.get('connect')?.();
  return client;
}

function pubKey(char: string): string {
  return `v1_${char.repeat(64)}`;
}

describe('MeshcoreMqttPool', () => {
  let pool: MeshcoreMqttPool;
  let duplicateWarnings: string[];

  beforeEach(async () => {
    const mqttModule = await import('mqtt');
    vi.mocked(mqttModule.connect).mockClear();
    clients.length = 0;
    pool = new MeshcoreMqttPool();
    // The pool forwards adapter errors as `error` events; keep the emitter from throwing.
    pool.on('error', () => undefined);
    duplicateWarnings = [];
    pool.setDuplicateFeedWarningHandler((message) => duplicateWarnings.push(message));
  });

  afterEach(() => {
    pool.disconnect();
  });

  it('keeps chat and analyzer feeds on independent sessions', () => {
    vi.useFakeTimers();
    try {
      pool.connect(
        MESHCORE_MQTT_CHAT_CONNECTION_ID,
        { ...BASE, username: 'user' },
        { role: 'chat' },
      );
      pool.connect(
        'feed-1',
        { ...BASE, server: 'analyzer.local', password: 'x' },
        {
          role: 'feed',
          publishOnly: true,
        },
      );

      expect(clients).toHaveLength(2);
      const chat = connectedClient(0);
      const feed = connectedClient(1);
      vi.advanceTimersByTime(600);

      // Publish-only feeds never subscribe.
      expect(feed.subscribe).not.toHaveBeenCalled();
      expect(chat.subscribe).toHaveBeenCalled();

      // Chat publishes only on the chat session.
      pool.publishChat({ v: 1, text: 'hello', channelIdx: 0 });
      expect(chat.publish).toHaveBeenCalledTimes(1);
      expect(feed.publish).not.toHaveBeenCalled();

      // Packet logs fan out to every connected logger.
      pool.publishPacketLog({ origin: 'me', snr: 1, rssi: -90 });
      expect(chat.publish).toHaveBeenCalledTimes(2);
      expect(feed.publish).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports per-connection status and an aggregate', () => {
    pool.connect(
      'feed-1',
      { ...BASE, server: 'a.example.com' },
      { role: 'feed', publishOnly: true },
    );
    pool.connect(
      'feed-2',
      { ...BASE, server: 'b.example.com' },
      { role: 'feed', publishOnly: true },
    );
    connectedClient(1);

    expect(pool.getStatus('feed-1')).toBe('connecting');
    expect(pool.getStatus('feed-2')).toBe('connected');
    expect(pool.isAnyConnected()).toBe(true);
    expect(pool.getStatuses()).toEqual({ 'feed-1': 'connecting', 'feed-2': 'connected' });
  });

  it('refuses a second connection to the same broker with the same username', () => {
    pool.connect('feed-1', { ...BASE }, { role: 'feed', publishOnly: true });
    expect(() => {
      pool.connect(
        'feed-2',
        { ...BASE, topicPrefix: 'meshcore/OTHER' },
        {
          role: 'feed',
          publishOnly: true,
        },
      );
    }).toThrow(/already connected/);
  });

  it('warns only when two connections target the same broker endpoint', () => {
    pool.connect('feed-1', { ...BASE, username: pubKey('b') }, { role: 'feed', publishOnly: true });
    // Same host/port with a different username still duplicates every publish.
    pool.connect('feed-2', { ...BASE, username: pubKey('c') }, { role: 'feed', publishOnly: true });
    expect(duplicateWarnings).toHaveLength(1);
    expect(duplicateWarnings[0]).toContain(`${BASE.server.trim()}:${BASE.port}`);

    duplicateWarnings.length = 0;
    // Same topic prefix on a different broker is the intended fan-out, not a duplicate.
    pool.connect(
      'feed-3',
      { ...BASE, server: 'other.example.com', username: pubKey('b') },
      { role: 'feed', publishOnly: true },
    );
    expect(duplicateWarnings).toHaveLength(0);
  });

  it(`caps analyzer feeds at ${MAX_MESHCORE_MQTT_ENABLED_PUBLISH_FEEDS} and still allows chat`, () => {
    for (let i = 0; i < MAX_MESHCORE_MQTT_ENABLED_PUBLISH_FEEDS; i += 1) {
      pool.connect(
        `feed-${i}`,
        { ...BASE, server: `${i}.example.com` },
        {
          role: 'feed',
          publishOnly: true,
        },
      );
    }
    expect(() => {
      pool.connect(
        'feed-overflow',
        { ...BASE, server: 'overflow.example.com' },
        {
          role: 'feed',
          publishOnly: true,
        },
      );
    }).toThrow(/feed limit/);

    // The chat broker is a separate slot and still connects.
    pool.connect(
      MESHCORE_MQTT_CHAT_CONNECTION_ID,
      { ...BASE, server: 'chat.example.com' },
      {
        role: 'chat',
      },
    );
    expect(pool.getStatus(MESHCORE_MQTT_CHAT_CONNECTION_ID)).toBe('connecting');
    expect(pool.isAnyConnected()).toBe(false);
    expect(pool.getConnectionIds()).toHaveLength(MAX_MESHCORE_MQTT_CONNECTIONS);
  });

  it(`caps total sessions at ${MAX_MESHCORE_MQTT_CONNECTIONS}`, () => {
    for (let i = 0; i < MAX_MESHCORE_MQTT_ENABLED_PUBLISH_FEEDS; i += 1) {
      pool.connect(
        `feed-${i}`,
        { ...BASE, server: `${i}.example.com` },
        {
          role: 'feed',
          publishOnly: true,
        },
      );
    }
    pool.connect(
      MESHCORE_MQTT_CHAT_CONNECTION_ID,
      { ...BASE, server: 'chat.example.com' },
      {
        role: 'chat',
      },
    );
    expect(() => {
      pool.connect('extra-chat', { ...BASE, server: 'extra.example.com' }, { role: 'chat' });
    }).toThrow(/connection limit/);
  });

  it('does not let a terminal-error entry block new sessions, but reconnecting it needs capacity', () => {
    // Wildcard prefix fails before a client exists, leaving a terminal `error` entry.
    pool.connect(
      'dead',
      { ...BASE, server: 'dead.example.com', topicPrefix: 'meshcore/+' },
      {
        role: 'feed',
        publishOnly: true,
      },
    );
    expect(pool.getStatus('dead')).toBe('error');
    pool.connect(
      'feed-live',
      { ...BASE, server: 'live.example.com' },
      {
        role: 'feed',
        publishOnly: true,
      },
    );
    expect(pool.getStatus('feed-live')).toBe('connecting');

    for (let i = 0; i < MAX_MESHCORE_MQTT_ENABLED_PUBLISH_FEEDS - 1; i += 1) {
      pool.connect(
        `fill-${i}`,
        { ...BASE, server: `fill-${i}.example.com` },
        {
          role: 'feed',
          publishOnly: true,
        },
      );
    }
    // Three live feeds hold the cap, so reviving the failed entry must be rejected.
    expect(() => {
      pool.connect(
        'dead',
        { ...BASE, server: 'dead.example.com' },
        {
          role: 'feed',
          publishOnly: true,
        },
      );
    }).toThrow(/feed limit/);
    // The error entry is retained for the UI.
    expect(pool.getStatus('dead')).toBe('error');
  });

  it('forwards a terminal disconnected status when a connection is torn down', () => {
    const statuses: string[] = [];
    pool.on('status', (event: { status: string; connectionId: string }) => {
      if (event.connectionId === 'feed-1') statuses.push(event.status);
    });
    pool.connect('feed-1', { ...BASE }, { role: 'feed', publishOnly: true });
    pool.disconnect('feed-1');
    expect(statuses).toContain('disconnected');
    expect(pool.getConnectionIds()).toEqual([]);
  });

  it('routes token refresh to the owning connection', () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    pool.connect(
      'feed-1',
      { ...BASE, tokenExpiresAt: expiresAt, password: 'jwt' },
      { role: 'feed', publishOnly: true },
    );
    expect(pool.getTokenInfo('feed-1')).toEqual({ token: 'jwt', expiresAt });
    expect(pool.getTokenInfo('missing')).toBeNull();

    pool.updateToken('feed-1', 'new-jwt', expiresAt + 1000);
    expect(pool.getTokenInfo('feed-1')).toEqual({ token: 'new-jwt', expiresAt: expiresAt + 1000 });
  });

  it('replaces an adapter when the role changes', () => {
    pool.connect('conn', { ...BASE }, { role: 'feed', publishOnly: true });
    expect(clients).toHaveLength(1);
    pool.connect('conn', { ...BASE }, { role: 'chat' });
    expect(clients).toHaveLength(2);
    expect(pool.getRole('conn')).toBe('chat');
  });

  it('drops one connection without disturbing the others', () => {
    pool.connect(MESHCORE_MQTT_CHAT_CONNECTION_ID, { ...BASE }, { role: 'chat' });
    pool.connect(
      'feed-1',
      { ...BASE, server: 'a.example.com' },
      { role: 'feed', publishOnly: true },
    );
    connectedClient(0);
    connectedClient(1);

    pool.disconnect('feed-1');
    expect(pool.getConnectionIds()).toEqual([MESHCORE_MQTT_CHAT_CONNECTION_ID]);
    expect(pool.getStatus(MESHCORE_MQTT_CHAT_CONNECTION_ID)).toBe('connected');
  });
});
