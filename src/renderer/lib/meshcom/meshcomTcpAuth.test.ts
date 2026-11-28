import { describe, expect, it, vi } from 'vitest';

import { meshcomAuthHmacHex } from './meshcomHmacAuth';
import { runMeshcomTcpAuth } from './meshcomTcpAuth';

describe('runMeshcomTcpAuth', () => {
  it('treats silence as no-auth', async () => {
    const result = await runMeshcomTcpAuth(
      {
        write: vi.fn(),
        onData: () => () => {},
      },
      'secret',
      20,
    );
    expect(result).toEqual({ status: 'none' });
  });

  it('accepts immediate OK and returns empty leftover', async () => {
    const result = await runMeshcomTcpAuth(
      {
        write: vi.fn(),
        onData: (handler) => {
          queueMicrotask(() => {
            handler(new TextEncoder().encode('OK\n'));
          });
          return () => {};
        },
      },
      '',
      500,
    );
    expect(result).toEqual({ status: 'ok', leftover: new Uint8Array(0) });
  });

  it('preserves an oversized KISS tail after OK', async () => {
    const kiss = 'K'.repeat(200);
    const result = await runMeshcomTcpAuth(
      {
        write: vi.fn(),
        onData: (handler) => {
          queueMicrotask(() => {
            handler(new TextEncoder().encode(`OK\n${kiss}`));
          });
          return () => {};
        },
      },
      '',
      500,
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(new TextDecoder().decode(result.leftover)).toBe(kiss);
  });

  it('preserves raw bytes after the OK line', async () => {
    const result = await runMeshcomTcpAuth(
      {
        write: vi.fn(),
        onData: (handler) => {
          queueMicrotask(() => {
            handler(new TextEncoder().encode('OK\n{"type":"msg"}\npartial'));
          });
          return () => {};
        },
      },
      '',
      500,
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(new TextDecoder().decode(result.leftover)).toBe('{"type":"msg"}\npartial');
  });

  it('completes HMAC challenge', async () => {
    const nonce = '3e62d1be9d352ffcbd2edcc5cfa07b36';
    const password = 'random-secret';
    const expected = await meshcomAuthHmacHex(password, nonce);
    const write = vi.fn().mockResolvedValue(undefined);
    let onChunk: ((b: Uint8Array) => void) | undefined;
    const resultPromise = runMeshcomTcpAuth(
      {
        write,
        onData: (h) => {
          onChunk = h;
          return () => {
            onChunk = undefined;
          };
        },
      },
      password,
      2000,
    );
    await Promise.resolve();
    onChunk?.(new TextEncoder().encode(`NONCE: ${nonce}\n`));
    await vi.waitFor(() => {
      expect(write).toHaveBeenCalled();
    });
    const sent = new TextDecoder().decode(write.mock.calls[0][0] as Uint8Array);
    expect(sent.trim()).toBe(expected);
    onChunk?.(new TextEncoder().encode('OK\n'));
    await expect(resultPromise).resolves.toEqual({ status: 'ok', leftover: new Uint8Array(0) });
  });

  it('rejects when a NONCE arrives but OK times out', async () => {
    let onChunk: ((b: Uint8Array) => void) | undefined;
    const resultPromise = runMeshcomTcpAuth(
      {
        write: vi.fn().mockResolvedValue(undefined),
        onData: (h) => {
          onChunk = h;
          return () => {};
        },
      },
      'secret',
      40,
    );
    await Promise.resolve();
    onChunk?.(new TextEncoder().encode('NONCE: 3e62d1be9d352ffcbd2edcc5cfa07b36\n'));
    await expect(resultPromise).resolves.toMatchObject({ status: 'rejected' });
  });

  it('rejects on abort signal (disconnect mid-auth)', async () => {
    const ac = new AbortController();
    const resultPromise = runMeshcomTcpAuth(
      {
        write: vi.fn(),
        onData: () => () => {},
      },
      'secret',
      { timeoutMs: 2000, signal: ac.signal },
    );
    queueMicrotask(() => {
      ac.abort();
    });
    await expect(resultPromise).resolves.toMatchObject({ status: 'rejected' });
  });

  it('rejects nonce without password', async () => {
    let onChunk: ((b: Uint8Array) => void) | undefined;
    const resultPromise = runMeshcomTcpAuth(
      {
        write: vi.fn(),
        onData: (h) => {
          onChunk = h;
          return () => {};
        },
      },
      '',
      2000,
    );
    await Promise.resolve();
    onChunk?.(new TextEncoder().encode('NONCE: 3e62d1be9d352ffcbd2edcc5cfa07b36\n'));
    await expect(resultPromise).resolves.toMatchObject({ status: 'rejected' });
  });
});
