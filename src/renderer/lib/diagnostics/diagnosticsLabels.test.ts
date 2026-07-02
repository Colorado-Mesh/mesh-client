import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';

import type { RfDiagnosticRow, RoutingDiagnosticRow } from '../types';
import {
  formatRoutingPortLabels,
  translateRfCauseText,
  translateRfConditionLabel,
  translateRoutingPortLabel,
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
    if (key === 'diagnosticsPanel.routingDesc.noisyNode' && opts) {
      return `${key}:${opts.ratePerHour}:${opts.ports}`;
    }
    if (key === 'diagnosticsPanel.routingPort.position') return 'Position';
    if (key === 'diagnosticsPanel.routingPort.nodeInfo') return 'NodeInfo';
    if (key === 'diagnosticsPanel.routingPort.generic' && opts) {
      return `Port${opts.port}`;
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

  it('translateRoutingPortLabel maps known portnums', () => {
    expect(translateRoutingPortLabel(t, 4)).toBe('NodeInfo');
    expect(translateRoutingPortLabel(t, 999)).toBe('Port999');
  });

  it('formatRoutingPortLabels joins translated port labels', () => {
    expect(formatRoutingPortLabels(t, [3, 4])).toBe('Position, NodeInfo');
  });

  it('translateRoutingRowDescription translates noisy node portNums', () => {
    const row: RoutingDiagnosticRow = {
      kind: 'routing',
      id: 'n',
      nodeId: 2,
      type: 'noisy_node',
      severity: 'warning',
      description: 'english',
      detectedAt: 0,
      descriptionI18n: {
        key: 'diagnosticsPanel.routingDesc.noisyNode',
        params: { ratePerHour: 5, portNums: '3' },
      },
    };
    expect(translateRoutingRowDescription(t, row)).toBe(
      'diagnosticsPanel.routingDesc.noisyNode:5:Position',
    );
  });
});
