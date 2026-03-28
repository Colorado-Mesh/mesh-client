import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import NodeListPanel from './NodeListPanel';

vi.mock('../stores/diagnosticsStore', () => ({
  useDiagnosticsStore: (selector: (s: unknown) => unknown) => {
    const store = {
      diagnosticRows: [],
      ignoreMqttEnabled: false,
      nodeRedundancy: new Map(),
    };
    return selector(store);
  },
}));

vi.mock('./Toast', () => ({
  useToast: () => ({
    addToast: vi.fn(),
  }),
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
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('shows contacts title in meshcore mode', () => {
    render(
      <NodeListPanel
        nodes={new Map()}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshcore"
      />,
    );
    expect(screen.getByRole('heading', { name: 'Contacts (0)' })).toBeInTheDocument();
  });
});

describe('NodeListPanel import contacts', () => {
  it('shows Import Contacts button in meshcore mode when onImportContacts provided', () => {
    render(
      <NodeListPanel
        nodes={new Map()}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshcore"
        onImportContacts={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Import Contacts' })).toBeInTheDocument();
  });

  it('does not show Import Contacts button in meshtastic mode', () => {
    render(
      <NodeListPanel
        nodes={new Map()}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshtastic"
        onImportContacts={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Import Contacts' })).not.toBeInTheDocument();
  });

  it('does not show Import Contacts button when onImportContacts not provided in meshcore mode', () => {
    render(
      <NodeListPanel
        nodes={new Map()}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshcore"
      />,
    );
    expect(screen.queryByRole('button', { name: 'Import Contacts' })).not.toBeInTheDocument();
  });
});
