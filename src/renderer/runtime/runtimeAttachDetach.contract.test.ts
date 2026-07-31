/**
 * Source-contract: Meshtastic RF wire attach stores a detach handle that
 * cleanupSubscriptions invokes; MeshCore conn attach similarly tears down via
 * meshcoreIngressDetachRef / teardownMeshcoreConnEventListeners.
 */
import { describe, expect, it } from 'vitest';

import { extractUseCallbackBody, loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const MESHTASTIC_RUNTIME = loadRuntimeSource('useMeshtasticRuntime.ts');
const MESHCORE_RUNTIME = loadRuntimeSource('useMeshcoreRuntime.ts');

describe('runtime attach/detach source contracts', () => {
  it('Meshtastic cleanupSubscriptions invokes meshtasticIngressDetachRef', () => {
    const body = extractUseCallbackBody(MESHTASTIC_RUNTIME, 'cleanupSubscriptions');
    expect(body).toContain('meshtasticIngressDetachRef.current');
    expect(body).toContain('meshtasticIngressDetachRef.current()');
    expect(MESHTASTIC_RUNTIME).toContain('attachMeshtasticRuntimeWireEffects(');
  });

  it('MeshCore teardown invokes meshcoreIngressDetachRef and attaches conn side effects', () => {
    const body = extractUseCallbackBody(MESHCORE_RUNTIME, 'teardownMeshcoreConnEventListeners');
    expect(body).toContain('meshcoreIngressDetachRef.current');
    expect(body).toContain('meshcoreIngressDetachRef.current()');
    expect(MESHCORE_RUNTIME).toContain(
      'attachMeshcoreConnSideEffects(conn, meshcoreConnSideEffectsCtx)',
    );
  });
});
