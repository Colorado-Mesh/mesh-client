import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Z_INSTANT_TOOLTIP } from '@/renderer/lib/modalZIndex';

import { InstantTooltipBubble } from './InstantTooltipBubble';

describe('InstantTooltipBubble', () => {
  it('renders with Z_INSTANT_TOOLTIP above modals', () => {
    render(<InstantTooltipBubble text="hint" pos={{ top: 10, left: 20, below: false }} />);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveStyle({ zIndex: String(Z_INSTANT_TOOLTIP) });
  });
});
