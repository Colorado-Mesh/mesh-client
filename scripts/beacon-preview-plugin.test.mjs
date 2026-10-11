import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  attachBeaconPreviewPeer,
  beaconPreviewPlugin,
  isBeaconPreviewRequestAllowed,
} from './beacon-preview-plugin.mjs';

function request(origin = 'http://localhost:5173', host = 'localhost:5173', address = '127.0.0.1') {
  return { headers: { origin, host }, socket: { remoteAddress: address } };
}

function peer() {
  const socket = new EventEmitter();
  socket.readyState = 1;
  socket.bufferedAmount = 0;
  socket.send = vi.fn();
  socket.close = vi.fn(() => socket.emit('close'));
  const client = { connect: vi.fn(async () => {}), disconnect: vi.fn() };
  let publish;
  attachBeaconPreviewPeer(socket, (onUpdate) => {
    publish = onUpdate;
    return client;
  });
  return { socket, client, publish: (update) => publish(update) };
}

function send(socket, message) {
  socket.emit('message', Buffer.from(JSON.stringify(message)), false);
}

describe('Beacon development preview plugin', () => {
  it('is only active for the development server', () => {
    expect(beaconPreviewPlugin().apply).toBe('serve');
  });

  it('requires an exact same-origin loopback request on the active server port', () => {
    expect(isBeaconPreviewRequestAllowed(request(), 5173)).toBe(true);
    expect(
      isBeaconPreviewRequestAllowed(request('http://127.0.0.1:5173', '127.0.0.1:5173'), 5173),
    ).toBe(true);
    expect(
      isBeaconPreviewRequestAllowed(request('http://[::1]:5173', '[::1]:5173', '::1'), 5173),
    ).toBe(true);
    expect(isBeaconPreviewRequestAllowed(request('https://example.com'), 5173)).toBe(false);
    expect(isBeaconPreviewRequestAllowed(request('http://localhost:5174'), 5173)).toBe(false);
    expect(
      isBeaconPreviewRequestAllowed(
        request('http://localhost:5173', 'localhost:5173', '192.168.1.1'),
        5173,
      ),
    ).toBe(false);
    expect(isBeaconPreviewRequestAllowed(request('http://localhost:5173/path'), 5173)).toBe(false);
    expect(isBeaconPreviewRequestAllowed(request('null'), 5173)).toBe(false);
    expect(
      isBeaconPreviewRequestAllowed({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }, 5173),
    ).toBe(false);
  });

  it('opens nothing until asked, forwards updates and disconnects on a request and peer close', async () => {
    const { socket, client, publish } = peer();
    expect(client.connect).not.toHaveBeenCalled();
    send(socket, {
      id: 1,
      type: 'connect',
      request: { baseUrl: 'https://example.com', region: 'co' },
    });
    await Promise.resolve();
    expect(client.connect).toHaveBeenCalledWith({ baseUrl: 'https://example.com', region: 'co' });
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'response', id: 1, ok: true }));
    const update = { type: 'status', status: 'live' };
    publish(update);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'update', update }));
    send(socket, { id: 2, type: 'disconnect' });
    expect(client.disconnect).toHaveBeenCalledOnce();
    socket.emit('close');
    expect(client.disconnect).toHaveBeenCalledTimes(2);
    socket.emit('error', new Error('closed'));
    expect(client.disconnect).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed or oversized requests and relies on native feed validation', async () => {
    const first = peer();
    first.socket.emit('message', Buffer.alloc(4097), false);
    expect(first.socket.close).toHaveBeenCalledWith(1008, 'Invalid preview request');
    expect(first.client.connect).not.toHaveBeenCalled();
    const second = peer();
    send(second.socket, { id: 1, type: 'connect', request: { baseUrl: 3 } });
    expect(second.client.connect).not.toHaveBeenCalled();
    second.client.connect.mockRejectedValue(new Error('HTTPS required'));
    send(second.socket, { id: 2, type: 'connect', request: { baseUrl: 'http://example.com' } });
    await Promise.resolve();
    expect(second.socket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'response', id: 2, ok: false, error: 'HTTPS required' }),
    );
  });

  it('bounds pending connects and disconnects slow consumers', () => {
    const { socket, client, publish } = peer();
    client.connect.mockImplementation(() => new Promise(() => {}));
    send(socket, { id: 1, type: 'connect', request: { baseUrl: 'https://example.com' } });
    send(socket, { id: 2, type: 'connect', request: { baseUrl: 'https://example.com' } });
    expect(client.connect).toHaveBeenCalledOnce();
    socket.bufferedAmount = 9 * 1024 * 1024;
    publish({ type: 'status', status: 'live' });
    expect(socket.close).toHaveBeenCalledWith(1013, 'Preview consumer is too slow');
    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it('preserves the selected provider and rejects unsupported providers before opening a feed', async () => {
    const { socket, client, publish } = peer();
    send(socket, {
      id: 1,
      type: 'connect',
      request: { baseUrl: 'https://example.com', provider: 'corescope' },
    });
    await Promise.resolve();
    expect(client.connect).toHaveBeenCalledWith({
      baseUrl: 'https://example.com',
      region: undefined,
      provider: 'corescope',
    });
    const update = { type: 'packet', provider: 'corescope', packet: { hash: 'aa' } };
    publish(update);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'update', update }));
    send(socket, {
      id: 2,
      type: 'connect',
      request: { baseUrl: 'https://example.com', provider: 'unsupported' },
    });
    expect(client.connect).toHaveBeenCalledOnce();
  });
});
