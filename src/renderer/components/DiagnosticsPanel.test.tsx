import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, it, expect, vi } from 'vitest';
import DiagnosticsPanel from './DiagnosticsPanel';

vi.mock('../stores/diagnosticsStore', () => ({
  useDiagnosticsStore: (selector: (s: unknown) => unknown) => {
    const store = {
      anomalies: new Map(),
      anomalyHalosEnabled: false,
      congestionHalosEnabled: false,
      ignoreMqttEnabled: false,
      mqttIgnoredNodes: new Set<number>(),
      setAnomalyHalosEnabled: vi.fn(),
      setCongestionHalosEnabled: vi.fn(),
      setIgnoreMqttEnabled: vi.fn(),
      setNodeMqttIgnored: vi.fn(),
      runReanalysis: vi.fn(),
    };
    return selector(store);
  },
}));

describe('DiagnosticsPanel accessibility', () => {
  it('has no axe violations with empty data', async () => {
    const { container } = render(
      <DiagnosticsPanel
        nodes={new Map()}
        myNodeNum={0}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        isConnected={false}
        traceRouteResults={new Map()}
        getFullNodeLabel={vi.fn().mockReturnValue('Unknown')}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
