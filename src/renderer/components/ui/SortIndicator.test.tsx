import { render } from '@testing-library/react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react-motion';
import { describe, expect, it } from 'vitest';

import { SortIndicator } from './SortIndicator';

function shapeOf(container: HTMLElement): string | undefined {
  return container.querySelector('svg')?.innerHTML;
}

describe('SortIndicator', () => {
  it.each([
    [null, 'none', ArrowUpDown],
    ['asc', 'asc', ArrowUp],
    ['desc', 'desc', ArrowDown],
  ] as const)('draws %s as the %s arrow', (direction, state, Expected) => {
    const { container } = render(<SortIndicator direction={direction} />);
    const icon = container.querySelector('svg');
    expect(icon).toHaveAttribute('data-sort', state);
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(shapeOf(container)).toBe(shapeOf(render(<Expected size={12} />).container));
  });

  it('never draws a chevron, which read as a dropdown next to the Export menu', () => {
    const chevrons = [ChevronUp, ChevronDown].map((Chevron) =>
      shapeOf(render(<Chevron size={12} />).container),
    );
    for (const direction of ['asc', 'desc'] as const) {
      const { container } = render(<SortIndicator direction={direction} />);
      expect(chevrons).not.toContain(shapeOf(container));
    }
  });

  it('marks only the sorted column in the accent', () => {
    const { container, rerender } = render(<SortIndicator direction={null} />);
    expect(container.querySelector('svg')).not.toHaveClass('text-bright-green');
    rerender(<SortIndicator direction="asc" />);
    expect(container.querySelector('svg')).toHaveClass('text-bright-green');
  });
});
