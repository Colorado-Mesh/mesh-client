// @vitest-environment jsdom
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
  it('refreshes radio contact and uses resolveMeshcorePingHopsAway before Room Status', () => {
    const body = sliceBetween(
      'if (meshcoreShouldPingRoomViaStatus(pingNode?.hw_model)) {',
      'runMeshcoreRepeaterStatusRequest',
    );
    expect(body).toContain('refreshRepeaterContactPathFromRadio');
    expect(body).toContain('resolveMeshcorePingHopsAway');
    expect(body).toContain('meshcoreIsUsableTraceStoredPath');
    expect(body).not.toMatch(/resolveMeshcoreAdminHopsAway\(\s*pingNode,\s*routeBytes/);
  });
});
