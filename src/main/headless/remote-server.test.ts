// @vitest-environment node
import { readFileSync } from 'fs';
import { createServer, type Server } from 'http';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import type { HeadlessRemoteConfig } from '../../shared/headless';
import { HeadlessRemoteServer, type HeadlessTargetWindow } from './remote-server';
import { mapKeyCodeToSendInput, toSendInputEvent } from './remote-server';

class RemoteTestClient {
  private readonly messages: { data: string | Buffer; isBinary: boolean }[] = [];
  readonly ws: WebSocket;

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data, isBinary) => {
      this.messages.push({
        data: isBinary
          ? Buffer.from(data as unknown as ArrayBuffer)
          : Buffer.from(data as unknown as ArrayBuffer).toString('utf8'),
        isBinary,
      });
    });
  }

  /** Resolve with the first (string | binary) message matching pred; checks backlog + live events. */
  waitFor(
    pred: (m: { data: string | Buffer; isBinary: boolean }) => boolean,
    label: string,
  ): Promise<{ data: string | Buffer; isBinary: boolean }> {
    return withTimeout(
      new Promise<{ data: string | Buffer; isBinary: boolean }>((resolve) => {
        const fromBacklog = this.messages.find(pred);
        if (fromBacklog) {
          resolve(fromBacklog);
          return;
        }
        const listener = (): void => {
          const hit = this.messages.find(pred);
          if (hit) {
            this.ws.removeListener('message', listener);
            resolve(hit);
          }
        };
        this.ws.on('message', listener);
      }),
      10_000,
      label,
    );
  }

  waitForString(): Promise<string> {
    return this.waitFor((m) => !m.isBinary, 'string control frame').then((m) => m.data as string);
  }

  waitForBinary(): Promise<Buffer> {
    return this.waitFor((m) => m.isBinary, 'binary frame').then((m) => m.data as Buffer);
  }

  binaryFrameCount(): number {
    return this.messages.filter((m) => m.isBinary).length;
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // catch-no-log-ok already closed
    }
  }
}

const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const t = setTimeout(() => {
        reject(new Error(`timeout: ${label}`));
      }, ms);
      t.unref?.();
    }),
  ]);

function baseConfig(overrides: Partial<HeadlessRemoteConfig> = {}): HeadlessRemoteConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    token: '',
    fps: 60,
    jpegQuality: 70,
    viewportWidth: 1280,
    viewportHeight: 800,
    wsHeartbeatSec: 30,
    ...overrides,
  };
}

interface FakeState {
  bitmap: Buffer;
  captureCount: number;
}

function makeFakeWin(state: FakeState): {
  win: HeadlessTargetWindow;
  sendInputEvents: unknown[];
  insertTexts: string[];
  focusCallCount: number;
} {
  const sendInputEvents: unknown[] = [];
  const insertTexts: string[] = [];
  const calls = { sendInputEvents, insertTexts, focusCallCount: 0 };
  const win: HeadlessTargetWindow = {
    webContents: {
      capturePage: vi.fn(
        (): Promise<{
          isEmpty: () => boolean;
          toJPEG: (quality: number) => Buffer;
          toBitmap: () => Buffer;
        }> => {
          state.captureCount += 1;
          return Promise.resolve({
            isEmpty: () => state.bitmap.length === 0,
            toJPEG: (quality: number) => Buffer.from(`jpeg-q${quality}`),
            toBitmap: () => state.bitmap,
          });
        },
      ),
      sendInputEvent: vi.fn((event) => {
        sendInputEvents.push(event);
      }),
      insertText: vi.fn((text: string) => {
        insertTexts.push(text);
        return Promise.resolve();
      }),
      isLoading: () => false,
      isDestroyed: () => false,
    },
    isFocused: () => true,
    focus: () => {
      calls.focusCallCount += 1;
    },
  };
  return { win, ...calls };
}

