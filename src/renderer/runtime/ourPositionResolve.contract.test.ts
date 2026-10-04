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
});

describe('useMeshcoreRuntime radio self position', () => {
  it('does not read a radio fix, because nothing records one', () => {
    const body = refreshBody(
      loadRuntimeSource('useMeshcoreRuntime.ts'),
      'const refreshOurPositionNoop = useCallback',
    );
    expect(body).not.toContain("readRadioSelfPosition('meshcore')");
  });

  it('does not treat advert lat/lon (user- or app-set) as device GPS', () => {
    expect(loadRuntimeSource('useMeshcoreRuntime.ts')).not.toContain('recordRadioSelfPosition');
  });
});
