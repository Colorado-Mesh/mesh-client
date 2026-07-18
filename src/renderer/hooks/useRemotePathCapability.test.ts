import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PathCapability } from '@/shared/remote-types';

import { useRemotePathCapability } from './useRemotePathCapability';

describe('useRemotePathCapability', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(window.electronAPI.reticulum.remote.pathCapability).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears capability when the hash is invalid', () => {
    const { result } = renderHook(() => useRemotePathCapability('nope'));
    expect(result.current.capability).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(window.electronAPI.reticulum.remote.pathCapability).not.toHaveBeenCalled();
  });

  it('ignores a stale response after the destination changes', async () => {
    const hashA = 'aa'.repeat(16);
    const hashB = 'bb'.repeat(16);
    let resolveA: (v: PathCapability) => void = () => {};
    vi.mocked(window.electronAPI.reticulum.remote.pathCapability).mockImplementation(
      (opts: { destination_hash: string }) => {
        if (opts.destination_hash === hashA) {
          return new Promise<PathCapability>((resolve) => {
            resolveA = resolve;
          });
        }
        return Promise.resolve({
          destination_hash: hashB,
          hops: 1,
          speed: 'high',
          via_atoms: ['tcp'],
          transfer_allowed: true,
          shell_allowed: true,
        });
      },
    );

    const { result, rerender } = renderHook(
      ({ hash }: { hash: string | null }) => useRemotePathCapability(hash),
      { initialProps: { hash: hashA } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(result.current.loading).toBe(true);

    rerender({ hash: hashB });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(result.current.capability?.destination_hash).toBe(hashB);

    await act(async () => {
      resolveA({
        destination_hash: hashA,
        hops: 9,
        speed: 'constrained',
        via_atoms: ['rf'],
        transfer_allowed: false,
        shell_allowed: true,
        reason_key: 'path_constrained',
      });
      await Promise.resolve();
    });
    expect(result.current.capability?.destination_hash).toBe(hashB);
  });
});
