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

  it('restores an evicted Room contact on Status NOT_FOUND then retries', () => {
    const body = sliceBetween(
      'const sendRoomStatusPing',
      'if (roomPingSessionStale()) return false;',
    );
    expect(body).toContain('isMeshcoreNotFoundError');
    expect(body).toContain('addMeshcoreNodeContactToRadio');
    expect(body).toContain('return await sendRoomStatusPing()');
  });
});
