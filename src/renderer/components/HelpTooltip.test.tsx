import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { HelpTooltip } from './HelpTooltip';

describe('HelpTooltip', () => {
  it('renders the ⓘ icon by default', () => {
    render(<HelpTooltip text="Help text" />);
    expect(screen.getByText('ⓘ')).toBeInTheDocument();
  });

  it('renders custom children instead of ⓘ when provided', () => {
    render(
      <HelpTooltip text="Help text">
        <span>Custom trigger</span>
      </HelpTooltip>,
    );
    expect(screen.getByText('Custom trigger')).toBeInTheDocument();
    expect(screen.queryByText('ⓘ')).not.toBeInTheDocument();
  });

  it('shows tooltip text on mouseenter and hides on mouseleave', async () => {
    const user = userEvent.setup();
    render(<HelpTooltip text="Helpful explanation" />);
    const trigger = document.querySelector('.cursor-help')!;
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.hover(trigger);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Helpful explanation');
    await user.unhover(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('does not use a native title attribute (broken in Electron)', () => {
    const { container } = render(<HelpTooltip text="Should not be native" />);
    const helpEl = container.querySelector('.cursor-help');
    expect(helpEl?.getAttribute('title')).toBeNull();
  });

  it('exposes tooltip text via aria-description when idle, aria-describedby when focused', () => {
    render(<HelpTooltip text="Accessible help body" ariaLabel="About help" />);
    const trigger = screen.getByLabelText('About help');
    expect(trigger).toHaveAttribute('aria-description', 'Accessible help body');
    expect(trigger).not.toHaveAttribute('aria-describedby');
    act(() => {
      fireEvent.focus(trigger);
    });
    const describedBy = trigger.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(trigger).not.toHaveAttribute('aria-description');
    expect(document.getElementById(describedBy!)).toHaveTextContent('Accessible help body');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Accessible help body');
  });

  it('shows tooltip on focus and hides on blur', () => {
    render(<HelpTooltip text="Keyboard help" />);
    const trigger = document.querySelector('.cursor-help')!;
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    act(() => {
      fireEvent.focus(trigger);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Keyboard help');
    act(() => {
      fireEvent.blur(trigger);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('clamps tooltip left when trigger is near the right viewport edge', async () => {
    const user = userEvent.setup();
    // Trigger centered at x=1008 (near right edge of a 1024px viewport), bubble 200px wide.
    // Centred, it would end at 1108; clamped, its left edge is 1024 - 8 - 200 = 816.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 200,
      bottom: 216,
      left: 1000,
      right: 1016,
      width: 16,
      height: 16,
      x: 1000,
      y: 200,
      toJSON: () => ({}),
    });
    render(<HelpTooltip text="Clamped" />);
    await user.hover(document.querySelector('.cursor-help')!);
    const tooltip = document.querySelector<HTMLElement>('.pointer-events-none')!;
    expect(tooltip).toBeTruthy();
    expect(parseFloat(tooltip.style.left)).toBe(window.innerWidth - 8 - 200);
    vi.restoreAllMocks();
  });

  it('clamps tooltip left when trigger is near the left viewport edge', async () => {
    const user = userEvent.setup();
    // Trigger centered at x=8, bubble 200px wide: centred, it would start at -92, so its left
    // edge is held at the 8px margin.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 200,
      bottom: 216,
      left: 0,
      right: 16,
      width: 16,
      height: 16,
      x: 0,
      y: 200,
      toJSON: () => ({}),
    });
    render(<HelpTooltip text="Left clamped" />);
    await user.hover(document.querySelector('.cursor-help')!);
    const tooltip = document.querySelector<HTMLElement>('.pointer-events-none')!;
    expect(tooltip).toBeTruthy();
    expect(parseFloat(tooltip.style.left)).toBe(8);
    vi.restoreAllMocks();
  });

  it('flips tooltip below trigger when trigger is near the top of the viewport', async () => {
    const user = userEvent.setup();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 20,
      bottom: 36,
      left: 200,
      right: 216,
      width: 16,
      height: 16,
      x: 200,
      y: 20,
      toJSON: () => ({}),
    });
    render(<HelpTooltip text="Below tooltip" />);
    await user.hover(document.querySelector('.cursor-help')!);
    const tooltip = document.querySelector<HTMLElement>('.pointer-events-none')!;
    expect(tooltip).toBeTruthy();
    // Positioned below (top = bottom + 4 = 40), not above; left is the measured edge, so no
    // horizontal translate.
    expect(parseFloat(tooltip.style.top)).toBe(40);
    expect(tooltip.style.transform).toBe('none');
    vi.restoreAllMocks();
  });

  it('positions tooltip above trigger when not near the top of the viewport', async () => {
    const user = userEvent.setup();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 200,
      bottom: 216,
      left: 300,
      right: 316,
      width: 16,
      height: 16,
      x: 300,
      y: 200,
      toJSON: () => ({}),
    });
    render(<HelpTooltip text="Above tooltip" />);
    await user.hover(document.querySelector('.cursor-help')!);
    const tooltip = document.querySelector<HTMLElement>('.pointer-events-none')!;
    expect(tooltip).toBeTruthy();
    // Positioned above (top = r.top - 8 = 192), transform flips it up
    expect(parseFloat(tooltip.style.top)).toBe(192);
    expect(tooltip.style.transform).toBe('translateY(-100%)');
    vi.restoreAllMocks();
  });
});
