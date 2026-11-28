// @vitest-environment node
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import type { ReachCheckApi } from '../../shared/reachCheck';
import { REACH_CHECK_IPC_CHANNELS, registerReachCheckIpcHandlers } from './reach-check-handlers';

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function setup(client: Partial<ReachCheckApi> = {}) {
  const handlers = new Map<string, Handler>();
  const ipcMain = {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    }),
  };
  const assertIpcSender = vi.fn();
  const api: ReachCheckApi = {
    bootstrap: vi.fn(() => Promise.resolve({ ok: false as const, error: 'network' as const })),
    createSession: vi.fn(() =>
      Promise.resolve({ ok: false as const, error: 'rate_limited' as const, retryAfterSeconds: 9 }),
    ),
    getSession: vi.fn(() =>
      Promise.resolve({ ok: false as const, error: 'session_not_found' as const }),
    ),
    ...client,
  };
  registerReachCheckIpcHandlers({ ipcMain, assertIpcSender, client: api });
  return { handlers, assertIpcSender, api };
}

const event = { sender: { id: 1 } } as unknown as IpcMainInvokeEvent;

describe('registerReachCheckIpcHandlers', () => {
  it('registers the three reach check channels', () => {
    const { handlers } = setup();
    expect([...handlers.keys()].sort()).toEqual([...REACH_CHECK_IPC_CHANNELS].sort());
    expect(REACH_CHECK_IPC_CHANNELS).toEqual([
      'reachCheck:bootstrap',
      'reachCheck:createSession',
      'reachCheck:getSession',
    ]);
  });

  it.each(REACH_CHECK_IPC_CHANNELS)('checks the sender on %s', async (channel) => {
    const { handlers, assertIpcSender } = setup();
    await handlers.get(channel)?.(event, 'https://rangecheck.example.org', 'abc');
    expect(assertIpcSender).toHaveBeenCalledWith(event, channel);
  });

  it('passes results through from the client', async () => {
    const { handlers, api } = setup();
    await expect(
      handlers.get('reachCheck:createSession')?.(event, 'https://rangecheck.example.org'),
    ).resolves.toEqual({ ok: false, error: 'rate_limited', retryAfterSeconds: 9 });
    expect(api.createSession).toHaveBeenCalledWith('https://rangecheck.example.org');
    await handlers.get('reachCheck:getSession')?.(event, 'https://rangecheck.example.org', 'abc');
    expect(api.getSession).toHaveBeenCalledWith('https://rangecheck.example.org', 'abc');
  });

  it.each([
    ['reachCheck:bootstrap', [42]],
    ['reachCheck:createSession', [{ origin: 'x' }]],
    ['reachCheck:getSession', ['https://rangecheck.example.org', 7]],
    ['reachCheck:getSession', [undefined, 'abc']],
  ])(
    'answers invalid_url for non-string arguments on %s without calling the client',
    async (channel, args) => {
      const { handlers, api } = setup();
      await expect(handlers.get(channel)?.(event, ...args)).resolves.toEqual({
        ok: false,
        error: 'invalid_url',
      });
      expect(api.bootstrap).not.toHaveBeenCalled();
      expect(api.createSession).not.toHaveBeenCalled();
      expect(api.getSession).not.toHaveBeenCalled();
    },
  );

  it('answers network when the client throws', async () => {
    const { handlers } = setup({
      bootstrap: vi.fn(() => Promise.reject(new Error('boom'))),
    });
    await expect(
      handlers.get('reachCheck:bootstrap')?.(event, 'https://rangecheck.example.org'),
    ).resolves.toEqual({ ok: false, error: 'network' });
  });

  it('lets a rejected sender check throw', async () => {
    const { handlers, assertIpcSender } = setup();
    assertIpcSender.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(
      handlers.get('reachCheck:bootstrap')?.(event, 'https://rangecheck.example.org'),
    ).rejects.toThrow('untrusted sender');
  });
});
