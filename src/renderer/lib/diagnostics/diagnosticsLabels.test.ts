import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';

import type { RfDiagnosticRow, RoutingDiagnosticRow } from '../types';
import {
  translateRfCauseText,
  translateRfConditionLabel,
  translateRoutingRowDescription,
} from './diagnosticsLabels';

describe('diagnosticsLabels', () => {
  const t = vi.fn((key: string, opts?: Record<string, unknown>) => {
    if (key === 'diagnosticsPanel.foreignLoraProximitySnippet.nearby') return 'Nearby';
    if (key === 'diagnosticsPanel.foreignLoraCause.meshtastic' && opts) {
      return `Meshtastic: ${opts.sender} ${opts.proximity}`;
    }
    if (key === 'diagnosticsPanel.rfCondition.utilizationVsTx') return 'UTIL TX';
    if (key === 'diagnosticsPanel.routingDesc.hopGoblinKm' && opts) {
      return `km ${opts.distanceKm} hops ${opts.hops}`;
    }
    return key;
  }) as unknown as TFunction;

  it('translateRfConditionLabel maps known RF conditions', () => {
    expect(translateRfConditionLabel(t, 'Utilization vs. TX')).toBe('UTIL TX');
    expect(translateRfConditionLabel(t, 'Unknown Future Condition')).toBe(
      'Unknown Future Condition',
    );
  });

  it('translateRfCauseText expands meshtastic proximity', () => {
    const row: RfDiagnosticRow = {
      kind: 'rf',
      id: 'x',
      nodeId: 1,
      condition: 'Meshtastic Traffic Detected',
      cause: 'english',
      severity: 'info',
      detectedAt: 0,
      causeI18n: {
        key: 'diagnosticsPanel.foreignLoraCause.meshtastic',
        params: { sender: '!abc', proximityKey: 'nearby' },
      },
    };
    expect(translateRfCauseText(t, row)).toBe('Meshtastic: !abc Nearby. ');
  });

  it('translateRoutingRowDescription uses descriptionI18n when set', () => {
    const row: RoutingDiagnosticRow = {
      kind: 'routing',
      id: 'r',
      nodeId: 2,
      type: 'hop_goblin',
      severity: 'error',
      description: 'english',
      detectedAt: 0,
      descriptionI18n: {
        key: 'diagnosticsPanel.routingDesc.hopGoblinKm',
        params: { distanceKm: '1.5', hops: 4 },
      },
    };
    expect(translateRoutingRowDescription(t, row)).toBe('km 1.5 hops 4');
  });
});
