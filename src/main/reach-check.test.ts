// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it, vi } from 'vitest';

import {
  createReachCheckClient,
  defaultReachCheckTransport,
  isLocalReachCheckAllowed,
  ReachCheckNotPublicError,
  type ReachCheckTransport,
} from './reach-check';

const NOW = 1_800_000_000_000;
const ORIGIN = 'https://rangecheck.example.org';
const SESSION_ID = '0b9f3a52-6f3e-4c2c-9a59-7f1c2b9e0d11';

function sessionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SESSION_ID,
    code: 'MHC-1A2B3C',
    createdAt: NOW,
    expiresAt: NOW + 600_000,
    status: 'waiting',
    observedCount: 7,
    expectedCount: 10,
    repeaterCount: 3,
    longestPacketDistanceText: '84.2 mi',
    sharePath: `/share/${SESSION_ID}`,
    shareUrl: 'https://elsewhere.example.net/share/x',
    ...overrides,
  };
}

function bootstrapBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    site: { version: '1.3.8' },
    testChannel: { name: 'cm-reach', hash: 'd6', configured: true },
    turnstile: { enabled: false, siteKey: '', verified: true },
    ...overrides,
  };
}

function client(
  answer: Awaited<ReturnType<ReachCheckTransport>> | Error,
  allowLocal = false,
): { api: ReturnType<typeof createReachCheckClient>; request: ReturnType<typeof vi.fn> } {
  const request = vi.fn<ReachCheckTransport>(() =>
    answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer),
  );
  return { api: createReachCheckClient({ request, allowLocal, now: () => NOW }), request };
}

function ok(json: unknown, status = 200): Awaited<ReturnType<ReachCheckTransport>> {
  return { status, headers: {}, json };
}

describe('isLocalReachCheckAllowed', () => {
  it('is true only in an unpackaged build with the variable set to 1', () => {
    expect(isLocalReachCheckAllowed({ MESH_CLIENT_REACH_CHECK_LOCAL: '1' }, false)).toBe(true);
    expect(isLocalReachCheckAllowed({ MESH_CLIENT_REACH_CHECK_LOCAL: '1' }, true)).toBe(false);
    expect(isLocalReachCheckAllowed({ MESH_CLIENT_REACH_CHECK_LOCAL: 'true' }, false)).toBe(false);
    expect(isLocalReachCheckAllowed({}, false)).toBe(false);
  });
});