function connectWs(
  port: number,
  extra: { token?: string; cookie?: string } = {},
): Promise<RemoteTestClient> {
  const headers: Record<string, string> = {};
  if (extra.cookie) headers.Cookie = extra.cookie;
  const ws = new WebSocket(
    `ws://127.0.0.1:${port}/ws${extra.token ? `?token=${encodeURIComponent(extra.token)}` : ''}`,
    { headers },
  );
  return withTimeout(
    new Promise<RemoteTestClient>((resolve, reject) => {
      const client = new RemoteTestClient(ws);
      ws.once('open', () => {
        resolve(client);
      });
      ws.once('error', (err) => {
        reject(err);
      });
    }),
    5000,
    'websocket connect',
  );
}

describe('toSendInputEvent (pure mapping)', () => {
  it('maps mouse, wheel, and keyboard messages with clamped coordinates', () => {
    expect(toSendInputEvent({ type: 'mousemove', x: -10, y: 5000, buttons: 0 }, 1280, 800)).toEqual(
      {
        type: 'mouseMove',
        x: 0,
        y: 800,
      },
    );
    expect(toSendInputEvent({ type: 'mousedown', x: 5, y: 6, button: 'right' }, 1280, 800)).toEqual(
      {
        type: 'mouseDown',
        x: 5,
        y: 6,
        button: 'right',
        clickCount: 1,
      },
    );
    expect(toSendInputEvent({ type: 'mouseup', x: 1, y: 2, button: 'middle' }, 1280, 800)).toEqual({
      type: 'mouseUp',
      x: 1,
      y: 2,
      button: 'middle',
      clickCount: 1,
    });
    expect(
      toSendInputEvent({ type: 'wheel', x: 3, y: 4, deltaX: -10, deltaY: 25 }, 1280, 800),
    ).toEqual({
      type: 'mouseWheel',
      x: 3,
      y: 4,
      deltaX: -10,
      deltaY: 25,
    });
  });

  it('maps key events and normalizes modifiers', () => {
    expect(
      toSendInputEvent(
        { type: 'keydown', key: 'a', code: 'KeyA', modifiers: ['ctrl', 'shift'] },
        1,
        1,
      ),
    ).toEqual({
      type: 'keyDown',
      keyCode: 'a',
      modifiers: ['control', 'shift'],
    });
    expect(
      toSendInputEvent({ type: 'keyup', key: 'Enter', code: 'Enter', modifiers: [] }, 1, 1),
    ).toEqual({
      type: 'keyUp',
      keyCode: 'Enter',
      modifiers: [],
    });
  });

  it('returns null for char (handled via insertText) and resize (ignored)', () => {
    expect(toSendInputEvent({ type: 'char', char: 'x' }, 1, 1)).toBeNull();
    expect(toSendInputEvent({ type: 'resize', width: 100, height: 100 }, 1, 1)).toBeNull();
  });

  it('maps DOM key names to Electron accelerator key codes', () => {
    expect(mapKeyCodeToSendInput(' ')).toBe('Space');
    expect(mapKeyCodeToSendInput('ArrowUp')).toBe('Up');
    expect(mapKeyCodeToSendInput('Backspace')).toBe('Backspace');
    expect(mapKeyCodeToSendInput('CapsLock')).toBe('Capslock');
    expect(mapKeyCodeToSendInput('F5')).toBe('F5');
    expect(mapKeyCodeToSendInput('✓')).toBe('✓');
  });
});

