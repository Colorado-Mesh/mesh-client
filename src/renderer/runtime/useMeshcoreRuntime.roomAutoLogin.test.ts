import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const RUNTIME_SOURCE = loadRuntimeSource('useMeshcoreRuntime.ts');

describe('useMeshcoreRuntime room auto-login ready key', () => {
  it('includes the auto-login id list so enabling auto-login retriggers connect login', () => {
    const start = RUNTIME_SOURCE.indexOf('const [roomAutoLoginIds, setRoomAutoLoginIds]');
    expect(start).toBeGreaterThan(-1);
    const region = RUNTIME_SOURCE.slice(start, start + 1600);
    expect(region).toContain("addEventListener('mesh-client:appSettings', syncRoomAutoLoginIds)");
    expect(region).toContain('meshcoreRoomAutoLoginReadyKey(');
    expect(region).toContain('[nodes, roomAutoLoginIds]');
  });
});