describe('bootstrap', () => {
  it('maps the test channel, Turnstile state and version', async () => {
    const { api, request } = client(ok(bootstrapBody()));
    await expect(api.bootstrap(`${ORIGIN}/app`)).resolves.toEqual({
      ok: true,
      value: {
        origin: ORIGIN,
        channelName: 'cm-reach',
        channelHash: 'd6',
        turnstileRequired: false,
        version: '1.3.8',
      },
    });
    const [url, init] = request.mock.calls[0] as [URL, { method: string }];
    expect(url.href).toBe(`${ORIGIN}/api/bootstrap`);
    expect(init.method).toBe('GET');
  });

  it('reports Turnstile as required when enabled and not verified', async () => {
    const { api } = client(
      ok(bootstrapBody({ turnstile: { enabled: true, siteKey: 'k', verified: false } })),
    );
    const result = await api.bootstrap(ORIGIN);
    expect(result.ok && result.value.turnstileRequired).toBe(true);
  });

  it.each([
    [{ name: 'cm-reach', hash: null, configured: false }],
    [{ name: 'cm-reach', hash: '', configured: true }],
    [{ name: 'cm-reach', configured: false }],
  ])('is not_configured when the server has no channel hash (%o)', async (testChannel) => {
    const { api } = client(ok(bootstrapBody({ testChannel })));
    await expect(api.bootstrap(ORIGIN)).resolves.toEqual({ ok: false, error: 'not_configured' });
  });

  it.each([
    ['a 40-character name', { name: 'a'.repeat(40), hash: 'd6', configured: true }],
    ['a name with a hash sign', { name: '#cm-reach', hash: 'd6', configured: true }],
    ['a name with a space', { name: 'cm reach', hash: 'd6', configured: true }],
    ['a three-digit hash', { name: 'cm-reach', hash: 'd6a', configured: true }],
    ['a non-hex hash', { name: 'cm-reach', hash: 'zz', configured: true }],
  ])('refuses %s as invalid_response', async (_label, testChannel) => {
    const { api } = client(ok(bootstrapBody({ testChannel })));
    await expect(api.bootstrap(ORIGIN)).resolves.toEqual({ ok: false, error: 'invalid_response' });
  });

  it('caps the version text and drops control characters', async () => {
    const { api } = client(
      ok(bootstrapBody({ site: { version: `1.4.2${String.fromCharCode(7)}${'x'.repeat(60)}` } })),
    );
    const result = await api.bootstrap(ORIGIN);
    expect(result.ok && result.value.version).toBe(`1.4.2${'x'.repeat(27)}`);
  });

  it('is invalid_response when the body is not an object', async () => {
    const { api } = client(ok('hello'));
    await expect(api.bootstrap(ORIGIN)).resolves.toEqual({ ok: false, error: 'invalid_response' });
  });

  it('refuses a bad address without making a request', async () => {
    const { api, request } = client(ok(bootstrapBody()));
    await expect(api.bootstrap('http://rangecheck.example.org')).resolves.toEqual({
      ok: false,
      error: 'invalid_url',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('maps a transport failure to network and a private DNS answer to not_public', async () => {
    await expect(client(new Error('socket hang up')).api.bootstrap(ORIGIN)).resolves.toEqual({
      ok: false,
      error: 'network',
    });
    await expect(
      client(new ReachCheckNotPublicError('private')).api.bootstrap(ORIGIN),
    ).resolves.toEqual({ ok: false, error: 'not_public' });
  });

  it('maps any other status to http_error with the status', async () => {
    const { api } = client(ok({ error: 'oops' }, 502));
    await expect(api.bootstrap(ORIGIN)).resolves.toEqual({
      ok: false,
      error: 'http_error',
      httpStatus: 502,
    });
  });
});

describe('createSession', () => {
  it('posts an empty JSON object and maps a 201 session', async () => {
    const { api, request } = client(ok(sessionBody(), 201));
    await expect(api.createSession(ORIGIN)).resolves.toEqual({
      ok: true,
      value: {
        id: SESSION_ID,
        code: 'MHC-1A2B3C',
        status: 'waiting',
        expiresAt: NOW + 600_000,
        observedCount: 7,
        expectedCount: 10,
        repeaterCount: 3,
        distanceText: '84.2 mi',
        sharePath: `/share/${SESSION_ID}`,
      },
    });
    const [url, init] = request.mock.calls[0] as [URL, { method: string; body?: string }];
    expect(url.href).toBe(`${ORIGIN}/api/sessions`);
    expect(init).toEqual({ method: 'POST', body: '{}' });
  });

  it('maps 403 turnstile_required', async () => {
    const { api } = client(ok({ error: 'turnstile_required' }, 403));
    await expect(api.createSession(ORIGIN)).resolves.toEqual({
      ok: false,
      error: 'turnstile_required',
    });
  });

  it('maps 429 with Retry-After seconds', async () => {
    const { api } = client({
      status: 429,
      headers: { 'retry-after': '120' },
      json: { error: 'rate_limited', retryAfter: 120 },
    });
    await expect(api.createSession(ORIGIN)).resolves.toEqual({
      ok: false,
      error: 'rate_limited',
      retryAfterSeconds: 120,
    });
  });

  it('falls back to the body retryAfter and clamps it to a day', async () => {
    const { api } = client(ok({ error: 'rate_limited', retryAfter: 999_999 }, 429));
    await expect(api.createSession(ORIGIN)).resolves.toEqual({
      ok: false,
      error: 'rate_limited',
      retryAfterSeconds: 86_400,
    });
  });

  it('maps the geographic scope 400 to no_observers', async () => {
    const { api } = client(ok({ error: 'no_observers_in_geographic_scope' }, 400));
    await expect(api.createSession(ORIGIN)).resolves.toEqual({ ok: false, error: 'no_observers' });
  });

  it.each([
    ['a code with a newline', { code: 'MHC-1A2B3C\nhi' }],
    ['a code with a space', { code: 'MHC 1A2B3C' }],
    ['a lowercase code', { code: 'mhc-1a2b3c' }],
    ['a code with a 9-character prefix', { code: 'ABCDEFGHI-1A2B3C' }],
    ['a code with 17 hex digits', { code: `MHC-${'A'.repeat(17)}` }],
    ['a share path to another host', { sharePath: '//evil.example/share/x' }],
    ['a share path elsewhere on the server', { sharePath: '/api/sessions' }],
    ['a missing share path', { sharePath: undefined }],
    ['a session id with a slash', { id: '../x' }],
    ['a missing expiry', { expiresAt: undefined }],
  ])('refuses %s as invalid_response', async (_label, overrides) => {
    const { api } = client(ok(sessionBody(overrides), 201));
    await expect(api.createSession(ORIGIN)).resolves.toEqual({
      ok: false,
      error: 'invalid_response',
    });
  });

  it('accepts a configured prefix and a 16-digit code', async () => {
    const { api } = client(ok(sessionBody({ code: 'CMR8-0123456789ABCDEF' }), 201));
    const result = await api.createSession(ORIGIN);
    expect(result.ok && result.value.code).toBe('CMR8-0123456789ABCDEF');
  });

  it('clamps counts, caps the expiry, cleans the distance text and treats an unknown status as expired', async () => {
    const { api } = client(
      ok(
        sessionBody({
          status: 'odd',
          observedCount: 1e9,
          expectedCount: -4,
          repeaterCount: 2.7,
          expiresAt: NOW + 3_600_000,
          longestPacketDistanceText: `84 mi${String.fromCharCode(0)}${'y'.repeat(50)}`,
        }),
        201,
      ),
    );
    const result = await api.createSession(ORIGIN);
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        status: 'expired',
        observedCount: 999,
        expectedCount: 0,
        repeaterCount: 2,
        expiresAt: NOW + 1_800_000,
        distanceText: `84 mi${'y'.repeat(27)}`,
      }),
    });
  });

  it('reads counts that are missing or not numbers as zero', async () => {
    const { api } = client(
      ok(sessionBody({ observedCount: 'seven', expectedCount: undefined }), 201),
    );
    const result = await api.createSession(ORIGIN);
    expect(result.ok && [result.value.observedCount, result.value.expectedCount]).toEqual([0, 0]);
  });
});