describe('HeadlessRemoteServer lifecycle', () => {
  const servers: HeadlessRemoteServer[] = [];

  function track(server: HeadlessRemoteServer): void {
    servers.push(server);
  }

  afterEach(async () => {
    for (const server of servers) await server.stop();
    servers.length = 0;
  });

  it('starts on an ephemeral port and sends hello on connect', async () => {
    const state: FakeState = { bitmap: Buffer.from('frame'), captureCount: 0 };
    const fake = makeFakeWin(state);
    const server = new HeadlessRemoteServer();
    track(server);
    expect(await server.start(fake.win, baseConfig())).toBe(true);
    expect(server.isRunning).toBe(true);
    expect(server.getPort()).toBeGreaterThan(0);

    const client = await connectWs(server.getPort()!);
    try {
      const parsed = JSON.parse(await client.waitForString()) as Record<string, unknown>;
      expect(parsed.type).toBe('hello');
      expect(parsed.width).toBe(1280);
      expect(parsed.height).toBe(800);
      expect(typeof parsed.sessionId).toBe('string');
    } finally {
      client.close();
    }
  });

  it('resolves false and logs on failed port bind without crashing', async () => {
    const blocker: Server = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const blockedPort = (blocker.address() as { port: number }).port;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const server = new HeadlessRemoteServer();
      track(server);
      const fake = makeFakeWin({ bitmap: Buffer.from('x'), captureCount: 0 });
      const started = await server.start(fake.win, baseConfig({ port: blockedPort }));
      expect(started).toBe(false);
      expect(server.isRunning).toBe(false);
    } finally {
      errorSpy.mockRestore();
      await new Promise<void>((resolve) =>
        blocker.close(() => {
          resolve();
        }),
      );
    }
  });

  it('pauses captures with zero clients and skips unchanged frames', async () => {
    const state: FakeState = { bitmap: Buffer.from('AAAA'), captureCount: 0 };
    const fake = makeFakeWin(state);
    const server = new HeadlessRemoteServer();
    track(server);
    await server.start(fake.win, baseConfig(), { captureIntervalMs: 10 });

    await sleepMs(40);
    expect(state.captureCount).toBe(0);

    const client = await connectWs(server.getPort()!);
    const firstFrame = await client.waitForBinary();
    expect(firstFrame.toString()).toBe('jpeg-q70');
    const capturesAfterFirst = state.captureCount;
    await sleepMs(80);
    // More captures happened, but the unchanged bitmap produced no further frames.
    expect(state.captureCount).toBeGreaterThan(capturesAfterFirst);
    expect(client.binaryFrameCount()).toBe(1);
    client.close();
  });

  it('drives input into the window webContents and uses insertText for char', async () => {
    const state: FakeState = { bitmap: Buffer.from('b'), captureCount: 0 };
    const fake = makeFakeWin(state);
    const server = new HeadlessRemoteServer();
    track(server);
    await server.start(fake.win, baseConfig());
    const client = await connectWs(server.getPort()!);
    try {
      client.ws.send(JSON.stringify({ type: 'mousemove', x: 100, y: 50, buttons: 0 }));
      client.ws.send(JSON.stringify({ type: 'mousedown', x: 100, y: 50, button: 'left' }));
      client.ws.send(JSON.stringify({ type: 'mouseup', x: 100, y: 50, button: 'left' }));
      client.ws.send(
        JSON.stringify({ type: 'keydown', key: 'a', code: 'KeyA', modifiers: ['ctrl'] }),
      );
      client.ws.send(JSON.stringify({ type: 'char', char: '✓' }));
      client.ws.send(JSON.stringify({ type: 'bogus', nope: true }));
      client.ws.send('not json');
      await sleepMs(120);
      // char → insertText (not sendInputEvent), bogus + non-JSON dropped.
      expect(fake.sendInputEvents).toHaveLength(4);
      expect(fake.insertTexts).toEqual(['✓']);
      expect(fake.sendInputEvents[0]).toEqual({ type: 'mouseMove', x: 100, y: 50 });
      expect(fake.sendInputEvents[3]).toEqual({
        type: 'keyDown',
        keyCode: 'a',
        modifiers: ['control'],
      });
    } finally {
      client.close();
    }
  });

  it('refocuses an unfocused window before injecting input', async () => {
    const state: FakeState = { bitmap: Buffer.from('b'), captureCount: 0 };
    const fake = makeFakeWin(state);
    const win = fake.win;
    let focusCalls = 0;
    let focused = false;
    const originalFocus = win.focus;
    const originalIsFocused = win.isFocused;
    win.isFocused = () => focused;
    win.focus = () => {
      focusCalls += 1;
      focused = true;
    };
    const server = new HeadlessRemoteServer();
    track(server);
    await server.start(win, baseConfig());
    const client = await connectWs(server.getPort()!);
    try {
      client.ws.send(JSON.stringify({ type: 'mousedown', x: 10, y: 10, button: 'left' }));
      await sleepMs(80);
      expect(focusCalls).toBe(1);
      expect(focused).toBe(true);
    } finally {
      win.focus = originalFocus;
      win.isFocused = originalIsFocused;
      client.close();
    }
  });

  it('rejects a token-protected page fetch and WS upgrade without a token', async () => {
    const server = new HeadlessRemoteServer();
    track(server);
    const state: FakeState = { bitmap: Buffer.from('b'), captureCount: 0 };
    await server.start(makeFakeWin(state).win, baseConfig({ token: 'sekrit' }));
    const port = server.getPort()!;

    const unauthorized = await fetch(`http://127.0.0.1:${port}/`);
    expect(unauthorized.status).toBe(401);

    const withToken = await fetch(`http://127.0.0.1:${port}/?token=sekrit`);
    expect(withToken.status).toBe(200);
    expect(withToken.headers.get('set-cookie')).toContain('mesh-remote-token=sekrit');

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(health.status).toBe(200);
    expect((await health.json()) as { ok: boolean }).toEqual(expect.objectContaining({ ok: true }));

    const deniedStatus: number = await withTimeout(
      new Promise<number>((resolve, reject) => {
        const denied = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        denied.on('unexpected-response', (_req, res) => {
          resolve(res.statusCode ?? 0);
        });
        denied.on('open', () => {
          denied.close();
          reject(new Error('should not upgrade without a token'));
        });
        denied.on('error', () => {
          reject(new Error('denied upgrade should surface as unexpected-response'));
        });
      }),
      5000,
      'denied upgrade',
    );
    expect(deniedStatus).toBe(401);

    const allowed = await connectWs(port, { token: 'sekrit' });
    expect((JSON.parse(await allowed.waitForString()) as { type: string }).type).toBe('hello');
    allowed.close();

    const cookieAllowed = await connectWs(port, { cookie: 'mesh-remote-token=sekrit' });
    expect((JSON.parse(await cookieAllowed.waitForString()) as { type: string }).type).toBe(
      'hello',
    );
    cookieAllowed.close();
  });

  it('refuses non-loopback binds without a token', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const server = new HeadlessRemoteServer();
      track(server);
      const fake = makeFakeWin({ bitmap: Buffer.from('x'), captureCount: 0 });
      const started = await server.start(fake.win, baseConfig({ host: '0.0.0.0', token: '' }));
      expect(started).toBe(false);
      expect(server.isRunning).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('ignores a second overlapping start', async () => {
    const fake = makeFakeWin({ bitmap: Buffer.from('x'), captureCount: 0 });
    const server = new HeadlessRemoteServer();
    track(server);
    const first = server.start(fake.win, baseConfig());
    const second = server.start(fake.win, baseConfig());
    expect(await first).toBe(true);
    expect(await second).toBe(false);
    expect(server.isRunning).toBe(true);
  });

  it('accepts cookie-only HTTP auth and special-character token round-trips', async () => {
    const token = 'a=b%20c;d';
    const server = new HeadlessRemoteServer();
    track(server);
    await server.start(
      makeFakeWin({ bitmap: Buffer.from('b'), captureCount: 0 }).win,
      baseConfig({ token }),
    );
    const port = server.getPort()!;

    const withQuery = await fetch(`http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`);
    expect(withQuery.status).toBe(200);
    const setCookie = withQuery.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('mesh-remote-token=');

    const cookieOnly = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { Cookie: `mesh-remote-token=${encodeURIComponent(token)}` },
    });
    expect(cookieOnly.status).toBe(200);
    expect(cookieOnly.headers.get('set-cookie')).toBeNull();

    const wrong = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { Cookie: 'mesh-remote-token=wrong-token' },
    });
    expect(wrong.status).toBe(401);

    const sameLen = await fetch(`http://127.0.0.1:${port}/?token=sekrit!!`);
    expect(sameLen.status).toBe(401);
  });

  it('rate-limits repeated unauthorized upgrades from the same peer', async () => {
    const server = new HeadlessRemoteServer();
    track(server);
    await server.start(
      makeFakeWin({ bitmap: Buffer.from('b'), captureCount: 0 }).win,
      baseConfig({ token: 'sekrit' }),
    );
    const port = server.getPort()!;

    const attempt = (): Promise<number | 'destroy'> =>
      withTimeout(
        new Promise<number | 'destroy'>((resolve) => {
          const denied = new WebSocket(`ws://127.0.0.1:${port}/ws`);
          denied.on('unexpected-response', (_req, res) => {
            resolve(res.statusCode ?? 0);
          });
          denied.on('close', () => {
            resolve('destroy');
          });
          denied.on('error', () => {
            resolve('destroy');
          });
          denied.on('open', () => {
            denied.close();
            resolve(0);
          });
        }),
        5000,
        'rate-limit upgrade',
      );

    for (let i = 0; i < 5; i += 1) {
      expect(await attempt()).toBe(401);
    }
    // 6th failure within the window is silently destroyed (no 401 body).
    expect(await attempt()).toBe('destroy');
  });

  it('stops with connected clients and reports destroyed webContents as not loaded', async () => {
    const fake = makeFakeWin({ bitmap: Buffer.from('b'), captureCount: 0 });
    let destroyed = false;
    fake.win.webContents.isDestroyed = () => destroyed;
    fake.win.webContents.isLoading = () => true;
    const server = new HeadlessRemoteServer();
    track(server);
    await server.start(fake.win, baseConfig());
    const port = server.getPort()!;
    const client = await connectWs(port);
    await client.waitForString();

    const loadingHealth = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as {
      rendererLoaded: boolean;
    };
    expect(loadingHealth.rendererLoaded).toBe(false);

    destroyed = true;
    const destroyedHealth = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as {
      rendererLoaded: boolean;
      ok: boolean;
    };
    expect(destroyedHealth.rendererLoaded).toBe(false);
    expect(destroyedHealth.ok).toBe(true);

    await server.stop();
    expect(server.isRunning).toBe(false);
    expect(server.getPort()).toBeNull();
    client.close();
  });

  it('only the first connected client may inject input', async () => {
    const fake = makeFakeWin({ bitmap: Buffer.from('b'), captureCount: 0 });
    const server = new HeadlessRemoteServer();
    track(server);
    await server.start(fake.win, baseConfig());
    const port = server.getPort()!;
    const controller = await connectWs(port);
    const viewer = await connectWs(port);
    try {
      await controller.waitForString();
      await viewer.waitForString();
      viewer.ws.send(JSON.stringify({ type: 'mousedown', x: 1, y: 1, button: 'left' }));
      await sleepMs(80);
      expect(fake.sendInputEvents).toHaveLength(0);
      controller.ws.send(JSON.stringify({ type: 'mousedown', x: 2, y: 3, button: 'left' }));
      await sleepMs(80);
      expect(fake.sendInputEvents).toHaveLength(1);
    } finally {
      controller.close();
      viewer.close();
    }
  });
});

describe('remote-server source hygiene', () => {
  it('never logs the token and only uses console debug/warn/error (source contract)', () => {
    const source = readFileSync(join(__dirname, 'remote-server.ts'), 'utf-8');
    expect(source).not.toMatch(/console\.log\s*\(/);
    // Token must never be interpolated into a log line.
    expect(source).not.toMatch(/console\.(debug|warn|error)\([^)]*token/i);
    // User-controlled input frames are only ever logged after sanitizeLogMessage.
    expect(source).toMatch(/sanitizeLogMessage/);
  });
});
