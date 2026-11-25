import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearMeshcoreRepeaterRouteEscalationStateForTests,
  isMeshcoreRepeaterTimeoutError,
  meshcoreRepeaterRouteKind,
  type MeshcoreRepeaterRouteMode,
  withMeshcoreRepeaterLoginFallback,
  withMeshcoreRepeaterRouteEscalation,
} from './meshcoreRepeaterRouteEscalation';
import { extractUseCallbackBody, loadRuntimeSource } from './sourceContractTestHelpers';

describe('meshcoreRepeaterRouteEscalation', () => {
  afterEach(() => {
    clearMeshcoreRepeaterRouteEscalationStateForTests();
  });

  it('classifies a stored hash path as direct', () => {
    expect(meshcoreRepeaterRouteKind(new Uint8Array([0xab, 0xcd]), 2)).toBe('direct');
    expect(meshcoreRepeaterRouteKind(new Uint8Array([0xab]), undefined)).toBe('direct');
  });

  it('runtime hands every repeater request the per-repeater route mode and zero-hop write', () => {
    const source = loadRuntimeSource('useMeshcoreRuntime.ts');
    const depsAt = source.indexOf('const meshcoreRepeaterRouteEscalationSharedDeps = useMemo(');
    expect(depsAt).toBeGreaterThan(-1);
    const deps = source.slice(
      depsAt,
      source.indexOf('meshcoreRepeaterRouteEscalationSharedDepsRef.current =', depsAt),
    );
    expect(deps).toContain('routeMode: resolveAdminRouteModeForNode');
    expect(deps).toContain('ensureZeroHopRoute: ensureZeroHopRouteForNode');

    const modeBody = extractUseCallbackBody(source, 'resolveAdminRouteModeForNode');
    expect(modeBody).toContain('getMeshcoreRepeaterRouteMode(bytesToHex(');
    expect(modeBody).toContain("return 'auto'");

    const zeroHopBody = extractUseCallbackBody(source, 'ensureZeroHopRouteForNode');
    const writeAt = zeroHopBody.indexOf('await setMeshcoreRadioContactZeroHop(');
    const cacheAt = zeroHopBody.indexOf('radioContactPathLenByNodeRef.current.set(id, 0)');
    expect(writeAt).toBeGreaterThan(-1);
    // The cache follows the write so the next request skips a radio read it does not need.
    expect(cacheAt).toBeGreaterThan(writeAt);
    expect(zeroHopBody).toContain('outPathMapRef.current.set(id, new Uint8Array(0))');
  });

  it('runtime marks the cached radio length unknown after a successful path reset', () => {
    const body = extractUseCallbackBody(
      loadRuntimeSource('useMeshcoreRuntime.ts'),
      'resetContactPathForEscalation',
    );
    const resetAt = body.indexOf('await conn.resetPath(pubKey)');
    const cacheAt = body.indexOf(
      'radioContactPathLenByNodeRef.current.set(nodeId >>> 0, MESHCORE_OUT_PATH_UNKNOWN_BYTE)',
    );
    expect(resetAt).toBeGreaterThan(-1);
    // Without this the node reads as direct again and every later timeout re-floods.
    expect(cacheAt).toBeGreaterThan(resetAt);
  });

  it('classifies a radio path length of 0 as direct: firmware sends zero-hop direct', () => {
    expect(meshcoreRepeaterRouteKind(undefined, 0)).toBe('direct');
    expect(meshcoreRepeaterRouteKind(new Uint8Array(0), 0)).toBe('direct');
    // Packed length byte: 0 hops with 2-byte hashes.
    expect(meshcoreRepeaterRouteKind(undefined, 0x40)).toBe('direct');
  });

  it('classifies the firmware OUT_PATH_UNKNOWN sentinel as flood', () => {
    expect(meshcoreRepeaterRouteKind(undefined, 0xff)).toBe('flood');
    expect(meshcoreRepeaterRouteKind(undefined, -1)).toBe('flood');
    expect(meshcoreRepeaterRouteKind(new Uint8Array(0), 0xff)).toBe('flood');
  });

  it('classifies a multi-hop radio path length as direct', () => {
    expect(meshcoreRepeaterRouteKind(undefined, 2)).toBe('direct');
  });

  it('classifies a 3-byte-hash path length as direct though meshcore.js reads it negative', () => {
    // Packed length 0x80 is zero hops with 3-byte hashes; readInt8 reports it as -128.
    expect(meshcoreRepeaterRouteKind(undefined, -128)).toBe('direct');
    expect(meshcoreRepeaterRouteKind(undefined, 0x80)).toBe('direct');
    expect(meshcoreRepeaterRouteKind(undefined, -127)).toBe('direct');
  });

  it('reports unknown when neither a path nor a radio length is known', () => {
    expect(meshcoreRepeaterRouteKind(undefined, undefined)).toBe('unknown');
    expect(meshcoreRepeaterRouteKind(new Uint8Array(0), null)).toBe('unknown');
    expect(meshcoreRepeaterRouteKind(undefined, Number.NaN)).toBe('unknown');
  });

  it('runtime keeps radio path lengths across a contacts rebuild', () => {
    const source = loadRuntimeSource('useMeshcoreRuntime.ts');
    // A rebuild used to clear the cache, so a flooding contact read as unknown and a later
    // timeout reset its path and resent for nothing.
    expect(source).toMatch(
      /if \(\s*opts\?\.contactsFromRadio &&[\s\S]{0,160}Number\.isFinite\(contact\.outPathLen\)[\s\S]{0,40}buildPathLens\.set\(node\.node_id, contact\.outPathLen\);/,
    );
    // Staged rebuilds publish their lengths without dropping updates made meanwhile.
    expect(source).toContain(
      'mergeLiveMapChanges(baselinePathLens, radioContactPathLenByNodeRef.current, buildPathLens);',
    );
    expect(source).toContain('radioContactPathLenByNodeRef.current = buildPathLens;');
    expect(source).not.toContain('radioContactPathLenByNodeRef.current.clear();\n        for (');
  });

  it('detects timeout errors', () => {
    expect(isMeshcoreRepeaterTimeoutError(new Error('timeout'))).toBe(true);
    expect(isMeshcoreRepeaterTimeoutError(new Error('Request timed out'))).toBe(true);
    expect(isMeshcoreRepeaterTimeoutError(new Error('radio rejected'))).toBe(false);
    expect(
      isMeshcoreRepeaterTimeoutError(new Error('timeout waiting for sent acknowledgment')),
    ).toBe(false);
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

  it('skips flood retry when the live connection changed after reset', async () => {
    const connection = { id: 'conn-1' };
    const ctx = { identity: 'identity-a', connection };
    let liveConnection: unknown = connection;
    const resetContactPath = vi.fn(() => {
      liveConnection = { id: 'conn-2' };
      return Promise.resolve(true);
    });
    let calls = 0;
    await expect(
      withMeshcoreRepeaterRouteEscalation(
        42,
        {
          resetContactPath,
          resolveRouteKind: () => 'direct',
          captureEscalationContext: () => ctx,
          isEscalationContextCurrent: (c) => c.connection === liveConnection,
          nowMs: () => 2_000,
        },
        () => {
          calls += 1;
          return Promise.reject(new Error('timeout'));
        },
      ),
    ).rejects.toThrow(/timeout/);
    expect(calls).toBe(1);
    expect(resetContactPath).toHaveBeenCalledTimes(1);
  });

  it('still floods when only the identity id changed after reset on the same connection', async () => {
    const connection = { id: 'conn-1' };
    const ctx = { identity: 'identity-pending', connection };
    let liveIdentity = 'identity-pending';
    const resetContactPath = vi.fn(() => {
      liveIdentity = 'identity-final';
      return Promise.resolve(true);
    });
    let calls = 0;
    const result = await withMeshcoreRepeaterRouteEscalation(
      43,
      {
        resetContactPath,
        resolveRouteKind: () => 'direct',
        captureEscalationContext: () => ctx,
        // Mirrors useMeshcoreRuntime: connection-only freshness.
        isEscalationContextCurrent: (c) => c.connection === connection,
        nowMs: () => 2_000,
      },
      ({ escalated }) => {
        calls += 1;
        if (!escalated) return Promise.reject(new Error('timeout'));
        expect(liveIdentity).toBe('identity-final');
        return Promise.resolve('flooded');
      },
    );
    expect(result).toBe('flooded');
    expect(calls).toBe(2);
    expect(resetContactPath).toHaveBeenCalledTimes(1);
  });

  it('isolates cooldown per escalation scope', async () => {
    const resetContactPath = vi.fn(() => Promise.resolve(true));
    const now = 1_000;
    await withMeshcoreRepeaterRouteEscalation(
      10,
      {
        resetContactPath,
        resolveRouteKind: () => 'direct',
        escalationScope: () => 'identity-a',
        nowMs: () => now,
        cooldownMs: 30_000,
      },
      ({ escalated }) => {
        if (!escalated) return Promise.reject(new Error('timeout'));
        return Promise.resolve('first');
      },
    );
    await withMeshcoreRepeaterRouteEscalation(
      10,
      {
        resetContactPath,
        resolveRouteKind: () => 'direct',
        escalationScope: () => 'identity-b',
        nowMs: () => now,
        cooldownMs: 30_000,
      },
      ({ escalated }) => {
        if (!escalated) return Promise.reject(new Error('timeout'));
        return Promise.resolve('second');
      },
    );
    expect(resetContactPath).toHaveBeenCalledTimes(2);
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

  it('does not retry when resetContactPath returns false', async () => {
    const resetContactPath = vi.fn(() => Promise.resolve(false));
    let calls = 0;
    await expect(
      withMeshcoreRepeaterRouteEscalation(
        11,
        {
          resetContactPath,
          resolveRouteKind: () => 'direct',
          nowMs: () => 1_000,
        },
        () => {
          calls += 1;
          return Promise.reject(new Error('timeout'));
        },
      ),
    ).rejects.toThrow(/timeout/);
    expect(calls).toBe(1);
    expect(resetContactPath).toHaveBeenCalledTimes(1);
  });

  it('escalates unknown routes the same as direct', async () => {
    const resetContactPath = vi.fn(() => Promise.resolve(true));
    let calls = 0;
    await expect(
      withMeshcoreRepeaterRouteEscalation(
        12,
        {
          resetContactPath,
          resolveRouteKind: () => 'unknown',
          nowMs: () => 2_000,
        },
        ({ escalated }) => {
          calls += 1;
          if (!escalated) return Promise.reject(new Error('timeout'));
          return Promise.resolve('ok');
        },
      ),
    ).resolves.toBe('ok');
    expect(calls).toBe(2);
  });
});

describe('withMeshcoreRepeaterLoginFallback', () => {
  afterEach(() => {
    clearMeshcoreRepeaterRouteEscalationStateForTests();
  });

  function harness(opts: {
    route: 'direct' | 'flood';
    canLogin: boolean;
    /** Outcome of each request attempt in order; the last entry repeats. */
    requests: ('ok' | 'timeout' | 'rejected')[];
    loginFails?: boolean;
  }) {
    const order: string[] = [];
    let attemptIndex = 0;
    const deps = {
      resetContactPath: vi.fn(() => {
        order.push('reset');
        return Promise.resolve(true);
      }),
      resolveRouteKind: () => opts.route,
      nowMs: () => 1_000,
      canLogin: () => opts.canLogin,
      login: vi.fn(() => {
        order.push('login');
        return opts.loginFails ? Promise.reject(new Error('timeout')) : Promise.resolve();
      }),
    };
    const request = vi.fn(() => {
      order.push('request');
      const outcome = opts.requests[Math.min(attemptIndex, opts.requests.length - 1)];
      attemptIndex += 1;
      if (outcome === 'ok') return Promise.resolve('ok');
      return Promise.reject(new Error(outcome === 'timeout' ? 'timeout' : 'radio rejected'));
    });
    return { deps, request, order };
  }

  it('sends no login when the first request is answered', async () => {
    const { deps, request, order } = harness({ route: 'direct', canLogin: true, requests: ['ok'] });
    await expect(withMeshcoreRepeaterLoginFallback(11, deps, request)).resolves.toBe('ok');
    expect(order).toEqual(['request']);
  });

  it('logs in on the flood retry of a direct route, after the path reset', async () => {
    const { deps, request, order } = harness({
      route: 'direct',
      canLogin: true,
      requests: ['timeout', 'ok'],
    });
    await expect(withMeshcoreRepeaterLoginFallback(12, deps, request)).resolves.toBe('ok');
    expect(order).toEqual(['request', 'reset', 'login', 'request']);
  });

  it('logs in and asks again when an already-flooding route times out', async () => {
    const { deps, request, order } = harness({
      route: 'flood',
      canLogin: true,
      requests: ['timeout', 'ok'],
    });
    await expect(withMeshcoreRepeaterLoginFallback(13, deps, request)).resolves.toBe('ok');
    expect(order).toEqual(['request', 'login', 'request']);
  });

  it('does not log in without a password', async () => {
    const { deps, request, order } = harness({
      route: 'flood',
      canLogin: false,
      requests: ['timeout'],
    });
    await expect(withMeshcoreRepeaterLoginFallback(14, deps, request)).rejects.toThrow(/timeout/);
    expect(order).toEqual(['request']);
  });

  it('does not log in when the radio rejects the request', async () => {
    const { deps, request, order } = harness({
      route: 'direct',
      canLogin: true,
      requests: ['rejected'],
    });
    await expect(withMeshcoreRepeaterLoginFallback(15, deps, request)).rejects.toThrow(
      /radio rejected/,
    );
    expect(order).toEqual(['request']);
  });

  it('logs in at most once per request', async () => {
    const { deps, request, order } = harness({
      route: 'direct',
      canLogin: true,
      requests: ['timeout', 'timeout'],
    });
    await expect(withMeshcoreRepeaterLoginFallback(16, deps, request)).rejects.toThrow(/timeout/);
    expect(order).toEqual(['request', 'reset', 'login', 'request']);
  });

  it('reports a failed login and does not ask again', async () => {
    const { deps, request, order } = harness({
      route: 'flood',
      canLogin: true,
      requests: ['timeout'],
      loginFails: true,
    });
    await expect(withMeshcoreRepeaterLoginFallback(17, deps, request)).rejects.toThrow(/timeout/);
    expect(order).toEqual(['request', 'login']);
  });
});

describe('repeater route modes', () => {
  afterEach(() => {
    clearMeshcoreRepeaterRouteEscalationStateForTests();
  });

  function modeHarness(opts: {
    mode: MeshcoreRepeaterRouteMode;
    route?: 'direct' | 'flood' | 'unknown';
    canLogin?: boolean;
    /** Outcome of each request attempt in order; the last entry repeats. */
    requests: ('ok' | 'timeout' | 'rejected')[];
    zeroHopFails?: boolean;
  }) {
    const order: string[] = [];
    const attempts: { escalated: boolean; sameRouteRetry: boolean }[] = [];
    let attemptIndex = 0;
    const routeMode = vi.fn(() => opts.mode);
    const deps = {
      resetContactPath: vi.fn(() => {
        order.push('reset');
        return Promise.resolve(true);
      }),
      resolveRouteKind: () => opts.route ?? 'direct',
      nowMs: () => 1_000,
      routeMode,
      ensureZeroHopRoute: vi.fn(() => {
        order.push('zeroHop');
        return opts.zeroHopFails ? Promise.reject(new Error('radio ERR 3')) : Promise.resolve();
      }),
      canLogin: () => opts.canLogin ?? false,
      login: vi.fn(() => {
        order.push('login');
        return Promise.resolve();
      }),
    };
    const request = vi.fn((attempt: { escalated: boolean; sameRouteRetry: boolean }) => {
      order.push('request');
      attempts.push({ ...attempt });
      const outcome = opts.requests[Math.min(attemptIndex, opts.requests.length - 1)];
      attemptIndex += 1;
      if (outcome === 'ok') return Promise.resolve('ok');
      return Promise.reject(new Error(outcome === 'timeout' ? 'timeout' : 'radio rejected'));
    });
    return { deps, request, order, attempts, routeMode };
  }

  it('Direct only retries once on the same route without a reset or flood', async () => {
    const { deps, request, order, attempts } = modeHarness({
      mode: 'direct',
      requests: ['timeout', 'ok'],
    });
    await expect(withMeshcoreRepeaterRouteEscalation(21, deps, request)).resolves.toBe('ok');
    expect(order).toEqual(['request', 'request']);
    expect(attempts).toEqual([
      { escalated: false, sameRouteRetry: false },
      { escalated: false, sameRouteRetry: true },
    ]);
    expect(deps.resetContactPath).not.toHaveBeenCalled();
  });

  it('Direct only retries a second request inside the flood cooldown', async () => {
    const first = modeHarness({ mode: 'direct', requests: ['timeout', 'ok'] });
    await withMeshcoreRepeaterRouteEscalation(22, first.deps, first.request);
    const second = modeHarness({ mode: 'direct', requests: ['timeout', 'ok'] });
    await expect(
      withMeshcoreRepeaterRouteEscalation(22, second.deps, second.request),
    ).resolves.toBe('ok');
    expect(second.order).toEqual(['request', 'request']);
  });

  it('Direct only gives up after the one same-route retry', async () => {
    const { deps, request, order } = modeHarness({
      mode: 'direct',
      requests: ['timeout', 'timeout'],
    });
    await expect(withMeshcoreRepeaterRouteEscalation(23, deps, request)).rejects.toThrow(/timeout/);
    expect(order).toEqual(['request', 'request']);
  });

  it('Direct only does not retry a radio rejection', async () => {
    const { deps, request, order } = modeHarness({ mode: 'direct', requests: ['rejected'] });
    await expect(withMeshcoreRepeaterRouteEscalation(24, deps, request)).rejects.toThrow(
      /radio rejected/,
    );
    expect(order).toEqual(['request']);
  });

  it('Direct only on a route the radio already floods behaves like Auto', async () => {
    const { deps, request, order } = modeHarness({
      mode: 'direct',
      route: 'flood',
      requests: ['timeout', 'ok'],
    });
    await expect(withMeshcoreRepeaterRouteEscalation(25, deps, request)).rejects.toThrow(/timeout/);
    expect(order).toEqual(['request']);
  });

  it('Zero-hop sets a zero-hop route before the first send and before the retry', async () => {
    const { deps, request, order, attempts } = modeHarness({
      mode: 'zeroHop',
      requests: ['timeout', 'ok'],
    });
    await expect(withMeshcoreRepeaterRouteEscalation(26, deps, request)).resolves.toBe('ok');
    expect(order).toEqual(['zeroHop', 'request', 'zeroHop', 'request']);
    expect(attempts[1]).toEqual({ escalated: false, sameRouteRetry: true });
    expect(deps.resetContactPath).not.toHaveBeenCalled();
  });

  it('Zero-hop retries even when the radio route read as flood before the write', async () => {
    const { deps, request, order } = modeHarness({
      mode: 'zeroHop',
      route: 'flood',
      requests: ['timeout', 'ok'],
    });
    await expect(withMeshcoreRepeaterRouteEscalation(27, deps, request)).resolves.toBe('ok');
    expect(order).toEqual(['zeroHop', 'request', 'zeroHop', 'request']);
  });

  it('Zero-hop sends nothing when the route write fails', async () => {
    const { deps, request, order } = modeHarness({
      mode: 'zeroHop',
      zeroHopFails: true,
      requests: ['ok'],
    });
    await expect(withMeshcoreRepeaterRouteEscalation(28, deps, request)).rejects.toThrow(
      /radio ERR 3/,
    );
    expect(order).toEqual(['zeroHop']);
    expect(request).not.toHaveBeenCalled();
  });

  it('reads the mode once per call', async () => {
    const { deps, request, routeMode } = modeHarness({
      mode: 'direct',
      requests: ['timeout', 'ok'],
    });
    await withMeshcoreRepeaterRouteEscalation(29, deps, request);
    expect(routeMode).toHaveBeenCalledTimes(1);
  });

  it('Auto keeps the reset and flood retry when a mode reader is supplied', async () => {
    const { deps, request, order, attempts } = modeHarness({
      mode: 'auto',
      requests: ['timeout', 'ok'],
    });
    await expect(withMeshcoreRepeaterRouteEscalation(30, deps, request)).resolves.toBe('ok');
    expect(order).toEqual(['request', 'reset', 'request']);
    expect(attempts[1]).toEqual({ escalated: true, sameRouteRetry: false });
  });

  it('Direct only logs in before the same-route retry', async () => {
    const { deps, request, order } = modeHarness({
      mode: 'direct',
      canLogin: true,
      requests: ['timeout', 'ok'],
    });
    await expect(withMeshcoreRepeaterLoginFallback(31, deps, request)).resolves.toBe('ok');
    expect(order).toEqual(['request', 'login', 'request']);
  });

  it('Zero-hop logs in once and never resets the route', async () => {
    const { deps, request, order } = modeHarness({
      mode: 'zeroHop',
      canLogin: true,
      requests: ['timeout', 'timeout'],
    });
    await expect(withMeshcoreRepeaterLoginFallback(32, deps, request)).rejects.toThrow(/timeout/);
    expect(order).toEqual(['zeroHop', 'request', 'zeroHop', 'login', 'request']);
  });
});
