import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../lib/sourceContractTestHelpers';

describe('environment telemetry history wiring (source contract)', () => {
  it('MeshCore requestTelemetry records any node reading with source rpc', () => {
    const src = loadRuntimeSource('useMeshcoreRuntime.ts');
    const start = src.indexOf('runMeshcoreRepeaterTelemetryRequest(');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, start + 6000);
    expect(body).toMatch(/recordEnvironmentReading\(\s*'meshcore',\s*nodeId,/);
    expect(body).toContain("'rpc'");
  });

  it('Meshtastic MQTT onNodeUpdate records readings only when the marker is present', () => {
    const src = loadRuntimeSource('useMeshtasticRuntime.ts');
    const start = src.indexOf('window.electronAPI.mqtt.onNodeUpdate(');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('window.electronAPI.mqtt.onMessage(', start));
    expect(body).toContain('const envRecordedAt = takeEnvironmentNodeUpdateMarker(nodeUpdate);');
    expect(body).toMatch(/typeof envRecordedAt === 'number'/);
    expect(body).toMatch(
      /recordEnvironmentReading\('meshtastic', nodeUpdate\.node_id, reading, 'mqtt'\)/,
    );
  });
});
