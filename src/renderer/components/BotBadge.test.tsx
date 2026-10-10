import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { BotBadge } from './BotBadge';

describe('BotBadge', () => {
  it('renders an accessible bot label with a tooltip', () => {
    render(<BotBadge />);
    const badge = screen.getByRole('img', { name: 'Bot' });
    expect(badge).toHaveAttribute('title', 'Detected as a bot from its automated replies');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <div className="bg-ink-900">
        <BotBadge />
      </div>,
    );
    hydrateAxeThemeColors(document.documentElement);
    expect(await axe(container)).toHaveNoViolations();
  });
});