describe('getSession', () => {
  it('gets the session by id', async () => {
    const { api, request } = client(ok(sessionBody({ status: 'active' })));
    const result = await api.getSession(ORIGIN, SESSION_ID);
    expect(result.ok && result.value.status).toBe('active');
    const [url, init] = request.mock.calls[0] as [URL, { method: string }];
    expect(url.href).toBe(`${ORIGIN}/api/sessions/${SESSION_ID}`);
    expect(init.method).toBe('GET');
  });

  it('maps 404 to session_not_found', async () => {
    const { api } = client(ok({ error: 'session_not_found' }, 404));
    await expect(api.getSession(ORIGIN, SESSION_ID)).resolves.toEqual({
      ok: false,
      error: 'session_not_found',
    });
  });

  it('refuses a malformed id without making a request', async () => {
    const { api, request } = client(ok(sessionBody()));
    await expect(api.getSession(ORIGIN, '../../api/bootstrap')).resolves.toEqual({
      ok: false,
      error: 'invalid_response',
    });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('defaultReachCheckTransport over a real local http server', () => {
  async function withServer(
    handler: http.RequestListener,
    run: (base: string) => Promise<void>,
  ): Promise<void> {
    const server = http.createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await run(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  }

  it('reads the status, lower-case headers and JSON body, and sends the POST body', async () => {
    let received = '';
    await withServer(
      (req, res) => {
        req.on('data', (chunk: Buffer) => (received += chunk.toString('utf8')));
        req.on('end', () => {
          res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '30' });
          res.end(JSON.stringify({ error: 'rate_limited' }));
        });
      },
      async (base) => {
        const answer = await defaultReachCheckTransport(new URL('/api/sessions', base), {
          method: 'POST',
          body: '{}',
        });
        expect(answer.status).toBe(429);
        expect(answer.headers['retry-after']).toBe('30');
        expect(answer.json).toEqual({ error: 'rate_limited' });
      },
    );
    expect(received).toBe('{}');
  });

  it('returns json undefined for a body that is not JSON', async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html>login</html>');
      },
      async (base) => {
        const answer = await defaultReachCheckTransport(new URL('/api/bootstrap', base), {
          method: 'GET',
        });
        expect(answer).toEqual(expect.objectContaining({ status: 200, json: undefined }));
      },
    );
  });

  it('rejects an answer over 256 KiB', async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ pad: 'x'.repeat(300 * 1024) }));
      },
      async (base) => {
        await expect(
          defaultReachCheckTransport(new URL('/api/bootstrap', base), { method: 'GET' }),
        ).rejects.toThrow();
      },
    );
  });

  it('does not follow a redirect', async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(302, { Location: 'http://10.0.0.5/api/bootstrap' });
        res.end();
      },
      async (base) => {
        const answer = await defaultReachCheckTransport(new URL('/api/bootstrap', base), {
          method: 'GET',
        });
        expect(answer.status).toBe(302);
      },
    );
  });
});

describe('local servers', () => {
  it('uses a local http server only when allowed', async () => {
    const allowed = client(ok(bootstrapBody()), true);
    const result = await allowed.api.bootstrap('http://127.0.0.1:3090');
    expect(result.ok && result.value.origin).toBe('http://127.0.0.1:3090');
    const refused = client(ok(bootstrapBody()), false);
    await expect(refused.api.bootstrap('http://127.0.0.1:3090')).resolves.toEqual({
      ok: false,
      error: 'invalid_url',
    });
    expect(refused.request).not.toHaveBeenCalled();
  });
});
