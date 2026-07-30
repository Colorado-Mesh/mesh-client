import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const TEST_DIR = import.meta.dirname;
const rendererRoot = join(TEST_DIR, '..');
const MESHTASTIC_WIRE_SOURCE = readFileSync(
  join(rendererRoot, 'lib/meshtastic/meshtasticRuntimeWireEffects.ts'),
  'utf-8',
);
const MESHCORE_CONN_SOURCE = readFileSync(
  join(rendererRoot, 'hooks/meshcore/meshcoreConnSideEffects.ts'),
  'utf-8',
);
const MESHCORE_INGEST_SOURCE = readFileSync(
  join(rendererRoot, 'lib/ingest/meshcoreIngest.ts'),
  'utf-8',
);

describe('runtime side-effect attachment contracts', () => {
  it('replaces Meshtastic ingress and ingest listeners before reattaching', () => {
    expect(MESHTASTIC_WIRE_SOURCE).toContain('meshtasticIngressDetachRef.current()');
    expect(MESHTASTIC_WIRE_SOURCE).toContain('meshtasticIngestSessionRef.current.detach()');
    expect(MESHTASTIC_WIRE_SOURCE).toContain('attachMeshtasticIngest(identityId');
  });

  it('returns a MeshCore PacketRouter detach function', () => {
    expect(MESHCORE_CONN_SOURCE).toContain('const detachListener = packetRouter.addListener');
    expect(MESHCORE_CONN_SOURCE).toContain('detachListener();');
  });

  it('returns a MeshCore ingest detach function', () => {
    expect(MESHCORE_INGEST_SOURCE).toContain('return packetRouter.addListener(createListener');
    expect(MESHCORE_INGEST_SOURCE).toContain('): () => void');
  });
});
