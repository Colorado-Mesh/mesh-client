/**
 * Regression guard: LocalStats and RF hop/signal ingest must feed diagnosticsStore
 * so connected-node CU history, RF analysis, and hop-flapping detection stay live.
 *
 * Diagnostics run at coalesced-node-write flush (`onFlushNode` → processMeshtasticNodeDiagnostics),
 * not inline per packet — keep that wiring in the contract.
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
  it('localStats handler queues diagnostics via saveNode flush when protocol is meshtastic', () => {
    const body = sliceFromMarker(NODE_SOURCE, 'handleLocalStatsTelemetry');
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain('saveNode(identityId, node, { myNodeNum, homeNode: node })');
    expect(NODE_SOURCE).toContain('onFlushNode:');
    expect(NODE_SOURCE).toContain('processMeshtasticNodeDiagnostics');
    expect(DIAGNOSTICS_SOURCE).toContain('processNodeUpdate');
    expect(DIAGNOSTICS_SOURCE).toContain("getStoredMeshProtocol() !== 'meshtastic'");
  });

  it('RF mesh packet hop/signal handler queues diagnostics via onFlushNode when protocol is meshtastic', () => {
    const body = sliceFromMarker(RAW_SOURCE, 'if (!hasSignal && !hasHopUpdate)');
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain('onFlushNode');
    expect(body).toContain('processMeshtasticNodeDiagnostics');
    expect(DIAGNOSTICS_SOURCE).toContain('processNodeUpdate');
    expect(DIAGNOSTICS_SOURCE).toContain("getStoredMeshProtocol() !== 'meshtastic'");
  });
});
