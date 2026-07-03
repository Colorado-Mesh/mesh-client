/**
 * Regression guard: LocalStats and RF hop/signal ingest must feed diagnosticsStore
 * so connected-node CU history, RF analysis, and hop-flapping detection stay live.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(join(__dirname, 'meshtasticLegacyWireSubscriptions.ts'), 'utf-8');

function sliceFromMarker(marker: string, length = 1400): string {
  const index = SOURCE.indexOf(marker);
  if (index === -1) return '';
  return SOURCE.slice(index, index + length);
}

describe('meshtasticLegacyWireSubscriptions diagnostics ingest contract', () => {
  it('localStats handler calls processNodeUpdate when protocol is meshtastic', () => {
    const body = sliceFromMarker('// Handle localStats variant');
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain("tel.variant?.case === 'localStats'");
    expect(body).toContain('processNodeUpdate');
    expect(body).toContain("getStoredMeshProtocol() === 'meshtastic'");
  });

  it('RF mesh packet hop/signal handler calls processNodeUpdate when protocol is meshtastic', () => {
    const body = sliceFromMarker('if (hasSignal || hasHopUpdate)');
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain('processNodeUpdate');
    expect(body).toContain("getStoredMeshProtocol() === 'meshtastic'");
  });
});
