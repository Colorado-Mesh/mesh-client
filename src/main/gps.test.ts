// @vitest-environment node
import { EventEmitter } from 'events';
import type { IncomingMessage } from 'http';
import https from 'https';
import si from 'systeminformation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getGpsFix, GpsHardwareError } from './gps';

// gps.ts uses `import https from 'https'` (default import) and `import si from 'systeminformation'`
// Mocks must export a `default` to satisfy default imports.
vi.mock('systeminformation', () => ({
  default: {
    wifiNetworks: vi.fn(),
    inetChecksite: vi.fn(),
  },
}));
vi.mock('https', () => ({
  default: { request: vi.fn() },
}));
vi.mock('http', () => ({
  default: { request: vi.fn() },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupHttpsSuccess(body: string): void {
  vi.mocked(https.request).mockImplementation(
    (_url: unknown, _opts: unknown, cb?: (res: IncomingMessage) => void) => {
      const response = new EventEmitter() as IncomingMessage;
      const req = new EventEmitter() as ReturnType<typeof https.request>;
      (req as unknown as { end(): void }).end = function () {
        if (cb) {
          process.nextTick(() => {
            cb(response);
            process.nextTick(() => {
              response.emit('data', Buffer.from(body));
              process.nextTick(() => response.emit('end'));
            });
          });
        }
      };
      (req as unknown as { destroy(): void }).destroy = vi.fn();
      return req;
    },
  );
}

function setupHttpsError(error: Error): void {
  vi.mocked(https.request).mockImplementation(() => {
    const req = new EventEmitter() as ReturnType<typeof https.request>;
    (req as unknown as { end(): void }).end = function () {
      process.nextTick(() => req.emit('error', error));
    };
    (req as unknown as { destroy(): void }).destroy = vi.fn();
    return req;
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GpsHardwareError', () => {
  it('has code NO_FIX and correct name', () => {
    const err = new GpsHardwareError('test message');
    expect(err.message).toBe('test message');
    expect(err.code).toBe('NO_FIX');
    expect(err.name).toBe('GpsHardwareError');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('getGpsFix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(si.wifiNetworks).mockResolvedValue([]);
    vi.mocked(si.inetChecksite).mockResolvedValue({
      url: 'https://ipwho.is',
      ok: true,
      status: 200,
      ms: 10,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns GpsFix with lat/lon when IP geolocation succeeds', async () => {
    setupHttpsSuccess(JSON.stringify({ success: true, latitude: 37.77, longitude: -122.41 }));
    const result = await getGpsFix();
    expect(result).toMatchObject({ lat: 37.77, lon: -122.41, source: 'ip' });
  });

  it('returns GpsFixError when IP geolocation returns success:false', async () => {
    setupHttpsSuccess(JSON.stringify({ success: false }));
    const result = await getGpsFix();
    expect(result).toMatchObject({ status: 'error' });
  });

  it('returns GpsFixError when request errors', async () => {
    setupHttpsError(new Error('connection refused'));
    const result = await getGpsFix();
    expect(result).toMatchObject({ status: 'error', code: 'NO_FIX' });
  });

  it('returns GpsFixError when response body is malformed JSON', async () => {
    setupHttpsSuccess('not-json{{{');
    const result = await getGpsFix();
    expect(result).toMatchObject({ status: 'error' });
  });

  it('proceeds to IP check even when wifi scan rejects', async () => {
    vi.mocked(si.wifiNetworks).mockRejectedValue(new Error('no wifi adapter'));
    setupHttpsSuccess(JSON.stringify({ success: true, latitude: 51.5, longitude: -0.12 }));
    const result = await getGpsFix();
    expect(result).toMatchObject({ lat: 51.5, lon: -0.12, source: 'ip' });
  });

  it('returns GpsFixError for coordinates outside valid range', async () => {
    setupHttpsSuccess(JSON.stringify({ success: true, latitude: 999, longitude: -122.41 }));
    const result = await getGpsFix();
    expect(result).toMatchObject({ status: 'error' });
  });
});
