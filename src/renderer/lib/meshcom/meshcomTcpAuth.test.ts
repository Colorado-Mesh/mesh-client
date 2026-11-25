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

  it('accepts immediate OK', async () => {
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
    expect(result).toEqual({ status: 'ok' });
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
    await expect(resultPromise).resolves.toEqual({ status: 'ok' });
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
