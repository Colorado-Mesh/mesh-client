// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { extractUseCallbackBody, loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const SOURCE = loadRuntimeSource('useMeshcoreRuntime.ts');

describe('useMeshcoreRuntime anon BASIC request guards', () => {
  const body = extractUseCallbackBody(SOURCE, 'requestNodeAnonBasic');

  it('establishes cache generation on session mismatch before in-flight reuse', () => {
    expect(body.length).toBeGreaterThan(0);
    expect(body).toMatch(
      /if \(!cacheMatchesSession\) \{[\s\S]*meshcoreAnonBasicRef\.current\.clear\(\);[\s\S]*meshcoreAnonBasicInFlightRef\.current\.clear\(\);[\s\S]*meshcoreAnonBasicCacheGenRef\.current = meshcoreSetupGenerationRef\.current;[\s\S]*meshcoreAnonBasicCacheIdentityRef\.current = meshcoreIdentityIdRef\.current;/,
    );
  });

  it('deletes in-flight only when the map still holds this request promise', () => {
    expect(body).toMatch(
      /if \(meshcoreAnonBasicInFlightRef\.current\.get\(nodeId\) === basicFlight\.promise\) \{\s*meshcoreAnonBasicInFlightRef\.current\.delete\(nodeId\);\s*\}/,
    );
  });

  it('reuses OWNER clock without inventing known feature flags', () => {
    expect(body).toMatch(
      /const reused: MeshcoreAnonBasicEntry = \{\s*status: 'ok',\s*fetchedAt: owner\.fetchedAt,\s*clock: owner\.clock,\s*\};/,
    );
    expect(body).not.toMatch(/features:\s*0/);
    expect(body).not.toMatch(/isBridge:\s*false/);
    expect(body).not.toMatch(/forwardingDisabled:\s*false/);
  });

  it('passes radioContactPathLen into the BASIC anon RPC', () => {
    expect(body).toContain('radioContactPathLen: radioContactPathLenByNodeRef.current.get(nodeId)');
  });
});

describe('useMeshcoreRuntime anon OWNER in-flight cleanup', () => {
  const body = extractUseCallbackBody(SOURCE, 'requestNodeOwnerInfo');

  it('deletes in-flight only when the map still holds this request promise', () => {
    expect(body).toMatch(
      /if \(meshcoreOwnerInfoInFlightRef\.current\.get\(nodeId\) === ownerFlight\.promise\) \{\s*meshcoreOwnerInfoInFlightRef\.current\.delete\(nodeId\);\s*\}/,
    );
  });
});
