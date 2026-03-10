import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import DiagnosticsPanel from './DiagnosticsPanel';

vi.mock('../stores/diagnosticsStore', () => ({
  useDiagnosticsStore: (selector: (s: unknown) => unknown) => {
    const store = {
      anomalies: new Map(),
      anomalyHalosEnabled: false,
      congestionHalosEnabled: false,
      envMode: 'standard',
      ignoreMqttEnabled: false,
      mqttIgnoredNodes: new Set<number>(),
      setAnomalyHalosEnabled: vi.fn(),
      setCongestionHalosEnabled: vi.fn(),
      setEnvMode: vi.fn(),
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
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
