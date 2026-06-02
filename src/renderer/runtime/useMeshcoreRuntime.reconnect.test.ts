// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const RUNTIME_SOURCE = readFileSync(join(__dirname, '../runtime/useMeshcoreRuntime.ts'), 'utf-8');
const CONN_EVENTS_SOURCE = readFileSync(
  join(__dirname, '../hooks/meshcore/meshcoreLegacyConnEvents.ts'),
  'utf-8',
);

describe('useMeshcoreRuntime auto-reconnect (regression)', () => {
  it('implements exponential backoff reconnect with max attempts', () => {
    expect(RUNTIME_SOURCE).toContain('attemptMeshcoreReconnect');
    expect(RUNTIME_SOURCE).toContain('handleMeshcoreConnectionLost');
    expect(RUNTIME_SOURCE).toContain('MESHCORE_MAX_RECONNECT_ATTEMPTS');
    expect(RUNTIME_SOURCE).toContain('delayUnlessSuspended');
  });

  it('persists connection params for ble, serial, and tcp reconnect', () => {
    expect(RUNTIME_SOURCE).toContain('meshcoreConnectionParamsRef');
    expect(RUNTIME_SOURCE).toMatch(/rfType: 'serial'/);
    expect(RUNTIME_SOURCE).toMatch(/rfType === 'tcp'/);
    expect(RUNTIME_SOURCE).toContain('verifyMeshcoreRfLink');
    expect(RUNTIME_SOURCE).toContain('RF link lost after MeshCore reconnect attach');
    expect(RUNTIME_SOURCE).not.toContain('RF link not ready before MeshCore reconnect open');
  });

  it('exports power suspend/resume handlers wired to reconnect', () => {
    expect(RUNTIME_SOURCE).toContain('onPowerSuspend');
    expect(RUNTIME_SOURCE).toContain('onPowerResume');
    expect(RUNTIME_SOURCE).toContain('handleMeshcoreConnectionLostRef.current()');
    expect(RUNTIME_SOURCE).toContain('power resume — resetting reconnect budget');
  });
});

describe('meshcoreLegacyConnEvents disconnected handler (regression)', () => {
  it('triggers handleConnectionLost when an operational session drops', () => {
    expect(CONN_EVENTS_SOURCE).toMatch(
      /onMeshcoreConn\('disconnected'[\s\S]{0,1200}handleConnectionLostRef\.current\(\)/,
    );
  });
});
