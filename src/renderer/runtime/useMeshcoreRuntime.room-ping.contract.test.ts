// @vitest-environment jsdom
/**
 * KNOWN-GOOD Room Ping contract — locks the Status path in useMeshcoreRuntime.
 * Do not weaken these assertions to allow TRACE ping prep "parity"; see the KNOWN-GOOD
 * comment above `meshcoreShouldPingRoomViaStatus` in useMeshcoreRuntime.ts.
 */
import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const SOURCE = loadRuntimeSource('useMeshcoreRuntime.ts');

function sliceBetween(start: string, end: string): string {
  const from = SOURCE.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  const to = SOURCE.indexOf(end, from);
  expect(to).toBeGreaterThan(from);
  return SOURCE.slice(from, to);
}

describe('useMeshcoreRuntime room ping hops', () => {
  it('keeps the KNOWN-GOOD Room Ping working-path comment for audits/agents', () => {
    expect(SOURCE).toContain('KNOWN-GOOD Room Ping path');
    expect(SOURCE).toContain('Do NOT use');
    expect(SOURCE).toContain('resolveMeshcorePingHopsAway');
    expect(SOURCE).toContain('addMeshcoreNodeContactToRadio');
  });

  it('uses admin hops before Room Status (not TRACE ping prep)', () => {
    const body = sliceBetween(
      'if (meshcoreShouldPingRoomViaStatus(pingNode?.hw_model)) {',
      'const sendRoomStatusPing',
    );
    expect(body).toContain('resolveMeshcoreAdminHopsAway');
    expect(body).toContain('routeBytes ?? new Uint8Array()');
    expect(body).not.toContain('resolveMeshcorePingHopsAway');
    expect(body).not.toContain('refreshRepeaterContactPathFromRadio');
    expect(body).not.toContain('meshcoreIsUsableTraceStoredPath');
  });

  it('wires NOT_FOUND restore through runMeshcoreRoomStatusWithNotFoundRestore', () => {
    const body = sliceBetween(
      'const sendRoomStatusPing',
      'if (roomPingSessionStale()) return false;',
    );
    expect(body).toContain('runMeshcoreRoomStatusWithNotFoundRestore');
    expect(body).toContain('addMeshcoreNodeContactToRadio');
    expect(body).toContain('isSessionStale: roomPingSessionStale');
    expect(body).toContain('afterRestore');
    expect(body).toContain('useUnknownRouteHops = true');
    expect(body).toContain('resolveRoomStatusHops()');
    expect(body).toContain('hopsAwayUsedForSend = resolveRoomStatusHops()');
  });

  it('records hops_away from the last Status send hop count', () => {
    const body = sliceBetween('hopsAwayUsedForSend = resolveRoomStatusHops()', 'room ping error ');
    expect(body).toContain('hops_away: hopsAwayUsedForSend');
  });
});

describe('useMeshcoreRuntime room Status row action', () => {
  it('restores Room contacts on NOT_FOUND like Room Ping (not login-only fallback)', () => {
    const body = sliceBetween(
      'if (meshcoreShouldPingRoomViaStatus(statusHwModel)) {',
      'return withMeshcoreRepeaterLoginFallback',
    );
    expect(body).toContain('runMeshcoreRoomStatusWithNotFoundRestore');
    expect(body).toContain('addMeshcoreNodeContactToRadio');
    expect(body).toContain('canLogin: () => false');
    expect(body).toContain('maybeRequestMeshcoreAutoOffloadForError');
    expect(body).toContain('useUnknownRouteHops = true');
    expect(body).toContain('roomStatusSessionStale = statusSessionStale');
  });
});

describe('useMeshcoreRuntime room Status errors', () => {
  it('skips meshcoreStatusErrors when Room Status session went stale', () => {
    const body = sliceBetween('let roomStatusSessionStale', 'requestRepeaterStatusRef.current');
    expect(body).toContain('roomStatusSessionStale?.()');
    expect(body).toContain('requestRepeaterStatus abandoned (session stale)');
    expect(body).toMatch(
      /if \(roomStatusSessionStale\?\.\(\)\) \{[\s\S]*?throw e instanceof Error \? e : new Error/,
    );
  });
});
