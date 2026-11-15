import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TopologyHopFilterControls } from './TopologyHopFilterControls';

describe('TopologyHopFilterControls', () => {
  it('parses the selected max-hops option and reports null for "all"', () => {
    const onMaxHopsChange = vi.fn();
    render(
      <TopologyHopFilterControls
        maxHops={2}
        onMaxHopsChange={onMaxHopsChange}
        maxHopsFilterLabel="Max hops"
        maxHopsAllLabel="Show all"
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

  it('renders default Meshtastic hop presets including 7 and not 8', () => {
    render(
      <TopologyHopFilterControls
        maxHops={null}
        onMaxHopsChange={vi.fn()}
        maxHopsFilterLabel="Max hops"
        maxHopsAllLabel="Show all"
        maxHopsOptionLabel={(hops) => `${hops} hops`}
      />,
    );
    expect(screen.getByText('Show all')).toBeInTheDocument();
    expect(screen.getByText('7 hops')).toBeInTheDocument();
    expect(screen.queryByText('8 hops')).not.toBeInTheDocument();
  });

  it('renders a custom hop option list when provided', () => {
    render(
      <TopologyHopFilterControls
        maxHops={null}
        onMaxHopsChange={vi.fn()}
        maxHopsFilterLabel="Max hops"
        maxHopsAllLabel="Show all"
        maxHopsOptionLabel={(hops) => `${hops} hops`}
        hopOptions={[1, 4, 16, 64]}
      />,
    );
    expect(screen.getByText('1 hops')).toBeInTheDocument();
    expect(screen.getByText('4 hops')).toBeInTheDocument();
    expect(screen.getByText('16 hops')).toBeInTheDocument();
    expect(screen.getByText('64 hops')).toBeInTheDocument();
    expect(screen.queryByText('2 hops')).not.toBeInTheDocument();
  });
});
