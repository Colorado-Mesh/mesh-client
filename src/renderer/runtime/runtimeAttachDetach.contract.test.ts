/**
 * Source-contract: Meshtastic RF wire attach stores a detach handle that
 * cleanupSubscriptions invokes; MeshCore conn attach similarly tears down via
 * meshcoreIngressDetachRef / teardownMeshcoreConnEventListeners.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { extractUseCallbackBody } from '../lib/sourceContractTestHelpers';

const MESHTASTIC_RUNTIME = readFileSync(join(__dirname, 'useMeshtasticRuntime.ts'), 'utf-8');
const MESHCORE_RUNTIME = readFileSync(join(__dirname, 'useMeshcoreRuntime.ts'), 'utf-8');

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
