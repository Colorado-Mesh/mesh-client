import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { AppAboutSection } from './AppAboutSection';

describe('AppAboutSection', () => {
  it('renders the brand mark as a static logo, not a button', () => {
    const { container } = render(<AppAboutSection />);

    expect(container.querySelector('svg.cm-brand-mark')).not.toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('has no axe violations', async () => {
    const { container } = render(<AppAboutSection />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
