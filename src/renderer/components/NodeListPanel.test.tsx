import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, it, expect, vi } from 'vitest';
import NodeListPanel from './NodeListPanel';

vi.mock('../stores/diagnosticsStore', () => ({
  useDiagnosticsStore: (selector: (s: unknown) => unknown) => {
    const store = {
      anomalies: new Map(),
      ignoreMqttEnabled: false,
      nodeRedundancy: new Map(),
    };
    return selector(store);
  },
}));

const defaultFilter = {
  enabled: false,
  maxDistance: 500,
  unit: 'miles' as const,
  hideMqttOnly: false,
};

describe('NodeListPanel accessibility', () => {
  it('has no axe violations with empty nodes', async () => {
    const { container } = render(
      <NodeListPanel
        nodes={new Map()}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
