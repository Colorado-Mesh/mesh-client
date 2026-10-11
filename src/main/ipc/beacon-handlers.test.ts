// @vitest-environment node
import { EventEmitter } from 'node:events';

import type { Event, WebContentsDidStartNavigationEventParams } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BeaconFeedUpdate } from '../../shared/beacon';
import type * as BeaconFeedModule from '../beacon-feed';

const harness = vi.hoisted(() => ({
  handle: vi.fn(),
  assert: vi.fn(),
  clients: [] as {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    update: (value: BeaconFeedUpdate) => void;
  }[],
}));
vi.mock('electron', () => ({ ipcMain: { handle: harness.handle } }));
vi.mock('../validate-ipc-sender', () => ({ assertIpcSender: harness.assert }));
vi.mock('../beacon-feed', async (importOriginal) => {
  const original = await importOriginal<typeof BeaconFeedModule>();
  return {
    parseBeaconConnectRequest: original.parseBeaconConnectRequest,
    BeaconFeedClient: class {
      connect = vi.fn().mockResolvedValue(undefined);
      disconnect = vi.fn();
      constructor(readonly update: (value: BeaconFeedUpdate) => void) {
        harness.clients.push(this);
      }
    },
  };
});

import { registerBeaconIpcHandlers } from './beacon-handlers';

class Sender extends EventEmitter {
  constructor(readonly id: number) {
    super();
  }
  isDestroyed = vi.fn().mockReturnValue(false);
  send = vi.fn();
}

function handler(
  channel: string,
): (event: { sender: Sender }, value?: unknown) => Promise<unknown> {
  const entry = harness.handle.mock.calls.find(([name]) => name === channel);
  if (!entry) throw new Error(`Missing ${channel}`);
  return entry[1] as (event: { sender: Sender }, value?: unknown) => Promise<unknown>;
}

beforeEach(() => {
  harness.handle.mockReset();
  harness.assert.mockReset();
  harness.clients.length = 0;
  registerBeaconIpcHandlers();
});

const request = { baseUrl: 'https://map.meshcore.coloradomesh.org' };

describe('Beacon IPC ownership', () => {
  it('preserves CoreScope selection and source-tagged observations across IPC', async () => {
    const sender = new Sender(1);
    const selected = {
      baseUrl: 'https://analyzer.bostonme.sh',
      provider: 'corescope',
      region: 'BOS',
    };
    await expect(handler('beacon:connect')({ sender }, selected)).resolves.toEqual({ ok: true });
    expect(harness.clients[0].connect).toHaveBeenCalledWith(selected);
    const update = {
      type: 'packet' as const,
      provider: 'corescope' as const,
      packet: { observer_id: 'aa' },
    };
    harness.clients[0].update(update);
    expect(sender.send).toHaveBeenCalledWith('beacon:update', update);
  });

  it('validates every sender before creating or disconnecting a feed', async () => {
    const sender = new Sender(1);
    harness.assert.mockImplementation(() => {
      throw new Error('unauthorized');
    });
    await expect(handler('beacon:connect')({ sender }, request)).rejects.toThrow('unauthorized');
    expect(() => handler('beacon:disconnect')({ sender })).toThrow('unauthorized');
    expect(harness.clients).toHaveLength(0);
  });

  it('rejects malformed input before a feed is created', async () => {
    await expect(
      handler('beacon:connect')({ sender: new Sender(1) }, { baseUrl: 'https://127.0.0.1' }),
    ).resolves.toMatchObject({ ok: false });
    expect(harness.clients).toHaveLength(0);
  });

  it('routes public updates only to the owner and disposes only its connection', async () => {
    const first = new Sender(1);
    const second = new Sender(2);
    await handler('beacon:connect')({ sender: first }, request);
    await handler('beacon:connect')({ sender: second }, request);
    harness.clients[0].update({ type: 'status', status: 'live' });
    expect(first.send).toHaveBeenCalledWith('beacon:update', { type: 'status', status: 'live' });
    expect(second.send).not.toHaveBeenCalled();
    await handler('beacon:disconnect')({ sender: first });
    expect(harness.clients[0].disconnect).toHaveBeenCalledOnce();
    expect(harness.clients[1].disconnect).not.toHaveBeenCalled();
    expect(first.listenerCount('destroyed')).toBe(0);
  });

  it.each(['destroyed', 'render-process-gone'])(
    'cleans up on %s without retaining listeners',
    async (event) => {
      const sender = new Sender(1);
      await handler('beacon:connect')({ sender }, request);
      sender.emit(event);
      expect(harness.clients[0].disconnect).toHaveBeenCalledOnce();
      expect(sender.listenerCount('destroyed')).toBe(0);
      expect(sender.listenerCount('did-start-navigation')).toBe(0);
      expect(sender.listenerCount('render-process-gone')).toBe(0);
    },
  );

  it.each([
    { isMainFrame: true, isSameDocument: false, disconnected: true },
    { isMainFrame: true, isSameDocument: true, disconnected: false },
    { isMainFrame: false, isSameDocument: false, disconnected: false },
    { isMainFrame: false, isSameDocument: true, disconnected: false },
  ])(
    'only disposes on a main-frame document navigation: $isMainFrame/$isSameDocument',
    async ({ isMainFrame, isSameDocument, disconnected }) => {
      const sender = new Sender(1);
      await handler('beacon:connect')({ sender }, request);
      const details: Event<WebContentsDidStartNavigationEventParams> = {
        url: 'file:///mesh-client/index.html',
        isMainFrame,
        isSameDocument,
        frame: null,
        preventDefault: vi.fn(),
        defaultPrevented: false,
      };
      sender.emit('did-start-navigation', details);
      expect(harness.clients[0].disconnect).toHaveBeenCalledTimes(disconnected ? 1 : 0);
      for (const event of ['destroyed', 'did-start-navigation', 'render-process-gone']) {
        expect(sender.listenerCount(event)).toBe(disconnected ? 0 : 1);
      }
      const update = { type: 'status' as const, status: 'live' as const };
      harness.clients[0].update(update);
      if (disconnected) expect(sender.send).not.toHaveBeenCalled();
      else expect(sender.send).toHaveBeenCalledWith('beacon:update', update);
    },
  );

  it('replaces the old connection and never sends updates into a destroyed renderer', async () => {
    const sender = new Sender(1);
    await handler('beacon:connect')({ sender }, request);
    await handler('beacon:connect')({ sender }, request);
    expect(harness.clients[0].disconnect).toHaveBeenCalledOnce();
    expect(sender.listenerCount('destroyed')).toBe(1);
    sender.isDestroyed.mockReturnValue(true);
    harness.clients[1].update({ type: 'status', status: 'live' });
    expect(sender.send).not.toHaveBeenCalled();
  });
});
