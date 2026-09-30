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

  it('feeds only this session radio fix to the resolver, never the self node row', () => {
    expect(body).toContain(`readRadioSelfPosition('${protocol}')`);
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
