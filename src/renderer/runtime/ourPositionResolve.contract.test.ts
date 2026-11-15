// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { extractBalancedBlock, loadRuntimeSource } from '../lib/sourceContractTestHelpers';

function refreshBody(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  expect(start).toBeGreaterThan(-1);
  return extractBalancedBlock(source, source.indexOf('{', source.indexOf('=>', start)));
}

describe.each([
  ['useMeshtasticRuntime.ts', 'const refreshOurPosition = useCallback', 'meshtastic'],
  ['useMeshcoreRuntime.ts', 'const refreshOurPositionNoop = useCallback', 'meshcore'],
])('%s our-position resolve', (file, declaration, protocol) => {
  const body = refreshBody(loadRuntimeSource(file), declaration);

  it('skips host geolocation unless this protocol is the stored one', () => {
    expect(body).toContain(`if (getStoredMeshProtocol() !== '${protocol}')`);
  });

  it('never reads the self node row as device GPS', () => {
    expect(body).not.toMatch(/myNode\?\.latitude/);
    expect(body).not.toMatch(/myNode\?\.longitude/);
  });

  it('never writes city-level IP/browser fixes into the self node', () => {
    expect(body).toMatch(/if \(pos && !isLowAccuracyPosition\(pos\.source\)\)/);
  });

  it('publishes the trust-aware reference for diagnostics', () => {
    expect(body).toContain('publishOurPositionReference(pos)');
    expect(body).not.toContain('setOurPositionSource');
  });
});

describe('useMeshtasticRuntime radio self position', () => {
  it('feeds only this session radio fix to the resolver', () => {
    const body = refreshBody(
      loadRuntimeSource('useMeshtasticRuntime.ts'),
      'const refreshOurPosition = useCallback',
    );
    expect(body).toContain("readRadioSelfPosition('meshtastic')");
  });

  it('drops superseded refresh commits after await', () => {
    const body = refreshBody(
      loadRuntimeSource('useMeshtasticRuntime.ts'),
      'const refreshOurPosition = useCallback',
    );
    expect(body).toContain('refreshOurPositionGenerationRef');
    expect(body).toMatch(
      /await resolveOurPosition\([\s\S]*?generation !== refreshOurPositionGenerationRef\.current/,
    );
    expect(body).toMatch(
      /generation !== refreshOurPositionGenerationRef\.current[\s\S]*?return null/,
    );
  });
});

describe('useMeshcoreRuntime radio self position', () => {
  it('feeds only this session radio fix to the resolver', () => {
    const body = refreshBody(
      loadRuntimeSource('useMeshcoreRuntime.ts'),
      'const refreshOurPositionNoop = useCallback',
    );
    expect(body).toContain("readRadioSelfPosition('meshcore')");
  });

  it('drops superseded refresh commits after await', () => {
    const body = refreshBody(
      loadRuntimeSource('useMeshcoreRuntime.ts'),
      'const refreshOurPositionNoop = useCallback',
    );
    expect(body).toContain('refreshOurPositionGenerationRef');
    expect(body).toMatch(
      /await resolveOurPosition\([\s\S]*?generation !== refreshOurPositionGenerationRef\.current/,
    );
    expect(body).toMatch(
      /generation !== refreshOurPositionGenerationRef\.current[\s\S]*?return null/,
    );
  });

  it('records device GPS only from self telemetry LPP, not advert lat/lon', () => {
    const source = loadRuntimeSource('useMeshcoreRuntime.ts');
    expect(source).toContain("recordRadioSelfPosition('meshcore'");
    const advertIdx = source.indexOf('meshcoreScaledAdvLatLonToDeg');
    expect(advertIdx).toBeGreaterThan(-1);
    const recordNearAdvert = source.slice(Math.max(0, advertIdx - 400), advertIdx + 800);
    expect(recordNearAdvert).not.toContain('recordRadioSelfPosition');
    expect(source).toMatch(/applyMeshcoreTelemetryLpp[\s\S]*?recordRadioSelfPosition\('meshcore'/);
  });
});
