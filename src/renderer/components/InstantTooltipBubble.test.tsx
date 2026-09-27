import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Z_INSTANT_TOOLTIP } from '@/renderer/lib/modalZIndex';

import { InstantTooltipBubble } from './InstantTooltipBubble';

describe('InstantTooltipBubble', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders with Z_INSTANT_TOOLTIP above modals', () => {
    render(<InstantTooltipBubble text="hint" pos={{ top: 10, left: 20, placement: 'above' }} />);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveStyle({ zIndex: String(Z_INSTANT_TOOLTIP) });
  });

  it('is as wide as its text, up to 16rem, instead of a fixed 16rem', () => {
    render(
      <InstantTooltipBubble text="Reticulum" pos={{ top: 10, left: 20, placement: 'above' }} />,
    );
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveClass('w-max', 'max-w-64');
    expect(tip).not.toHaveClass('w-64');
  });

  it('keeps a centred bubble on screen by its measured width', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
    render(
      <InstantTooltipBubble
        text="Disconnect & Quit"
        pos={{ top: 40, left: window.innerWidth - 10, placement: 'below' }}
      />,
    );
    const tip = screen.getByRole('tooltip');
    expect(tip.style.left).toBe(`${String(window.innerWidth - 8 - 100)}px`);
    expect(tip.style.transform).toBe('none');
  });

  it('opens beside the trigger for the right side', () => {
    render(
      <InstantTooltipBubble text="MeshCore" pos={{ top: 120, left: 58, placement: 'right' }} />,
    );
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveStyle({ left: '58px', top: '120px', transform: 'translate(0, -50%)' });
  });
});
