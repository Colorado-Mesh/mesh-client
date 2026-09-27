import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { Stepper } from './Stepper';

describe('Stepper', () => {
  it('steps with the buttons and the arrow keys, within bounds', () => {
    const onChange = vi.fn();
    render(<Stepper label="Max retries" value={3} min={0} max={4} onChange={onChange} />);
    const field = screen.getByRole('textbox', { name: 'Max retries' });
    fireEvent.keyDown(field, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(4);
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it('keeps a visible keyboard focus outline on the value and both buttons', () => {
    render(<Stepper label="Max retries" value={3} onChange={vi.fn()} />);
    const controls = [
      screen.getByRole('textbox', { name: 'Max retries' }),
      ...screen.getAllByRole('button'),
    ];
    for (const control of controls) {
      // Inset, because the stepper clips its overflow.
      expect(control.className).toContain('focus-visible:outline-2');
      expect(control.className).toContain('focus-visible:-outline-offset-2');
    }
    // The value field hides the resting outline, so focus must set the style back.
    expect(controls[0]?.className).toContain('focus-visible:outline-solid');
  });

  it('has no axe violations', async () => {
    const { container } = render(<Stepper label="Max retries" value={3} onChange={vi.fn()} />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
