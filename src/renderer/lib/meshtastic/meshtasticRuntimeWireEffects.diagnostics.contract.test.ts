/**
 * Regression guard: LocalStats and RF hop/signal ingest must feed diagnosticsStore
 * so connected-node CU history, RF analysis, and hop-flapping detection stay live.
 *
 * Observations (hop history / packet counts / CU samples) are recorded per event;
 * expensive analysis stays debounced inside diagnosticsStore.processNodeUpdate.
 * SQLite persistence remains coalesced via enqueueNodeWrite.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const NODE_SOURCE = readFileSync(join(__dirname, 'meshtasticNodeSideEffects.ts'), 'utf-8');
const RAW_SOURCE = readFileSync(join(__dirname, 'meshtasticRawPacketSideEffects.ts'), 'utf-8');
const DIAGNOSTICS_SOURCE = readFileSync(
  join(__dirname, 'meshtasticProcessNodeDiagnostics.ts'),
  'utf-8',
);

function sliceFromMarker(source: string, marker: string, length = 1400): string {
  const index = source.indexOf(marker);
  if (index === -1) return '';
  return source.slice(index, index + length);
}

describe('meshtastic diagnostics ingest contract', () => {
  it('localStats handler records diagnostics per saveNode when protocol is meshtastic', () => {
    const body = sliceFromMarker(NODE_SOURCE, 'handleLocalStatsTelemetry');
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain('saveNode(identityId, node, { myNodeNum, homeNode: node })');
    expect(NODE_SOURCE).toContain('processMeshtasticNodeDiagnostics(node,');
    expect(DIAGNOSTICS_SOURCE).toContain('processNodeUpdate');
    expect(DIAGNOSTICS_SOURCE).toContain("getStoredMeshProtocol() !== 'meshtastic'");
  });

  it('RF mesh packet hop/signal handler records diagnostics per packet when protocol is meshtastic', () => {
    const body = sliceFromMarker(RAW_SOURCE, 'if (!hasSignal && !hasHopUpdate)');
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain('processMeshtasticNodeDiagnostics');
    expect(body).not.toContain('onFlushNode');
    expect(DIAGNOSTICS_SOURCE).toContain('processNodeUpdate');
    expect(DIAGNOSTICS_SOURCE).toContain("getStoredMeshProtocol() !== 'meshtastic'");
  });
});
