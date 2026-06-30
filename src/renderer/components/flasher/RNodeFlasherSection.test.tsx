import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { RNodeFlasherSection } from './RNodeFlasherSection';

describe('RNodeFlasherSection', () => {
  it('has no axe violations when collapsed', async () => {
    hydrateAxeThemeColors(document.documentElement);
    const { container } = render(<RNodeFlasherSection portBlocked={false} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('renders collapsible details with chevron', () => {
    const { container } = render(<RNodeFlasherSection portBlocked={false} />);
    const details = container.querySelector('details.group');
    expect(details).not.toBeNull();
    expect(details?.querySelector('summary svg')).not.toBeNull();
  });
});
