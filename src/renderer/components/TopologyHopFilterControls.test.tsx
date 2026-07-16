import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TopologyHopFilterControls } from './TopologyHopFilterControls';

describe('TopologyHopFilterControls', () => {
  it('renders the distant-peers checkbox reflecting current state', () => {
    render(
      <TopologyHopFilterControls
        includeDistantPeers={true}
        onIncludeDistantPeersChange={vi.fn()}
        maxHops={null}
        onMaxHopsChange={vi.fn()}
        showDistantPeersLabel="Show distant peers"
        maxHopsFilterLabel="Max hops"
        maxHopsAllLabel="All"
        maxHopsOptionLabel={(hops) => `${hops} hops`}
      />,
    );
    const checkbox = screen.getByLabelText<HTMLInputElement>('Show distant peers');
    expect(checkbox.checked).toBe(true);
  });

  it('calls onIncludeDistantPeersChange when the checkbox is toggled', () => {
    const onChange = vi.fn();
    render(
      <TopologyHopFilterControls
        includeDistantPeers={false}
        onIncludeDistantPeersChange={onChange}
        maxHops={null}
        onMaxHopsChange={vi.fn()}
        showDistantPeersLabel="Show distant peers"
        maxHopsFilterLabel="Max hops"
        maxHopsAllLabel="All"
        maxHopsOptionLabel={(hops) => `${hops} hops`}
      />,
    );
    fireEvent.click(screen.getByLabelText('Show distant peers'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('parses the selected max-hops option and reports null for "all"', () => {
    const onMaxHopsChange = vi.fn();
    render(
      <TopologyHopFilterControls
        includeDistantPeers={false}
        onIncludeDistantPeersChange={vi.fn()}
        maxHops={2}
        onMaxHopsChange={onMaxHopsChange}
        showDistantPeersLabel="Show distant peers"
        maxHopsFilterLabel="Max hops"
        maxHopsAllLabel="All"
        maxHopsOptionLabel={(hops) => `${hops} hops`}
      />,
    );
    const select = screen.getByLabelText<HTMLSelectElement>('Max hops');
    expect(select.value).toBe('2');

    fireEvent.change(select, { target: { value: '5' } });
    expect(onMaxHopsChange).toHaveBeenCalledWith(5);

    fireEvent.change(select, { target: { value: 'all' } });
    expect(onMaxHopsChange).toHaveBeenCalledWith(null);
  });

  it('renders a custom hop option list when provided', () => {
    render(
      <TopologyHopFilterControls
        includeDistantPeers={false}
        onIncludeDistantPeersChange={vi.fn()}
        maxHops={null}
        onMaxHopsChange={vi.fn()}
        showDistantPeersLabel="Show distant peers"
        maxHopsFilterLabel="Max hops"
        maxHopsAllLabel="All"
        maxHopsOptionLabel={(hops) => `${hops} hops`}
        hopOptions={[1, 4]}
      />,
    );
    expect(screen.getByText('1 hops')).toBeInTheDocument();
    expect(screen.getByText('4 hops')).toBeInTheDocument();
    expect(screen.queryByText('2 hops')).not.toBeInTheDocument();
  });
});
