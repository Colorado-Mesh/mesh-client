import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearMeshcoreRepeaterRouteEscalationStateForTests,
  isMeshcoreRepeaterTimeoutError,
  withMeshcoreRepeaterRouteEscalation,
} from './meshcoreRepeaterRouteEscalation';

describe('meshcoreRepeaterRouteEscalation', () => {
  afterEach(() => {
    clearMeshcoreRepeaterRouteEscalationStateForTests();
  });

  it('detects timeout errors', () => {
    expect(isMeshcoreRepeaterTimeoutError(new Error('timeout'))).toBe(true);
    expect(isMeshcoreRepeaterTimeoutError(new Error('Request timed out'))).toBe(true);
    expect(isMeshcoreRepeaterTimeoutError(new Error('radio rejected'))).toBe(false);
  });

  it('resets path and retries once on timeout for a direct route', async () => {
    const resetContactPath = vi.fn(() => Promise.resolve(true));
    let calls = 0;
    const result = await withMeshcoreRepeaterRouteEscalation(
      7,
      {
        resetContactPath,
        resolveRouteKind: () => 'direct',
        nowMs: () => 1_000,
      },
      ({ escalated }) => {
        calls += 1;
        if (!escalated) return Promise.reject(new Error('timeout'));
        return Promise.resolve('ok');
      },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(2);
    expect(resetContactPath).toHaveBeenCalledTimes(1);
  });

  it('does not escalate on non-timeout errors', async () => {
    const resetContactPath = vi.fn(() => Promise.resolve(true));
    await expect(
      withMeshcoreRepeaterRouteEscalation(
        8,
        {
          resetContactPath,
          resolveRouteKind: () => 'direct',
        },
        () => Promise.reject(new Error('radio rejected request')),
      ),
    ).rejects.toThrow(/radio rejected/);
    expect(resetContactPath).not.toHaveBeenCalled();
  });

  it('does not escalate when route is already flood', async () => {
    const resetContactPath = vi.fn(() => Promise.resolve(true));
    await expect(
      withMeshcoreRepeaterRouteEscalation(
        9,
        {
          resetContactPath,
          resolveRouteKind: () => 'flood',
        },
        () => Promise.reject(new Error('timeout')),
      ),
    ).rejects.toThrow(/timeout/);
    expect(resetContactPath).not.toHaveBeenCalled();
  });

  it('honors per-node cooldown', async () => {
    const resetContactPath = vi.fn(() => Promise.resolve(true));
    let now = 1_000;
    await withMeshcoreRepeaterRouteEscalation(
      10,
      {
        resetContactPath,
        resolveRouteKind: () => 'direct',
        nowMs: () => now,
        cooldownMs: 30_000,
      },
      ({ escalated }) => {
        if (!escalated) return Promise.reject(new Error('timeout'));
        return Promise.resolve('first');
      },
    );
    now = 1_000 + 5_000;
    await expect(
      withMeshcoreRepeaterRouteEscalation(
        10,
        {
          resetContactPath,
          resolveRouteKind: () => 'direct',
          nowMs: () => now,
          cooldownMs: 30_000,
        },
        () => Promise.reject(new Error('timeout')),
      ),
    ).rejects.toThrow(/timeout/);
    expect(resetContactPath).toHaveBeenCalledTimes(1);
  });
});
