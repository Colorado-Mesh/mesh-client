import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installDevElectronApiStubIfNeeded,
  isDevElectronApiStub,
} from '@/renderer/lib/devElectronApiStub';
import { meshTilesAvailable } from '@/renderer/lib/mapBasemapUtils';
import { createElectronAPIMock } from '@/renderer/vitest.electronApiMock';

import { installBeaconPreviewBridge } from './beaconPreviewBridge';

class PreviewSocket extends EventTarget {
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static instances: PreviewSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  constructor(readonly url: string) {
    super();
    PreviewSocket.instances.push(this);
  }
  send(message: string) {
    this.sent.push(message);
  }
  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }
  message(message: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  }
}

describe('Beacon browser preview bridge', () => {
  let cleanup: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    cleanup = () => {};
    PreviewSocket.instances = [];
    vi.stubGlobal('electronAPI', createElectronAPIMock());
    vi.stubGlobal('WebSocket', PreviewSocket);
    vi.stubGlobal('location', { hostname: 'localhost', host: 'localhost:5173', protocol: 'http:' });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('connects lazily, forwards updates and explicitly disconnects the native feed', async () => {
    cleanup = installBeaconPreviewBridge();
    const callback = vi.fn();
    const unsubscribe = window.electronAPI.beacon.onUpdate(callback);
    expect(PreviewSocket.instances).toHaveLength(0);
    const connected = window.electronAPI.beacon.connect({
      baseUrl: 'https://beacon.example.com',
      region: 'co',
    });
    const socket = PreviewSocket.instances[0];
    expect(socket.url).toBe('ws://localhost:5173/__mesh-client-beacon-preview');
    socket.open();
    expect(JSON.parse(socket.sent[0])).toEqual({
      id: 1,
      type: 'connect',
      request: { baseUrl: 'https://beacon.example.com', region: 'co' },
    });
    socket.message({ type: 'response', id: 1, ok: true });
    expect(await connected).toEqual({ ok: true });
    socket.message({ type: 'update', update: { type: 'status', status: 'live' } });
    expect(callback).toHaveBeenCalledWith({ type: 'status', status: 'live' });
    socket.message({
      type: 'update',
      update: { type: 'message', message: { text: 'Public channel' } },
    });
    expect(callback).toHaveBeenCalledWith({ type: 'message', message: { text: 'Public channel' } });
    unsubscribe();
    callback.mockClear();
    const disconnected = window.electronAPI.beacon.disconnect();
    expect(JSON.parse(socket.sent[1])).toEqual({ id: 2, type: 'disconnect' });
    socket.message({ type: 'response', id: 2, ok: true });
    await disconnected;
    expect(socket.readyState).toBe(3);
    expect(callback).not.toHaveBeenCalled();
  });

  it('settles pending requests and restores the original API on cleanup', async () => {
    const original = window.electronAPI;
    const originalBeacon = original.beacon;
    cleanup = installBeaconPreviewBridge();
    const connected = window.electronAPI.beacon.connect({ baseUrl: 'https://beacon.example.com' });
    cleanup();
    expect(await connected).toEqual({ ok: false, error: 'Preview bridge disconnected' });
    expect(window.electronAPI).toBe(original);
    expect(window.electronAPI.beacon).toBe(originalBeacon);
    expect(PreviewSocket.instances[0].readyState).toBe(3);
  });

  it('times out unanswered requests and ignores invalid status messages', async () => {
    cleanup = installBeaconPreviewBridge();
    const callback = vi.fn();
    window.electronAPI.beacon.onUpdate(callback);
    const connected = window.electronAPI.beacon.connect({ baseUrl: 'https://beacon.example.com' });
    PreviewSocket.instances[0].open();
    PreviewSocket.instances[0].message({
      type: 'update',
      update: { type: 'status', status: 'bogus' },
    });
    expect(callback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await connected).toEqual({ ok: false, error: 'Preview bridge timed out' });
  });

  it('leaves native Electron and non-loopback pages untouched', () => {
    const original = window.electronAPI;
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Electron/40');
    cleanup = installBeaconPreviewBridge();
    expect(window.electronAPI).toBe(original);
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla');
    vi.stubGlobal('location', { hostname: 'example.com' });
    cleanup = installBeaconPreviewBridge();
    expect(window.electronAPI).toBe(original);
    expect(PreviewSocket.instances).toHaveLength(0);
  });

  it('preserves the browser stub identity and external tile selection while the bridge is installed', () => {
    vi.stubGlobal('electronAPI', undefined);
    installDevElectronApiStubIfNeeded();
    const original = window.electronAPI;
    const originalBeacon = original.beacon;
    expect(isDevElectronApiStub()).toBe(true);
    expect(meshTilesAvailable()).toBe(false);
    cleanup = installBeaconPreviewBridge();
    expect(window.electronAPI).toBe(original);
    expect(window.electronAPI.beacon).not.toBe(originalBeacon);
    expect(isDevElectronApiStub()).toBe(true);
    expect(meshTilesAvailable()).toBe(false);
    cleanup();
    expect(window.electronAPI.beacon).toBe(originalBeacon);
    expect(isDevElectronApiStub()).toBe(true);
    expect(meshTilesAvailable()).toBe(false);
  });

  it('waits for disconnect before reconnecting and ignores late events from the old socket', async () => {
    cleanup = installBeaconPreviewBridge();
    const api = window.electronAPI.beacon;
    const firstConnect = api.connect({ baseUrl: 'https://first.example.com' });
    const first = PreviewSocket.instances[0];
    first.open();
    vi.spyOn(first, 'close').mockImplementation(() => {
      first.readyState = PreviewSocket.CLOSING;
    });
    const disconnected = api.disconnect();
    const nextConnect = api.connect({ baseUrl: 'https://second.example.com' });
    expect(PreviewSocket.instances).toHaveLength(1);
    expect(first.sent).toHaveLength(2);
    first.message({ type: 'response', id: 2, ok: true });
    await disconnected;
    expect(await firstConnect).toEqual({ ok: false, error: 'Preview bridge disconnected' });
    expect(PreviewSocket.instances).toHaveLength(2);
    const second = PreviewSocket.instances[1];
    second.open();
    expect(JSON.parse(second.sent[0])).toEqual({
      id: 3,
      type: 'connect',
      request: { baseUrl: 'https://second.example.com' },
    });
    first.message({ type: 'response', id: 1, ok: true });
    first.dispatchEvent(new Event('close'));
    second.message({ type: 'response', id: 3, ok: true });
    expect(await nextConnect).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(second.readyState).toBe(PreviewSocket.OPEN);
  });

  it('cancels a queued reconnect if the feed is disabled again before disconnect finishes', async () => {
    cleanup = installBeaconPreviewBridge();
    const api = window.electronAPI.beacon;
    const connected = api.connect({ baseUrl: 'https://first.example.com' });
    const first = PreviewSocket.instances[0];
    first.open();
    first.message({ type: 'response', id: 1, ok: true });
    await connected;
    const disconnected = api.disconnect();
    const queued = api.connect({ baseUrl: 'https://second.example.com' });
    const disabledAgain = api.disconnect();
    first.message({ type: 'response', id: 2, ok: true });
    await disconnected;
    await disabledAgain;
    expect(await queued).toEqual({ ok: false, error: 'Preview connection canceled' });
    expect(PreviewSocket.instances).toHaveLength(1);
    expect(first.readyState).toBe(3);
  });

  it('tags local close and error statuses with the active CoreScope provider', async () => {
    cleanup = installBeaconPreviewBridge();
    const api = window.electronAPI.beacon;
    const update = vi.fn();
    api.onUpdate(update);
    const connecting = api.connect({
      baseUrl: 'https://corescope.example.com',
      provider: 'corescope',
    });
    const socket = PreviewSocket.instances[0];
    socket.open();
    socket.message({ type: 'response', id: 1, ok: true });
    await connecting;
    socket.dispatchEvent(new Event('error'));
    expect(update).toHaveBeenLastCalledWith({
      type: 'status',
      status: 'error',
      provider: 'corescope',
      message: 'Preview bridge unavailable',
    });
    socket.close();
    expect(update).toHaveBeenLastCalledWith({
      type: 'status',
      status: 'disconnected',
      provider: 'corescope',
    });
  });

  it('keeps the old provider on disconnect while a different provider waits to connect', async () => {
    cleanup = installBeaconPreviewBridge();
    const api = window.electronAPI.beacon;
    const update = vi.fn();
    api.onUpdate(update);
    const firstConnect = api.connect({
      baseUrl: 'https://corescope.example.com',
      provider: 'corescope',
    });
    const first = PreviewSocket.instances[0];
    first.open();
    first.message({ type: 'response', id: 1, ok: true });
    await firstConnect;
    const disconnected = api.disconnect();
    const nextConnect = api.connect({ baseUrl: 'https://beacon.example.com', provider: 'beacon' });
    first.message({ type: 'response', id: 2, ok: true });
    await disconnected;
    expect(update).toHaveBeenLastCalledWith({
      type: 'status',
      status: 'disconnected',
      provider: 'corescope',
    });
    const second = PreviewSocket.instances[1];
    second.open();
    second.message({ type: 'response', id: 3, ok: true });
    await nextConnect;
    second.close();
    expect(update).toHaveBeenLastCalledWith({
      type: 'status',
      status: 'disconnected',
      provider: 'beacon',
    });
  });
});
