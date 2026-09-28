import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { Switch } from './Switch';

describe('Switch', () => {
  it('reports the flipped value', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Auto-reconnect" />);
    fireEvent.click(screen.getByRole('switch', { name: 'Auto-reconnect' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('draws the on thumb in the app background color, not white', () => {
    render(<Switch checked onChange={vi.fn()} label="Auto-reconnect" />);
    const toggle = screen.getByRole('switch', { name: 'Auto-reconnect' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    // Dark on the accent is the pair the theme guards keep at 4.5:1; white measured about 1.5:1.
    const thumb = toggle.querySelector('span');
    expect(thumb?.className).toContain('bg-app-bg');
    expect(thumb?.className).not.toContain('bg-white');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <Switch checked onChange={vi.fn()} label="Auto-reconnect" description="Retry on drop" />,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
