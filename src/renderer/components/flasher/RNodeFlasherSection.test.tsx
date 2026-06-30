import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { RNodeFlasherSection } from './RNodeFlasherSection';

describe('RNodeFlasherSection', () => {
  it('has no axe violations', async () => {
    hydrateAxeThemeColors(document.documentElement);
    const { container } = render(<RNodeFlasherSection portBlocked={false} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('renders flasher content without outer details wrapper', () => {
    const { container } = render(<RNodeFlasherSection portBlocked={false} />);
    expect(container.querySelector('details')).toBeNull();
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
  });
});
